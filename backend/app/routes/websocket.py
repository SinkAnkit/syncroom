import json
import logging
import asyncio
import time
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select, update
from app.database import async_session
from app.models import Room, ChatMessage
from app import redis_client

logger = logging.getLogger(__name__)
router = APIRouter()

ROLE_ADMIN = "admin"
ROLE_MOD = "mod"
ROLE_MEMBER = "member"

MAX_USERNAME_LEN = 50
MAX_CHAT_LEN = 1000
HEARTBEAT_INTERVAL = 25          # seconds between server pings
CHAT_BURST = 5                   # messages allowed in CHAT_WINDOW
CHAT_WINDOW = 5.0                # seconds

# Close codes
CLOSE_ROOM_NOT_FOUND = 4004
CLOSE_KICKED = 4003
CLOSE_NAME_TAKEN = 4009


class ConnectionManager:
    """Manages WebSocket connections per room."""

    def __init__(self):
        self.rooms: dict[str, dict[str, WebSocket]] = {}

    def has_user(self, room_id: str, username: str) -> bool:
        return username in self.rooms.get(room_id, {})

    async def connect(self, room_id: str, username: str, websocket: WebSocket):
        await websocket.accept()
        self.rooms.setdefault(room_id, {})[username] = websocket
        await redis_client.add_participant(room_id, username)
        logger.info(f"[{room_id}] {username} connected")

    async def disconnect(self, room_id: str, username: str, websocket: WebSocket | None = None):
        """
        Remove a connection. When ``websocket`` is supplied the entry is only
        removed if it still belongs to that socket, so a stale/duplicate socket
        can never evict the live one.

        Idempotent: a failed broadcast and the request's own ``finally`` block
        both land here for the same user.
        """
        removed = False
        room = self.rooms.get(room_id)
        if room is not None:
            if websocket is None or room.get(username) is websocket:
                removed = room.pop(username, None) is not None
            if not room:
                self.rooms.pop(room_id, None)
        if not removed:
            return
        await redis_client.remove_participant(room_id, username)
        await redis_client.remove_user_role(room_id, username)
        logger.info(f"[{room_id}] {username} disconnected")

    async def broadcast(self, room_id: str, message: dict, exclude: str | None = None):
        # Snapshot: send_json awaits, and peers may connect/disconnect meanwhile.
        targets = list(self.rooms.get(room_id, {}).items())
        dead: list[tuple[str, WebSocket]] = []
        for username, ws in targets:
            if username == exclude:
                continue
            try:
                await ws.send_json(message)
            except Exception:
                dead.append((username, ws))
        for username, ws in dead:
            await self.disconnect(room_id, username, ws)

    async def send_to(self, room_id: str, username: str, message: dict) -> bool:
        ws = self.rooms.get(room_id, {}).get(username)
        if ws is None:
            return False
        try:
            await ws.send_json(message)
            return True
        except Exception:
            await self.disconnect(room_id, username, ws)
            return False

    def get_connection_count(self, room_id: str) -> int:
        return len(self.rooms.get(room_id, {}))

    async def kick_user(self, room_id: str, username: str):
        """Force-close a user's WebSocket connection."""
        ws = self.rooms.get(room_id, {}).get(username)
        if ws is None:
            return
        try:
            await ws.send_json({
                "type": "role:kicked",
                "message": "You have been kicked from the room",
            })
            # Small delay so the message lands before the socket closes
            await asyncio.sleep(0.3)
            await ws.close(code=CLOSE_KICKED, reason="Kicked by admin")
        except Exception:
            pass
        await self.disconnect(room_id, username, ws)


manager = ConnectionManager()


async def heartbeat(websocket: WebSocket):
    try:
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL)
            await websocket.send_json({"type": "ping"})
    except (asyncio.CancelledError, Exception):
        pass


async def update_viewer_count(room_id: str):
    """Update viewer_count in the DB to match current connections."""
    count = manager.get_connection_count(room_id)
    try:
        async with async_session() as db:
            await db.execute(
                update(Room).where(Room.id == room_id).values(viewer_count=count)
            )
            await db.commit()
    except Exception as exc:
        logger.warning(f"[{room_id}] Failed to update viewer count: {exc}")


async def get_participants_with_roles(room_id: str) -> list[dict]:
    """Get participant list with roles."""
    participants = await redis_client.get_participants(room_id)
    roles = await redis_client.get_all_roles(room_id)
    return [
        {"username": p, "role": roles.get(p, ROLE_MEMBER)}
        for p in participants
    ]


def can_control_video(role: str) -> bool:
    return role in (ROLE_ADMIN, ROLE_MOD)


def can_moderate(role: str) -> bool:
    return role == ROLE_ADMIN


async def stop_active_share(room_id: str, username: str) -> bool:
    """
    Clear ``username``'s screen share (if they own it) and tell everyone.
    Returns True when a share was actually stopped.
    """
    if not await redis_client.clear_screen_sharer(room_id, username):
        return False
    await manager.broadcast(room_id, {"type": "screen:stop", "username": username})
    logger.info(f"[{room_id}] {username} stopped screen share")
    return True


async def transfer_admin_if_needed(room_id: str, leaver_role: str):
    """
    If the last admin left, hand the room to someone else (mods first) so the
    room does not become permanently uncontrollable.
    """
    if leaver_role != ROLE_ADMIN:
        return
    roles = await redis_client.get_all_roles(room_id)
    remaining = list(manager.rooms.get(room_id, {}).keys())
    if not remaining or any(roles.get(u) == ROLE_ADMIN for u in remaining):
        return

    successor = next((u for u in remaining if roles.get(u) == ROLE_MOD), remaining[0])
    await redis_client.set_user_role(room_id, successor, ROLE_ADMIN)
    await manager.send_to(room_id, successor, {
        "type": "role:assigned",
        "role": ROLE_ADMIN,
        "username": successor,
    })
    await manager.broadcast(room_id, {
        "type": "role:changed",
        "target": successor,
        "new_role": ROLE_ADMIN,
        "by": "system",
        "participants": await get_participants_with_roles(room_id),
    })
    logger.info(f"[{room_id}] admin transferred to {successor}")


@router.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, username: str = "Anonymous"):
    username = (username or "").strip()[:MAX_USERNAME_LEN] or "Anonymous"

    # Verify room exists
    async with async_session() as db:
        result = await db.execute(select(Room).where(Room.id == room_id))
        room = result.scalar_one_or_none()
        if not room:
            await websocket.close(code=CLOSE_ROOM_NOT_FOUND, reason="Room not found")
            return
        room_host = room.host_name
        room_video_url = room.video_url or ""

    # Reject duplicate names: previously the second joiner silently replaced the
    # first in the connection table, and either of them leaving evicted both.
    if manager.has_user(room_id, username):
        await websocket.accept()
        await websocket.send_json({
            "type": "error",
            "code": "name_taken",
            "message": f'"{username}" is already in this room. Pick another name.',
        })
        await asyncio.sleep(0.1)
        await websocket.close(code=CLOSE_NAME_TAKEN, reason="Username already in use")
        return

    await manager.connect(room_id, username, websocket)

    # Assign role: creator (host_name match) = admin, otherwise member
    role = ROLE_ADMIN if username == room_host else ROLE_MEMBER
    await redis_client.set_user_role(room_id, username, role)

    await update_viewer_count(room_id)

    heartbeat_task = asyncio.create_task(heartbeat(websocket))
    chat_times: list[float] = []

    try:
        # Send role to the new joiner
        await manager.send_to(room_id, username, {
            "type": "role:assigned",
            "role": role,
            "username": username,
        })

        # Notify everyone
        await manager.broadcast(room_id, {
            "type": "room:user_joined",
            "username": username,
            "role": role,
            "participants": await get_participants_with_roles(room_id),
        })

        # Send current video state to the new joiner
        state = await redis_client.get_room_state(room_id)
        await manager.send_to(room_id, username, {
            "type": "video:state",
            "timestamp": state["timestamp"],
            "is_playing": state["is_playing"],
            "video_url": state.get("video_url") or room_video_url,
            "volume": state.get("volume", 80),
        })

        # Replay an in-progress screen share so late joiners can request it
        sharer = await redis_client.get_screen_sharer(room_id)
        if sharer and sharer != username:
            await manager.send_to(room_id, username, {
                "type": "screen:start",
                "username": sharer,
            })

        # Listen for messages
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
            except json.JSONDecodeError:
                await manager.send_to(room_id, username, {
                    "type": "error", "message": "Malformed message",
                })
                continue
            if not isinstance(message, dict):
                continue

            msg_type = message.get("type", "")

            # Refresh role
            current_role = await redis_client.get_user_role(room_id, username)

            if msg_type == "pong":
                continue

            elif msg_type == "video:play":
                if not can_control_video(current_role):
                    await manager.send_to(room_id, username, {
                        "type": "error", "message": "No permission to control video"
                    })
                    continue
                timestamp = message.get("timestamp", 0)
                await redis_client.set_room_state(room_id, timestamp, True)
                await manager.broadcast(room_id, {
                    "type": "video:play",
                    "timestamp": timestamp,
                    "username": username,
                }, exclude=username)

            elif msg_type == "video:pause":
                if not can_control_video(current_role):
                    await manager.send_to(room_id, username, {
                        "type": "error", "message": "No permission to control video"
                    })
                    continue
                timestamp = message.get("timestamp", 0)
                await redis_client.set_room_state(room_id, timestamp, False)
                await manager.broadcast(room_id, {
                    "type": "video:pause",
                    "timestamp": timestamp,
                    "username": username,
                }, exclude=username)

            elif msg_type == "video:seek":
                if not can_control_video(current_role):
                    continue
                timestamp = message.get("timestamp", 0)
                state = await redis_client.get_room_state(room_id)
                await redis_client.set_room_state(room_id, timestamp, state["is_playing"])
                await manager.broadcast(room_id, {
                    "type": "video:seek",
                    "timestamp": timestamp,
                    "username": username,
                }, exclude=username)

            elif msg_type == "video:sync_request":
                state = await redis_client.get_room_state(room_id)
                await manager.send_to(room_id, username, {
                    "type": "video:state",
                    "timestamp": state["timestamp"],
                    "is_playing": state["is_playing"],
                    "video_url": state.get("video_url") or room_video_url,
                    "volume": state.get("volume", 80),
                })

            elif msg_type == "video:url_change":
                if not can_control_video(current_role):
                    continue
                new_url = str(message.get("video_url", "")).strip()
                if new_url:
                    room_video_url = new_url
                    async with async_session() as db:
                        await db.execute(
                            update(Room).where(Room.id == room_id).values(video_url=new_url)
                        )
                        await db.commit()
                    await redis_client.set_room_state(room_id, 0, False, video_url=new_url)
                    await manager.broadcast(room_id, {
                        "type": "video:url_change",
                        "video_url": new_url,
                        "username": username,
                    })

            elif msg_type == "video:uploaded":
                # A host finished uploading a file — tell everyone else to load it.
                # (This branch was missing entirely, so members never saw uploads.)
                if not can_control_video(current_role):
                    continue
                await redis_client.set_room_state(room_id, 0, False)
                await manager.broadcast(room_id, {
                    "type": "video:uploaded",
                    "url": message.get("url", ""),
                    "username": username,
                }, exclude=username)

            elif msg_type == "volume:change":
                if not can_control_video(current_role):
                    continue
                volume = max(0, min(100, int(message.get("volume", 80) or 0)))
                await redis_client.set_volume(room_id, volume)
                await manager.broadcast(room_id, {
                    "type": "volume:change",
                    "volume": volume,
                    "username": username,
                }, exclude=username)

            elif msg_type == "role:kick":
                if not can_moderate(current_role):
                    continue
                target = message.get("target", "")
                if not target or target == username:
                    continue
                if await redis_client.get_user_role(room_id, target) == ROLE_ADMIN:
                    continue  # Can't kick admin
                await stop_active_share(room_id, target)
                await manager.kick_user(room_id, target)
                await update_viewer_count(room_id)
                await manager.broadcast(room_id, {
                    "type": "room:user_kicked",
                    "username": target,
                    "by": username,
                    "participants": await get_participants_with_roles(room_id),
                })

            elif msg_type == "role:promote":
                if not can_moderate(current_role):
                    continue
                target = message.get("target", "")
                new_role = message.get("role", ROLE_MOD)
                if not target or new_role not in (ROLE_MOD, ROLE_ADMIN):
                    continue
                if await redis_client.get_user_role(room_id, target) == ROLE_ADMIN:
                    continue  # Can't change admin
                await redis_client.set_user_role(room_id, target, new_role)
                await manager.broadcast(room_id, {
                    "type": "role:changed",
                    "target": target,
                    "new_role": new_role,
                    "by": username,
                    "participants": await get_participants_with_roles(room_id),
                })
                # Notify the target specifically
                await manager.send_to(room_id, target, {
                    "type": "role:assigned",
                    "role": new_role,
                    "username": target,
                })

            elif msg_type == "role:demote":
                if not can_moderate(current_role):
                    continue
                target = message.get("target", "")
                if not target:
                    continue
                if await redis_client.get_user_role(room_id, target) == ROLE_ADMIN:
                    continue
                await redis_client.set_user_role(room_id, target, ROLE_MEMBER)
                # A demoted user loses the right to keep broadcasting.
                await stop_active_share(room_id, target)
                await manager.broadcast(room_id, {
                    "type": "role:changed",
                    "target": target,
                    "new_role": ROLE_MEMBER,
                    "by": username,
                    "participants": await get_participants_with_roles(room_id),
                })
                await manager.send_to(room_id, target, {
                    "type": "role:assigned",
                    "role": ROLE_MEMBER,
                    "username": target,
                })

            elif msg_type == "chat:message":
                content = str(message.get("content", "")).strip()
                if not content or len(content) > MAX_CHAT_LEN:
                    continue

                now = time.monotonic()
                chat_times = [t for t in chat_times if now - t < CHAT_WINDOW]
                if len(chat_times) >= CHAT_BURST:
                    await manager.send_to(room_id, username, {
                        "type": "error", "message": "You're sending messages too fast",
                    })
                    continue
                chat_times.append(now)

                async with async_session() as db:
                    chat_msg = ChatMessage(
                        room_id=room_id,
                        username=username,
                        content=content,
                    )
                    db.add(chat_msg)
                    await db.commit()
                    await db.refresh(chat_msg)
                    msg_data = chat_msg.to_dict()
                await manager.broadcast(room_id, {
                    "type": "chat:message",
                    **msg_data,
                })

            elif msg_type == "typing:start":
                await manager.broadcast(room_id, {
                    "type": "typing:start",
                    "username": username,
                }, exclude=username)

            elif msg_type == "typing:stop":
                await manager.broadcast(room_id, {
                    "type": "typing:stop",
                    "username": username,
                }, exclude=username)

            elif msg_type == "reaction:add":
                await manager.broadcast(room_id, {
                    "type": "reaction:add",
                    "message_id": message.get("message_id"),
                    "emoji": str(message.get("emoji", ""))[:8],
                    "username": username,
                })

            # ── WebRTC Voice Chat Signaling ──────────────

            elif msg_type in ("voice:offer", "voice:answer", "voice:ice"):
                target = message.get("target", "")
                if not target or target == username:
                    continue
                payload = {"type": msg_type, "from": username}
                if msg_type == "voice:ice":
                    payload["candidate"] = message.get("candidate")
                else:
                    payload["sdp"] = message.get("sdp")
                await manager.send_to(room_id, target, payload)

            elif msg_type == "voice:state":
                # User toggled their mic — broadcast to all
                await manager.broadcast(room_id, {
                    "type": "voice:state",
                    "username": username,
                    "muted": bool(message.get("muted", True)),
                    "active": bool(message.get("active", False)),
                })

            elif msg_type == "voice:mute":
                # Admin force-mutes a member
                if not can_moderate(current_role):
                    await manager.send_to(room_id, username, {
                        "type": "error", "message": "No permission to mute users"
                    })
                    continue
                target = message.get("target", "")
                if not target:
                    continue
                if await redis_client.get_user_role(room_id, target) == ROLE_ADMIN:
                    continue  # Can't mute admin
                await manager.send_to(room_id, target, {
                    "type": "voice:force_mute",
                    "by": username,
                })
                await manager.broadcast(room_id, {
                    "type": "voice:state",
                    "username": target,
                    "muted": True,
                    "active": True,
                    "forced": True,
                })

            # ── Screen Share Signaling ──────────────
            #
            # One-to-many: the sharer holds one RTCPeerConnection per viewer.
            # Viewers announce themselves with screen:request, the sharer (which
            # is the side that actually owns the media) always creates the offer.

            elif msg_type == "screen:start":
                if not can_control_video(current_role):
                    await manager.send_to(room_id, username, {
                        "type": "error",
                        "code": "screen_denied",
                        "message": "No permission to share your screen",
                    })
                    continue
                active_sharer = await redis_client.get_screen_sharer(room_id)
                if active_sharer and active_sharer != username and manager.has_user(room_id, active_sharer):
                    await manager.send_to(room_id, username, {
                        "type": "error",
                        "code": "screen_denied",
                        "message": f"{active_sharer} is already sharing their screen",
                    })
                    continue
                await redis_client.set_screen_sharer(room_id, username)
                await manager.broadcast(room_id, {
                    "type": "screen:start",
                    "username": username,
                }, exclude=username)
                logger.info(f"[{room_id}] {username} started screen share")

            elif msg_type == "screen:stop":
                await stop_active_share(room_id, username)

            elif msg_type == "screen:request":
                # Only the active sharer is worth bothering.
                sharer = await redis_client.get_screen_sharer(room_id)
                if not sharer:
                    await manager.send_to(room_id, username, {
                        "type": "screen:stop", "username": "",
                    })
                    continue
                if sharer == username:
                    continue
                await manager.send_to(room_id, sharer, {
                    "type": "screen:request",
                    "from": username,
                })

            elif msg_type in ("screen:offer", "screen:answer", "screen:ice"):
                target = message.get("target", "")
                if not target or target == username:
                    continue
                payload = {"type": msg_type, "from": username}
                if msg_type == "screen:ice":
                    payload["candidate"] = message.get("candidate")
                else:
                    payload["sdp"] = message.get("sdp")
                await manager.send_to(room_id, target, payload)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"[{room_id}] WebSocket error for {username}: {e}", exc_info=True)
    finally:
        heartbeat_task.cancel()
        try:
            await heartbeat_task
        except (asyncio.CancelledError, Exception):
            pass

        final_role = await redis_client.get_user_role(room_id, username)
        # If the sharer drops (tab closed, crash, network loss) the stream is
        # gone — tell viewers instead of leaving them on a frozen frame.
        await stop_active_share(room_id, username)
        await manager.disconnect(room_id, username, websocket)
        await update_viewer_count(room_id)

        await manager.broadcast(room_id, {
            "type": "room:user_left",
            "username": username,
            "participants": await get_participants_with_roles(room_id),
        })
        await transfer_admin_if_needed(room_id, final_role)

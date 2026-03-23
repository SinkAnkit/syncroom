import json
import logging
import asyncio
from datetime import datetime, timezone
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


class ConnectionManager:
    """Manages WebSocket connections per room."""

    def __init__(self):
        self.rooms: dict[str, dict[str, WebSocket]] = {}

    async def connect(self, room_id: str, username: str, websocket: WebSocket):
        await websocket.accept()
        if room_id not in self.rooms:
            self.rooms[room_id] = {}
        self.rooms[room_id][username] = websocket
        await redis_client.add_participant(room_id, username)
        logger.info(f"[{room_id}] {username} connected")

    async def disconnect(self, room_id: str, username: str):
        if room_id in self.rooms:
            self.rooms[room_id].pop(username, None)
            if not self.rooms[room_id]:
                del self.rooms[room_id]
        await redis_client.remove_participant(room_id, username)
        await redis_client.remove_user_role(room_id, username)
        logger.info(f"[{room_id}] {username} disconnected")

    async def broadcast(self, room_id: str, message: dict, exclude: str = None):
        if room_id not in self.rooms:
            return
        disconnected = []
        for username, ws in self.rooms[room_id].items():
            if username == exclude:
                continue
            try:
                await ws.send_json(message)
            except Exception:
                disconnected.append(username)
        for u in disconnected:
            await self.disconnect(room_id, u)

    async def send_to(self, room_id: str, username: str, message: dict):
        if room_id in self.rooms and username in self.rooms[room_id]:
            try:
                await self.rooms[room_id][username].send_json(message)
            except Exception:
                await self.disconnect(room_id, username)

    def get_connection_count(self, room_id: str) -> int:
        return len(self.rooms.get(room_id, {}))

    async def kick_user(self, room_id: str, username: str):
        """Force-close a user's WebSocket connection."""
        if room_id in self.rooms and username in self.rooms[room_id]:
            ws = self.rooms[room_id][username]
            try:
                await ws.send_json({"type": "role:kicked", "message": "You have been kicked from the room"})
                # Small delay to ensure message is delivered before close
                await asyncio.sleep(0.3)
                await ws.close(code=4003, reason="Kicked by admin")
            except Exception:
                pass
            await self.disconnect(room_id, username)


manager = ConnectionManager()


async def heartbeat(websocket: WebSocket, room_id: str, username: str):
    try:
        while True:
            await asyncio.sleep(30)
            try:
                await websocket.send_json({"type": "ping"})
            except Exception:
                break
    except asyncio.CancelledError:
        pass


async def update_viewer_count(room_id: str):
    """Update viewer_count in the DB to match current connections."""
    count = manager.get_connection_count(room_id)
    async with async_session() as db:
        await db.execute(
            update(Room).where(Room.id == room_id).values(viewer_count=count)
        )
        await db.commit()


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


@router.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, username: str = "Anonymous"):
    # Verify room exists
    async with async_session() as db:
        result = await db.execute(select(Room).where(Room.id == room_id))
        room = result.scalar_one_or_none()
        if not room:
            await websocket.close(code=4004, reason="Room not found")
            return
        room_host = room.host_name
        room_video_url = room.video_url

    await manager.connect(room_id, username, websocket)

    # Assign role: creator (host_name match) = admin, otherwise member
    is_creator = (username == room_host)
    role = ROLE_ADMIN if is_creator else ROLE_MEMBER
    await redis_client.set_user_role(room_id, username, role)

    # Update viewer count in DB
    await update_viewer_count(room_id)

    # Start heartbeat
    heartbeat_task = asyncio.create_task(heartbeat(websocket, room_id, username))

    try:
        # Send role to the new joiner
        await manager.send_to(room_id, username, {
            "type": "role:assigned",
            "role": role,
            "username": username,
        })

        # Notify everyone
        participant_list = await get_participants_with_roles(room_id)
        await manager.broadcast(room_id, {
            "type": "room:user_joined",
            "username": username,
            "role": role,
            "participants": participant_list,
        })

        # Send current video state to the new joiner
        state = await redis_client.get_room_state(room_id)
        await manager.send_to(room_id, username, {
            "type": "video:state",
            "timestamp": state["timestamp"],
            "is_playing": state["is_playing"],
            "video_url": state.get("video_url", room_video_url),
            "volume": state.get("volume", 80),
        })

        # Listen for messages
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
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
                await redis_client.set_room_state(room_id, timestamp, True, room_video_url)
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
                await redis_client.set_room_state(room_id, timestamp, False, room_video_url)
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
                await redis_client.set_room_state(room_id, timestamp, state["is_playing"], room_video_url)
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
                    "video_url": state.get("video_url", ""),
                    "volume": state.get("volume", 80),
                })

            elif msg_type == "video:url_change":
                if not can_control_video(current_role):
                    continue
                new_url = message.get("video_url", "")
                if new_url:
                    room_video_url = new_url
                    async with async_session() as db:
                        await db.execute(
                            update(Room).where(Room.id == room_id).values(video_url=new_url)
                        )
                        await db.commit()
                    await redis_client.set_room_state(room_id, 0, False, new_url)
                    await manager.broadcast(room_id, {
                        "type": "video:url_change",
                        "video_url": new_url,
                        "username": username,
                    })

            elif msg_type == "volume:change":
                if not can_control_video(current_role):
                    continue
                volume = max(0, min(100, message.get("volume", 80)))
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
                target_role = await redis_client.get_user_role(room_id, target)
                if target_role == ROLE_ADMIN:
                    continue  # Can't kick admin
                await manager.kick_user(room_id, target)
                await update_viewer_count(room_id)
                participant_list = await get_participants_with_roles(room_id)
                await manager.broadcast(room_id, {
                    "type": "room:user_kicked",
                    "username": target,
                    "by": username,
                    "participants": participant_list,
                })

            elif msg_type == "role:promote":
                if not can_moderate(current_role):
                    continue
                target = message.get("target", "")
                new_role = message.get("role", ROLE_MOD)
                if new_role not in (ROLE_MOD, ROLE_ADMIN):
                    continue
                target_role = await redis_client.get_user_role(room_id, target)
                if target_role == ROLE_ADMIN:
                    continue  # Can't change admin
                await redis_client.set_user_role(room_id, target, new_role)
                participant_list = await get_participants_with_roles(room_id)
                await manager.broadcast(room_id, {
                    "type": "role:changed",
                    "target": target,
                    "new_role": new_role,
                    "by": username,
                    "participants": participant_list,
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
                target_role = await redis_client.get_user_role(room_id, target)
                if target_role == ROLE_ADMIN:
                    continue
                await redis_client.set_user_role(room_id, target, ROLE_MEMBER)
                participant_list = await get_participants_with_roles(room_id)
                await manager.broadcast(room_id, {
                    "type": "role:changed",
                    "target": target,
                    "new_role": ROLE_MEMBER,
                    "by": username,
                    "participants": participant_list,
                })
                await manager.send_to(room_id, target, {
                    "type": "role:assigned",
                    "role": ROLE_MEMBER,
                    "username": target,
                })

            elif msg_type == "chat:message":
                content = message.get("content", "").strip()
                if not content or len(content) > 1000:
                    continue
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
                    "emoji": message.get("emoji", ""),
                    "username": username,
                })

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"[{room_id}] WebSocket error for {username}: {e}")
    finally:
        heartbeat_task.cancel()
        await manager.disconnect(room_id, username)
        await update_viewer_count(room_id)

        participant_list = await get_participants_with_roles(room_id)
        await manager.broadcast(room_id, {
            "type": "room:user_left",
            "username": username,
            "participants": participant_list,
        })

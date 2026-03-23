import json
import logging
import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from app.database import async_session
from app.models import Room, ChatMessage
from app import redis_client

logger = logging.getLogger(__name__)
router = APIRouter()


class ConnectionManager:
    """Manages WebSocket connections per room."""

    def __init__(self):
        # room_id -> {username: WebSocket}
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
        logger.info(f"[{room_id}] {username} disconnected")

    async def broadcast(self, room_id: str, message: dict, exclude: str = None):
        """Send message to all connected clients in a room, optionally excluding one."""
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
        """Send message to a specific user in a room."""
        if room_id in self.rooms and username in self.rooms[room_id]:
            try:
                await self.rooms[room_id][username].send_json(message)
            except Exception:
                await self.disconnect(room_id, username)

    def get_connection_count(self, room_id: str) -> int:
        return len(self.rooms.get(room_id, {}))


manager = ConnectionManager()


async def heartbeat(websocket: WebSocket, room_id: str, username: str):
    """Send periodic pings to keep the connection alive and detect dead clients."""
    try:
        while True:
            await asyncio.sleep(30)
            try:
                await websocket.send_json({"type": "ping"})
            except Exception:
                break
    except asyncio.CancelledError:
        pass


@router.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, username: str = "Anonymous"):
    # Verify room exists
    async with async_session() as db:
        result = await db.execute(select(Room).where(Room.id == room_id))
        room = result.scalar_one_or_none()
        if not room:
            await websocket.close(code=4004, reason="Room not found")
            return

    await manager.connect(room_id, username, websocket)

    # Start heartbeat task
    heartbeat_task = asyncio.create_task(heartbeat(websocket, room_id, username))

    try:
        # Notify everyone that a new user joined
        participants = await redis_client.get_participants(room_id)
        await manager.broadcast(room_id, {
            "type": "room:user_joined",
            "username": username,
            "participants": participants,
        })

        # Send current video state to the new joiner
        state = await redis_client.get_room_state(room_id)
        await manager.send_to(room_id, username, {
            "type": "video:state",
            "timestamp": state["timestamp"],
            "is_playing": state["is_playing"],
            "video_url": state.get("video_url", room.video_url),
        })

        # Listen for messages
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            msg_type = message.get("type", "")

            if msg_type == "pong":
                # Client responded to our ping — connection is healthy
                continue

            elif msg_type == "video:play":
                timestamp = message.get("timestamp", 0)
                await redis_client.set_room_state(room_id, timestamp, True, room.video_url)
                await manager.broadcast(room_id, {
                    "type": "video:play",
                    "timestamp": timestamp,
                    "username": username,
                }, exclude=username)

            elif msg_type == "video:pause":
                timestamp = message.get("timestamp", 0)
                await redis_client.set_room_state(room_id, timestamp, False, room.video_url)
                await manager.broadcast(room_id, {
                    "type": "video:pause",
                    "timestamp": timestamp,
                    "username": username,
                }, exclude=username)

            elif msg_type == "video:seek":
                timestamp = message.get("timestamp", 0)
                state = await redis_client.get_room_state(room_id)
                await redis_client.set_room_state(room_id, timestamp, state["is_playing"], room.video_url)
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
                })

            elif msg_type == "chat:message":
                content = message.get("content", "").strip()
                if not content:
                    continue

                # Save to database
                async with async_session() as db:
                    chat_msg = ChatMessage(
                        room_id=room_id,
                        username=username,
                        content=content,
                    )
                    db.add(chat_msg)
                    await db.commit()
                    await db.refresh(chat_msg)

                # Broadcast to all including sender
                await manager.broadcast(room_id, {
                    "type": "chat:message",
                    "id": chat_msg.id,
                    "username": username,
                    "content": content,
                    "created_at": chat_msg.created_at.isoformat(),
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
                message_id = message.get("message_id")
                emoji = message.get("emoji", "")
                if message_id and emoji:
                    await manager.broadcast(room_id, {
                        "type": "reaction:add",
                        "message_id": message_id,
                        "emoji": emoji,
                        "username": username,
                    })

            elif msg_type == "video:url_change":
                new_url = message.get("video_url", "")
                if new_url:
                    # Update room in database
                    async with async_session() as db:
                        result = await db.execute(select(Room).where(Room.id == room_id))
                        db_room = result.scalar_one_or_none()
                        if db_room:
                            db_room.video_url = new_url
                            await db.commit()

                    await redis_client.set_room_state(room_id, 0, False, new_url)
                    await manager.broadcast(room_id, {
                        "type": "video:url_change",
                        "video_url": new_url,
                        "username": username,
                    })

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WebSocket error for {username} in room {room_id}: {e}")
    finally:
        heartbeat_task.cancel()
        await manager.disconnect(room_id, username)
        participants = await redis_client.get_participants(room_id)
        await manager.broadcast(room_id, {
            "type": "room:user_left",
            "username": username,
            "participants": participants,
        })

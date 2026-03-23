from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.database import get_db
from app.models import Room, ChatMessage, User
from app.schemas import CreateRoomRequest, RoomResponse, ChatMessageResponse
from app.redis_client import get_participants, clear_room_state
from app.auth import get_current_user

router = APIRouter(prefix="/api/rooms", tags=["rooms"])


@router.post("", response_model=RoomResponse)
async def create_room(
    req: CreateRoomRequest,
    db: AsyncSession = Depends(get_db),
    user: Optional[User] = Depends(get_current_user),
):
    """Create a new room. Authenticated users get rooms linked to their account."""
    room = Room(
        name=req.name,
        video_url=req.video_url,
        host_name=req.host_name,
        creator_id=user.id if user else None,
    )
    db.add(room)
    await db.commit()
    await db.refresh(room)
    return RoomResponse(**room.to_dict())


@router.get("", response_model=list[RoomResponse])
async def list_rooms(
    limit: int = Query(default=10, le=50),
    db: AsyncSession = Depends(get_db),
):
    """List recent active rooms."""
    result = await db.execute(
        select(Room)
        .where(Room.is_active == True)
        .order_by(desc(Room.created_at))
        .limit(limit)
    )
    rooms = result.scalars().all()
    return [RoomResponse(**r.to_dict()) for r in rooms]


@router.get("/{room_id}", response_model=RoomResponse)
async def get_room(room_id: str, db: AsyncSession = Depends(get_db)):
    """Get a room by ID."""
    result = await db.execute(select(Room).where(Room.id == room_id))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return RoomResponse(**room.to_dict())


@router.get("/{room_id}/messages", response_model=list[ChatMessageResponse])
async def get_messages(
    room_id: str,
    limit: int = Query(default=50, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Get chat messages for a room."""
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.room_id == room_id)
        .order_by(desc(ChatMessage.created_at))
        .limit(limit)
    )
    messages = result.scalars().all()
    return [ChatMessageResponse(**m.to_dict()) for m in reversed(list(messages))]


@router.get("/{room_id}/participants")
async def get_room_participants(room_id: str):
    """Get current participants in a room."""
    participants = await get_participants(room_id)
    return {"participants": participants}


@router.delete("/{room_id}")
async def delete_room(
    room_id: str,
    db: AsyncSession = Depends(get_db),
    user: Optional[User] = Depends(get_current_user),
):
    """Deactivate a room."""
    result = await db.execute(select(Room).where(Room.id == room_id))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    # Only the creator or host can delete
    if user and room.creator_id and room.creator_id != user.id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this room")

    room.is_active = False
    await db.commit()
    await clear_room_state(room_id)
    return {"status": "deleted", "room_id": room_id}

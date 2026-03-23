from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.database import get_db
from app.models import Room, User
from app.schemas import CreateRoomRequest, RoomResponse
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
        is_public=req.is_public,
    )
    db.add(room)
    await db.commit()
    await db.refresh(room)
    return RoomResponse(**room.to_dict())


@router.get("", response_model=list[RoomResponse])
async def list_rooms(
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """List recent rooms."""
    result = await db.execute(
        select(Room).where(Room.is_active == True).order_by(desc(Room.created_at)).limit(limit)
    )
    rooms = result.scalars().all()
    return [RoomResponse(**r.to_dict()) for r in rooms]


@router.get("/public", response_model=list[RoomResponse])
async def list_public_rooms(
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """List public rooms sorted by viewer count (most popular first)."""
    result = await db.execute(
        select(Room)
        .where(Room.is_active == True, Room.is_public == True)
        .order_by(desc(Room.viewer_count), desc(Room.created_at))
        .limit(limit)
    )
    rooms = result.scalars().all()
    return [RoomResponse(**r.to_dict()) for r in rooms]


@router.get("/{room_id}", response_model=RoomResponse)
async def get_room(room_id: str, db: AsyncSession = Depends(get_db)):
    """Get room details."""
    result = await db.execute(select(Room).where(Room.id == room_id))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    return RoomResponse(**room.to_dict())


@router.delete("/{room_id}")
async def delete_room(
    room_id: str,
    db: AsyncSession = Depends(get_db),
    user: Optional[User] = Depends(get_current_user),
):
    """Delete/deactivate a room. Only the creator can delete."""
    result = await db.execute(select(Room).where(Room.id == room_id))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    if user and room.creator_id and room.creator_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not the room owner")
    room.is_active = False
    await db.commit()
    return {"detail": "Room deleted"}

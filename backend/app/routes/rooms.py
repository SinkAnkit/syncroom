from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.database import get_db
from app.models import Room, User
from app.schemas import CreateRoomRequest, RoomResponse
from app.auth import get_current_user
import os
import uuid

router = APIRouter(prefix="/api/rooms", tags=["rooms"])

UPLOAD_DIR = os.path.abspath(
    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads")
)
os.makedirs(UPLOAD_DIR, exist_ok=True)

MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_MB", "2048")) * 1024 * 1024
ALLOWED_VIDEO_EXT = {".mp4", ".webm", ".mkv", ".mov", ".m4v", ".ogv"}
VIDEO_MIME = {
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".mov": "video/quicktime",
    ".ogv": "video/ogg",
}


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
        mode=req.mode,
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
    if not room or not room.is_active:
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
    # Previously an *anonymous* caller passed this check, so anyone could delete
    # any owned room simply by omitting the Authorization header.
    if room.creator_id and (user is None or room.creator_id != user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not the room owner")
    room.is_active = False
    await db.commit()
    return {"detail": "Room deleted"}


@router.get("/{room_id}/messages")
async def get_room_messages(
    room_id: str,
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """Get the most recent chat messages for a room, oldest-first."""
    from app.models import ChatMessage
    # Take the newest N, then flip back to chronological order. Ordering
    # ascending before LIMIT returned the *oldest* N, so busy rooms opened
    # showing ancient history and none of the recent conversation.
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.room_id == room_id)
        .order_by(desc(ChatMessage.id))
        .limit(limit)
    )
    messages = list(result.scalars().all())
    messages.reverse()
    return [m.to_dict() for m in messages]


@router.post("/{room_id}/upload")
async def upload_video(
    room_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Upload a video file for a room in upload mode."""
    result = await db.execute(select(Room).where(Room.id == room_id))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.mode != "upload":
        raise HTTPException(status_code=400, detail="Room is not in upload mode")

    ext = os.path.splitext(file.filename or "video.mp4")[1].lower()
    if ext not in ALLOWED_VIDEO_EXT:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Allowed: {', '.join(sorted(ALLOWED_VIDEO_EXT))}",
        )

    previous = room.upload_filename
    safe_name = f"{room_id}_{uuid.uuid4().hex[:8]}{ext}"
    filepath = os.path.join(UPLOAD_DIR, safe_name)

    written = 0
    try:
        with open(filepath, "wb") as f:
            while chunk := await file.read(1024 * 1024):
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB)",
                    )
                f.write(chunk)
    except HTTPException:
        # Don't leave a partial file behind on the disk.
        if os.path.exists(filepath):
            os.remove(filepath)
        raise
    except Exception:
        if os.path.exists(filepath):
            os.remove(filepath)
        raise HTTPException(status_code=500, detail="Upload failed")

    room.upload_filename = safe_name
    await db.commit()

    # Reclaim the disk space used by the room's previous upload.
    if previous and previous != safe_name:
        old_path = os.path.join(UPLOAD_DIR, previous)
        if os.path.commonpath([os.path.abspath(old_path), UPLOAD_DIR]) == UPLOAD_DIR:
            try:
                os.remove(old_path)
            except OSError:
                pass

    return {"filename": safe_name, "url": f"/api/rooms/{room_id}/video"}


@router.get("/{room_id}/video")
async def serve_video(room_id: str, db: AsyncSession = Depends(get_db)):
    """Serve uploaded video. Starlette's FileResponse handles Range requests,
    which is what lets the browser seek instead of buffering the whole file."""
    result = await db.execute(select(Room).where(Room.id == room_id))
    room = result.scalar_one_or_none()
    if not room or not room.upload_filename:
        raise HTTPException(status_code=404, detail="No video found")

    # Defence in depth: never let a stored name escape the upload directory.
    filepath = os.path.abspath(os.path.join(UPLOAD_DIR, os.path.basename(room.upload_filename)))
    if os.path.commonpath([filepath, UPLOAD_DIR]) != UPLOAD_DIR or not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Video file missing")

    ext = os.path.splitext(filepath)[1].lower()
    return FileResponse(filepath, media_type=VIDEO_MIME.get(ext, "video/mp4"))

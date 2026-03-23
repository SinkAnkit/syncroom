import re
from typing import Optional
from pydantic import BaseModel, field_validator


# ── Auth ────────────────────────────────────────────

class SignupRequest(BaseModel):
    email: str
    password: str
    display_name: str

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        v = v.strip().lower()
        if not re.match(r"^[\w.+-]+@[\w-]+\.[\w.]+$", v):
            raise ValueError("Invalid email address")
        return v

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("Password must be at least 6 characters")
        return v

    @field_validator("display_name")
    @classmethod
    def validate_display_name(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 1 or len(v) > 50:
            raise ValueError("Display name must be between 1 and 50 characters")
        return v


class LoginRequest(BaseModel):
    email: str
    password: str


class UserResponse(BaseModel):
    id: str
    email: str
    display_name: str
    avatar_color: str
    created_at: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


# ── Rooms ───────────────────────────────────────────

class CreateRoomRequest(BaseModel):
    name: str
    video_url: str
    host_name: str
    is_public: bool = True

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 1 or len(v) > 100:
            raise ValueError("Room name must be between 1 and 100 characters")
        return v

    @field_validator("video_url")
    @classmethod
    def validate_video_url(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Video URL is required")
        return v

    @field_validator("host_name")
    @classmethod
    def validate_host_name(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 1 or len(v) > 50:
            raise ValueError("Host name must be between 1 and 50 characters")
        return v


class RoomResponse(BaseModel):
    id: str
    name: str
    video_url: str
    host_name: str
    creator_id: Optional[str] = None
    is_active: bool
    is_public: bool = True
    viewer_count: int = 0
    created_at: str


# ── Chat ────────────────────────────────────────────

class ChatMessageResponse(BaseModel):
    id: int
    room_id: str
    username: str
    content: str
    created_at: str


class SendMessageRequest(BaseModel):
    content: str

    @field_validator("content")
    @classmethod
    def validate_content(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 1 or len(v) > 1000:
            raise ValueError("Message must be between 1 and 1000 characters")
        return v

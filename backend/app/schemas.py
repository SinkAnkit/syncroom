from pydantic import BaseModel, field_validator, EmailStr
from typing import Optional
import re


# ── Auth Schemas ──

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

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        return v.strip().lower()


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


# ── Room Schemas ──

class CreateRoomRequest(BaseModel):
    name: str
    video_url: str
    host_name: str

    @field_validator("video_url")
    @classmethod
    def validate_youtube_url(cls, v: str) -> str:
        youtube_patterns = [
            r"(https?://)?(www\.)?youtube\.com/watch\?v=[\w-]+",
            r"(https?://)?(www\.)?youtu\.be/[\w-]+",
            r"(https?://)?(www\.)?youtube\.com/embed/[\w-]+",
        ]
        if not any(re.match(p, v) for p in youtube_patterns):
            raise ValueError("Must be a valid YouTube URL")
        return v

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 1 or len(v) > 100:
            raise ValueError("Room name must be between 1 and 100 characters")
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
    is_active: bool
    created_at: str
    creator_id: str | None = None


class ChatMessageResponse(BaseModel):
    id: int
    room_id: str
    username: str
    content: str
    created_at: str


class JoinRoomRequest(BaseModel):
    username: str

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 1 or len(v) > 50:
            raise ValueError("Username must be between 1 and 50 characters")
        return v

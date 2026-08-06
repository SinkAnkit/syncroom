"""
State management — Uses Redis when REDIS_URL is set, otherwise falls back to in-memory.
Provides a unified API surface regardless of backend.
"""
import json
import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# --- Backend selection ---
_use_redis = bool(os.getenv("REDIS_URL"))
_redis = None

# In-memory stores (fallback)
_room_states: dict[str, str] = {}
_room_participants: dict[str, set[str]] = {}
_room_roles: dict[str, dict[str, str]] = {}  # room_id -> {username: role}
_room_screen: dict[str, str] = {}  # room_id -> username currently sharing


async def _get_redis():
    """Lazily connect to Redis."""
    global _redis
    if _redis is None:
        import redis.asyncio as aioredis
        _redis = aioredis.from_url(
            os.getenv("REDIS_URL"),
            decode_responses=True,
        )
    return _redis


async def close_redis():
    """Close Redis connection if active."""
    global _redis
    if _redis is not None:
        try:
            # redis-py >= 5 deprecates close() in favour of aclose()
            closer = getattr(_redis, "aclose", None) or _redis.close
            await closer()
        except Exception as exc:  # pragma: no cover - shutdown best effort
            logger.warning(f"Error closing Redis connection: {exc}")
        _redis = None
        logger.info("Redis connection closed")


# --- Key helpers ---
def _room_key(room_id: str) -> str:
    return f"room:{room_id}:state"

def _participants_key(room_id: str) -> str:
    return f"room:{room_id}:participants"

def _roles_key(room_id: str) -> str:
    return f"room:{room_id}:roles"

def _screen_key(room_id: str) -> str:
    return f"room:{room_id}:screen"


# --- Room State (includes volume) ---

async def get_room_state(room_id: str) -> dict:
    if _use_redis:
        r = await _get_redis()
        state = await r.get(_room_key(room_id))
        if state:
            return json.loads(state)
        return {"timestamp": 0, "is_playing": False, "video_url": "", "volume": 80}

    key = _room_key(room_id)
    state = _room_states.get(key)
    if state:
        return json.loads(state)
    return {"timestamp": 0, "is_playing": False, "video_url": "", "volume": 80}


async def set_room_state(
    room_id: str,
    timestamp: float,
    is_playing: bool,
    video_url: Optional[str] = None,
    volume: int = -1,
):
    """
    Persist playback state. ``video_url``/``volume`` left as None/-1 keep the
    previously stored value instead of silently wiping it.
    """
    if volume == -1 or video_url is None:
        existing = await get_room_state(room_id)
        if volume == -1:
            volume = existing.get("volume", 80)
        if video_url is None:
            video_url = existing.get("video_url", "")

    state = json.dumps({
        "timestamp": timestamp,
        "is_playing": is_playing,
        "video_url": video_url,
        "volume": volume,
    })

    if _use_redis:
        r = await _get_redis()
        await r.set(_room_key(room_id), state, ex=86400)
        return

    _room_states[_room_key(room_id)] = state


async def set_volume(room_id: str, volume: int):
    """Update only the volume in room state."""
    state = await get_room_state(room_id)
    state["volume"] = max(0, min(100, volume))
    encoded = json.dumps(state)
    if _use_redis:
        r = await _get_redis()
        await r.set(_room_key(room_id), encoded, ex=86400)
        return
    _room_states[_room_key(room_id)] = encoded


# --- Participants ---

async def add_participant(room_id: str, username: str):
    if _use_redis:
        r = await _get_redis()
        await r.sadd(_participants_key(room_id), username)
        return

    key = _participants_key(room_id)
    if key not in _room_participants:
        _room_participants[key] = set()
    _room_participants[key].add(username)


async def remove_participant(room_id: str, username: str):
    if _use_redis:
        r = await _get_redis()
        await r.srem(_participants_key(room_id), username)
        return

    key = _participants_key(room_id)
    if key in _room_participants:
        _room_participants[key].discard(username)


async def get_participants(room_id: str) -> list[str]:
    if _use_redis:
        r = await _get_redis()
        members = await r.smembers(_participants_key(room_id))
        return sorted(list(members))

    key = _participants_key(room_id)
    members = _room_participants.get(key, set())
    return sorted(list(members))


async def get_participant_count(room_id: str) -> int:
    if _use_redis:
        r = await _get_redis()
        return await r.scard(_participants_key(room_id))
    key = _participants_key(room_id)
    return len(_room_participants.get(key, set()))


# --- Roles ---

async def set_user_role(room_id: str, username: str, role: str):
    """Set a user's role (admin, mod, member)."""
    if _use_redis:
        r = await _get_redis()
        await r.hset(_roles_key(room_id), username, role)
        return
    key = room_id
    if key not in _room_roles:
        _room_roles[key] = {}
    _room_roles[key][username] = role


async def get_user_role(room_id: str, username: str) -> str:
    """Get a user's role. Defaults to 'member'."""
    if _use_redis:
        r = await _get_redis()
        role = await r.hget(_roles_key(room_id), username)
        return role or "member"
    return _room_roles.get(room_id, {}).get(username, "member")


async def get_all_roles(room_id: str) -> dict[str, str]:
    """Get all roles for a room."""
    if _use_redis:
        r = await _get_redis()
        return await r.hgetall(_roles_key(room_id))
    return dict(_room_roles.get(room_id, {}))


async def remove_user_role(room_id: str, username: str):
    """Remove a user's role entry."""
    if _use_redis:
        r = await _get_redis()
        await r.hdel(_roles_key(room_id), username)
        return
    if room_id in _room_roles:
        _room_roles[room_id].pop(username, None)


# --- Screen Share ---

async def set_screen_sharer(room_id: str, username: str):
    """Record who is currently sharing their screen in a room."""
    if _use_redis:
        r = await _get_redis()
        await r.set(_screen_key(room_id), username, ex=86400)
        return
    _room_screen[room_id] = username


async def get_screen_sharer(room_id: str) -> Optional[str]:
    """Return the username currently sharing, or None."""
    if _use_redis:
        r = await _get_redis()
        return await r.get(_screen_key(room_id))
    return _room_screen.get(room_id)


async def clear_screen_sharer(room_id: str, username: Optional[str] = None) -> bool:
    """
    Clear the active screen share.

    If ``username`` is given, only clears when that user is the current sharer.
    Returns True when state was actually cleared.
    """
    current = await get_screen_sharer(room_id)
    if current is None:
        return False
    if username is not None and current != username:
        return False

    if _use_redis:
        r = await _get_redis()
        await r.delete(_screen_key(room_id))
    else:
        _room_screen.pop(room_id, None)
    return True


async def clear_room_state(room_id: str):
    if _use_redis:
        r = await _get_redis()
        await r.delete(
            _room_key(room_id),
            _participants_key(room_id),
            _roles_key(room_id),
            _screen_key(room_id),
        )
        return

    _room_states.pop(_room_key(room_id), None)
    _room_participants.pop(_participants_key(room_id), None)
    _room_roles.pop(room_id, None)
    _room_screen.pop(room_id, None)

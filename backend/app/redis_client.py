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
        await _redis.close()
        _redis = None
        logger.info("Redis connection closed")


# --- Key helpers ---
def _room_key(room_id: str) -> str:
    return f"room:{room_id}:state"

def _participants_key(room_id: str) -> str:
    return f"room:{room_id}:participants"


# --- Room State ---

async def get_room_state(room_id: str) -> dict:
    if _use_redis:
        r = await _get_redis()
        state = await r.get(_room_key(room_id))
        if state:
            return json.loads(state)
        return {"timestamp": 0, "is_playing": False, "video_url": ""}

    key = _room_key(room_id)
    state = _room_states.get(key)
    if state:
        return json.loads(state)
    return {"timestamp": 0, "is_playing": False, "video_url": ""}


async def set_room_state(room_id: str, timestamp: float, is_playing: bool, video_url: str = ""):
    state = json.dumps({
        "timestamp": timestamp,
        "is_playing": is_playing,
        "video_url": video_url,
    })

    if _use_redis:
        r = await _get_redis()
        await r.set(_room_key(room_id), state, ex=86400)  # 24h TTL
        return

    _room_states[_room_key(room_id)] = state


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


async def clear_room_state(room_id: str):
    if _use_redis:
        r = await _get_redis()
        await r.delete(_room_key(room_id), _participants_key(room_id))
        return

    _room_states.pop(_room_key(room_id), None)
    _room_participants.pop(_participants_key(room_id), None)

import os
import logging
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "sqlite+aiosqlite:///./syncroom.db"
)

# Render PostgreSQL URLs use postgres:// but SQLAlchemy needs postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)
elif DATABASE_URL.startswith("postgresql://") and "+asyncpg" not in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

# asyncpg doesn't accept libpq-style query params like sslmode/channel_binding.
# Strip them and pass SSL via connect_args instead.
connect_args = {}
if "postgresql+asyncpg" in DATABASE_URL:
    from urllib.parse import urlsplit, urlunsplit
    parts = urlsplit(DATABASE_URL)
    if "sslmode" in parts.query or "channel_binding" in parts.query:
        # Remove the query string; asyncpg handles SSL via connect_args
        DATABASE_URL = urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
        connect_args["ssl"] = True

engine = create_async_engine(DATABASE_URL, echo=False, connect_args=connect_args)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with async_session() as session:
        yield session


async def _run_migration(sql: str, label: str):
    """
    Run a single best-effort DDL statement in its *own* transaction.

    Each statement must be isolated: on PostgreSQL the first failing statement
    (e.g. ADD COLUMN for a column that already exists) aborts the whole
    transaction, so every later statement sharing it fails with "current
    transaction is aborted" — which previously meant the avatar_color widening
    silently never ran on existing databases, and signup 500'd on the too-long
    HSL value. A fresh transaction per statement keeps one caught failure from
    poisoning the rest.
    """
    try:
        async with engine.begin() as conn:
            await conn.execute(text(sql))
        logger.info(f"Migration applied: {label}")
    except Exception:
        pass  # Already applied, or not applicable to this database


async def init_db():
    """Create tables and add any missing columns."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    is_pg = "postgresql" in DATABASE_URL

    # Migrate: add missing columns to rooms table (older schemas predate these).
    for col_name, col_def_pg, col_def_sqlite in [
        ("is_public", "BOOLEAN DEFAULT TRUE", "BOOLEAN DEFAULT 1"),
        ("viewer_count", "INTEGER DEFAULT 0", "INTEGER DEFAULT 0"),
        ("mode", "VARCHAR(20) DEFAULT 'youtube'", "VARCHAR(20) DEFAULT 'youtube'"),
        ("upload_filename", "TEXT DEFAULT NULL", "TEXT DEFAULT NULL"),
    ]:
        col_def = col_def_pg if is_pg else col_def_sqlite
        await _run_migration(
            f"ALTER TABLE rooms ADD COLUMN {col_name} {col_def}",
            f"rooms.{col_name} added",
        )

    # Postgres-only column-type fixes for databases created by older schemas.
    if is_pg:
        # Old deployments created avatar_color as VARCHAR(7) (hex colors), but the
        # auth route now stores generated HSL values such as hsl(222, 70%, 60%).
        await _run_migration(
            "ALTER TABLE users ALTER COLUMN avatar_color TYPE VARCHAR(32)",
            "users.avatar_color widened to VARCHAR(32)",
        )
        # video_url was NOT NULL in the old schema; rooms can now be created
        # without one (screenshare / upload modes).
        await _run_migration(
            "ALTER TABLE rooms ALTER COLUMN video_url DROP NOT NULL",
            "rooms.video_url made nullable",
        )

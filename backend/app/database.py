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


async def init_db():
    """Create tables and add any missing columns."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Migrate: add missing columns to rooms table
    async with engine.begin() as conn:
        for col_name, col_def_pg, col_def_sqlite in [
            ("is_public", "BOOLEAN DEFAULT TRUE", "BOOLEAN DEFAULT 1"),
            ("viewer_count", "INTEGER DEFAULT 0", "INTEGER DEFAULT 0"),
            ("mode", "VARCHAR(20) DEFAULT 'youtube'", "VARCHAR(20) DEFAULT 'youtube'"),
            ("upload_filename", "TEXT DEFAULT NULL", "TEXT DEFAULT NULL"),
        ]:
            try:
                is_pg = "postgresql" in DATABASE_URL
                col_def = col_def_pg if is_pg else col_def_sqlite
                await conn.execute(text(f"ALTER TABLE rooms ADD COLUMN {col_name} {col_def}"))
                logger.info(f"Added column rooms.{col_name}")
            except Exception:
                pass  # Column already exists

        # Make video_url nullable (was NOT NULL in old schema)
        try:
            if "postgresql" in DATABASE_URL:
                await conn.execute(text("ALTER TABLE rooms ALTER COLUMN video_url DROP NOT NULL"))
                logger.info("Made rooms.video_url nullable")
        except Exception:
            pass

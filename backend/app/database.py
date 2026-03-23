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

engine = create_async_engine(DATABASE_URL, echo=False)
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
        ]:
            try:
                is_pg = "postgresql" in DATABASE_URL
                col_def = col_def_pg if is_pg else col_def_sqlite
                await conn.execute(text(f"ALTER TABLE rooms ADD COLUMN {col_name} {col_def}"))
                logger.info(f"Added column rooms.{col_name}")
            except Exception:
                pass  # Column already exists

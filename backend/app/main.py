import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import init_db
from app.redis_client import close_redis
from app.routes import rooms, websocket
from app.routes.auth_routes import router as auth_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    await init_db()
    yield
    await close_redis()


app = FastAPI(title="SyncRoom API", lifespan=lifespan)

# CORS — allow all origins in dev, restrict in production
allowed_origins = os.getenv("CORS_ORIGINS", "*").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins if allowed_origins != ["*"] else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(auth_router)
app.include_router(rooms.router)
app.include_router(websocket.router)


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "syncroom-api"}

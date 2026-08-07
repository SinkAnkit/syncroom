import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.database import init_db
from app.redis_client import close_redis
from app.routes import rooms, websocket
from app.routes.auth_routes import router as auth_router

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    if os.getenv("JWT_SECRET") is None:
        logger.warning(
            "JWT_SECRET is not set — using the built-in development secret. "
            "Set JWT_SECRET in production or every issued token is forgeable."
        )
    await init_db()
    yield
    await close_redis()


app = FastAPI(title="SyncRoom API", lifespan=lifespan)


# Turn unhandled exceptions into a real JSON 500 *before* they reach the CORS
# middleware. Starlette's default ServerErrorMiddleware sits outside CORS, so a
# raw 500 ships with no Access-Control-Allow-Origin header — the browser then
# blocks the response and the frontend only sees an opaque "Failed to fetch",
# hiding the actual server error. This middleware is registered first so the
# CORS middleware (added next) wraps it and can decorate the error response.
@app.middleware("http")
async def catch_unhandled_errors(request, call_next):
    try:
        return await call_next(request)
    except Exception:
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error"},
        )


# CORS — allow all origins in dev, restrict via CORS_ORIGINS in production.
_origins_env = os.getenv("CORS_ORIGINS", "*").strip()
allowed_origins = [o.strip() for o in _origins_env.split(",") if o.strip()]
allow_all = allowed_origins in ([], ["*"])

# "*" together with allow_credentials=True is rejected by every browser: the
# wildcard is not a valid Access-Control-Allow-Origin for credentialed requests.
# Reflect origins with a regex instead so both modes actually work.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[] if allow_all else allowed_origins,
    allow_origin_regex=".*" if allow_all else None,
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

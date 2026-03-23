# SyncRoom

> Watch videos together, perfectly in sync. Real-time synchronized video watching with live chat.

![SyncRoom](https://img.shields.io/badge/Next.js-black?logo=next.js) ![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white) ![Redis](https://img.shields.io/badge/Redis-DC382D?logo=redis&logoColor=white) ![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)

## Features

- **Instant Sync** — Play, pause, seek — everyone stays perfectly synchronized via WebSockets
- **Live Chat** — Real-time chat with message history stored in PostgreSQL
- **One-Click Sharing** — Share room link, no sign-up needed
- **Host Controls** — Room host controls playback, everyone follows
- **Participant Tracking** — Live join/leave notifications with presence tracking via Redis
- **Any YouTube Video** — Paste any YouTube link and watch together

## Architecture

```
┌─────────────────────────────────────────────────┐
│                Client (Browser)                  │
│  YouTube IFrame API + WebSocket + React          │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────┼──────────────────────────┐
│               FastAPI Backend                    │
│  ┌──────────────┐  ┌──────────────┐             │
│  │  REST API    │  │  WebSocket   │             │
│  │  /api/rooms  │  │  /ws/{id}    │             │
│  └──────┬───────┘  └──────┬───────┘             │
│         │                 │                      │
│  ┌──────┴───┐     ┌──────┴───────┐              │
│  │PostgreSQL│     │    Redis     │              │
│  │Rooms,Chat│     │ Live State   │              │
│  └──────────┘     └──────────────┘              │
└──────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js, React, YouTube IFrame API |
| Backend | FastAPI, WebSockets, Uvicorn |
| Database | PostgreSQL (async via SQLAlchemy + asyncpg) |
| Cache | Redis (room state, participant tracking) |
| Deployment | Docker, Docker Compose |

## Quick Start

### Using Docker (Recommended)

```bash
git clone https://github.com/SinkAnkit/syncroom.git
cd syncroom
docker-compose up --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs

### Manual Setup

**Backend:**
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
# Set environment variables
export DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/syncroom
export REDIS_URL=redis://localhost:6379/0
uvicorn app.main:app --reload
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/rooms` | Create a new room |
| `GET` | `/api/rooms/{id}` | Get room details |
| `GET` | `/api/rooms/{id}/messages` | Get chat history (paginated) |
| `GET` | `/api/rooms/{id}/participants` | Get active participants |
| `WS` | `/ws/{room_id}?username=name` | WebSocket for sync + chat |
| `GET` | `/health` | Health check |

## WebSocket Protocol

| Event | Direction | Description |
|-------|-----------|-------------|
| `video:play` | Host → All | Host plays video |
| `video:pause` | Host → All | Host pauses video |
| `video:seek` | Host → All | Host seeks to timestamp |
| `video:state` | Server → Joiner | Sync state for new joiners |
| `chat:message` | Any → All | Chat message broadcast |
| `room:user_joined` | Server → All | User joined notification |
| `room:user_left` | Server → All | User left notification |

## License

MIT

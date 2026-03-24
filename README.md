# SyncRoom

> Watch videos together, perfectly in sync. Real-time synchronized video watching with live chat.

![Next.js](https://img.shields.io/badge/Next.js_16-black?logo=next.js) ![React](https://img.shields.io/badge/React_19-61DAFB?logo=react&logoColor=black) ![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white) ![SQLAlchemy](https://img.shields.io/badge/SQLAlchemy-D71F00?logo=sqlalchemy&logoColor=white) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white) ![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white) ![Redis](https://img.shields.io/badge/Redis-DC382D?logo=redis&logoColor=white) ![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white) ![Vercel](https://img.shields.io/badge/Vercel-000000?logo=vercel&logoColor=white) ![Render](https://img.shields.io/badge/Render-46E3B7?logo=render&logoColor=black)

---

## ✨ Features

### Core
- **Instant Video Sync** — Play, pause, seek — everyone stays perfectly synchronized via WebSockets
- **Live Chat** — Real-time chat with typing indicators, message history persisted in the database
- **Emoji Reactions** — React to moments in real time 🎉
- **Volume Sync** — Host can control volume for the entire room

### Rooms
- **One-Click Room Creation** — Create a room, paste a YouTube link, share the link — no sign-up required
- **Public Room Browser** — Browse active public rooms sorted by viewer count
- **Private Rooms** — Toggle room visibility during creation
- **Live Viewer Count** — Real-time participant count synced to the database

### Authentication & Roles
- **JWT Authentication** — Sign up / log in with email & password (bcrypt-hashed, 72h token expiry)
- **Role-Based Access Control** — Three-tier role system:
  | Role | Video Controls | Kick/Promote | Assigned To |
  |------|:-:|:-:|-------------|
  | **Admin** | ✅ | ✅ | Room creator (host) |
  | **Mod** | ✅ | ❌ | Promoted by admin |
  | **Member** | ❌ | ❌ | Everyone else |
- **User Kick** — Admins can kick disruptive users from the room
- **Guest Access** — Rooms can be joined without an account

### UI / UX
- **Discord-Inspired Design** — Dark, futuristic interface with glassmorphism, smooth gradients, and micro-animations
- **Responsive Layout** — Works on desktop and mobile
- **Toast Notifications** — Non-intrusive pop-ups for events (link copied, role changed, user joined/left)
- **Error Boundaries** — Graceful error handling with recovery UI

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────┐
│                  Client (Browser)                         │
│   Next.js 16 · React 19 · YouTube IFrame API · WebSocket │
└────────────────────────┬─────────────────────────────────┘
                         │  HTTP / WS
┌────────────────────────┼─────────────────────────────────┐
│                  FastAPI Backend                          │
│                                                          │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐  │
│  │  REST API    │  │  WebSocket    │  │  Auth (JWT)  │  │
│  │  /api/rooms  │  │  /ws/{id}     │  │  /api/auth   │  │
│  └──────┬───────┘  └──────┬────────┘  └──────┬───────┘  │
│         │                 │                   │          │
│  ┌──────┴─────────────────┴───────────────────┘          │
│  │                                                       │
│  ▼                                     ▼                 │
│  ┌──────────────┐             ┌──────────────────┐       │
│  │  PostgreSQL  │             │   Redis           │       │
│  │  or SQLite   │             │   or In-Memory    │       │
│  │  (Rooms,     │             │   (Live State,    │       │
│  │   Chat,      │             │    Participants,  │       │
│  │   Users)     │             │    Roles)         │       │
│  └──────────────┘             └──────────────────┘       │
└──────────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, YouTube IFrame API |
| Backend | FastAPI, WebSockets, Uvicorn |
| Auth | JWT (python-jose), bcrypt |
| Database | PostgreSQL (asyncpg) **or** SQLite (aiosqlite) — auto fallback |
| State | Redis **or** in-memory dict — auto fallback |
| Deployment | Vercel (frontend) + Render (backend) |
| Containers | Docker, Docker Compose |

---

## 🚀 Quick Start

### Option 1 — Docker Compose (Full Stack)

```bash
git clone https://github.com/SinkAnkit/syncroom.git
cd syncroom
docker-compose up --build
```

This spins up **PostgreSQL**, **Redis**, **Backend**, and **Frontend** in one command.

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs

---

### Option 2 — Convenience Script (No Docker)

```bash
git clone https://github.com/SinkAnkit/syncroom.git
cd syncroom
chmod +x start.sh
./start.sh
```

Uses SQLite and in-memory state automatically (no Postgres/Redis needed). Shows access URLs for both localhost and LAN (mobile testing).

---

### Option 3 — Manual Setup

**Backend:**
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Optional: set env vars for PostgreSQL / Redis
# export DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/syncroom
# export REDIS_URL=redis://localhost:6379/0
# export JWT_SECRET=your-secret-key

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

> Without `DATABASE_URL` and `REDIS_URL`, the backend falls back to **SQLite** and **in-memory** state automatically.

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

---

## 🌐 Deployment

The project includes ready-to-deploy configurations:

| Service | Platform | Config |
|---------|----------|--------|
| Backend API | [Render](https://render.com) | `render.yaml` |
| Frontend | [Vercel](https://vercel.com) | `frontend/vercel.json` |

**Live URLs:**
- Frontend: Deployed on Vercel with API/WS proxy rewrites pointing to Render
- Backend: Deployed on Render with auto-provisioned PostgreSQL

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection URI | `sqlite+aiosqlite:///./syncroom.db` |
| `REDIS_URL` | Redis connection URI | *(empty — uses in-memory)* |
| `JWT_SECRET` | Secret key for JWT tokens | `syncroom-dev-secret-...` |
| `CORS_ORIGINS` | Comma-separated allowed origins | `*` |

---

## 📡 API Endpoints

### Authentication

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|:----:|
| `POST` | `/api/auth/signup` | Register a new user | ❌ |
| `POST` | `/api/auth/login` | Login with email & password | ❌ |
| `GET` | `/api/auth/me` | Get current user profile | 🔒 |

### Rooms

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|:----:|
| `POST` | `/api/rooms` | Create a new room | Optional |
| `GET` | `/api/rooms` | List recent active rooms | ❌ |
| `GET` | `/api/rooms/public` | List public rooms by popularity | ❌ |
| `GET` | `/api/rooms/{id}` | Get room details | ❌ |
| `DELETE` | `/api/rooms/{id}` | Delete a room (creator only) | 🔒 |
| `GET` | `/api/rooms/{id}/messages` | Get chat history (paginated) | ❌ |

### WebSocket

| Endpoint | Description |
|----------|-------------|
| `WS /ws/{room_id}?username=name` | Real-time sync + chat |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |

---

## 🔌 WebSocket Protocol

### Video Events

| Event | Direction | Description | Requires |
|-------|-----------|-------------|----------|
| `video:play` | Admin/Mod → All | Play video at timestamp | Admin or Mod |
| `video:pause` | Admin/Mod → All | Pause video at timestamp | Admin or Mod |
| `video:seek` | Client → All | Seek to timestamp (auto-syncs play state) | — |
| `video:state` | Server → Client | Full state sync for new joiners | — |
| `video:url_change` | Admin/Mod → All | Change the room's video URL | Admin or Mod |
| `volume:change` | Admin/Mod → All | Sync volume across the room | Admin or Mod |

### Chat Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `chat:message` | Any → All | Broadcast a chat message (persisted) |
| `typing:start` | Any → All | User started typing |
| `typing:stop` | Any → All | User stopped typing |
| `reaction:add` | Any → All | Emoji reaction broadcast |

### Room Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `room:user_joined` | Server → All | User joined notification |
| `room:user_left` | Server → All | User left notification |
| `room:user_kicked` | Admin → All | User was kicked from the room |

### Role Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `role:assigned` | Server → User | Role assigned on join / promotion |
| `role:changed` | Server → All | A user's role was changed |
| `role:kicked` | Server → User | You were kicked from the room |

### System Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `ping` / `pong` | Server ↔ Client | Heartbeat to keep connections alive |
| `error` | Server → Client | Permission denied or invalid action |

---

## 📁 Project Structure

```
syncroom/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app, CORS, lifespan
│   │   ├── auth.py              # JWT utilities, password hashing
│   │   ├── database.py          # SQLAlchemy engine (PG/SQLite)
│   │   ├── models.py            # User, Room, ChatMessage models
│   │   ├── schemas.py           # Pydantic request/response schemas
│   │   ├── redis_client.py      # Redis / in-memory state manager
│   │   └── routes/
│   │       ├── auth_routes.py   # Signup, login, /me
│   │       ├── rooms.py         # Room CRUD + public listing
│   │       └── websocket.py     # WebSocket handler + roles
│   ├── requirements.txt
│   ├── Dockerfile
│   └── runtime.txt
├── frontend/
│   ├── app/
│   │   ├── layout.js            # Root layout + SEO meta
│   │   ├── page.js              # Landing page
│   │   ├── globals.css          # Design system (Discord-inspired)
│   │   ├── login/page.js        # Login page
│   │   ├── signup/page.js       # Sign-up page
│   │   ├── room/[id]/page.js    # Room page (player + chat)
│   │   ├── error.js             # Error page
│   │   └── error-boundary.js    # Error boundary component
│   ├── next.config.mjs          # API proxy rewrites (dev)
│   ├── vercel.json              # Vercel deployment config
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml           # Full-stack orchestration
├── render.yaml                  # Render deployment blueprint
├── start.sh                     # One-command local start script
└── README.md
```

---

## 📄 License

MIT

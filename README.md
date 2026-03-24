# SyncRoom

**Watch videos together in perfect sync** — with live chat, voice chat, and real-time controls.

**Live:** [syncroom-ten.vercel.app](https://syncroom-ten.vercel.app)

---

## Features

| Feature | Description |
|---|---|
| **Instant Sync** | Play, pause, seek — everyone stays perfectly in sync via WebSockets |
| **Live Chat** | Real-time chat with typing indicators and emoji reactions |
| **Voice Chat** | WebRTC peer-to-peer voice — talk live with your watch party |
| **Role System** | Admin, Mod, and Member roles with granular permissions |
| **One-Click Share** | Share a room link — no sign-up required to join |
| **Admin Controls** | Control playback, kick users, promote mods, force-mute members |
| **Auth** | JWT-based signup/login with bcrypt password hashing |
| **Any YouTube Video** | Paste any YouTube link and sync it instantly |

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | **Next.js 16**, React 19, vanilla CSS |
| Backend | **FastAPI** (Python), async WebSocket handler |
| Database | **PostgreSQL** (prod) / SQLite (dev, auto-fallback) |
| Cache | **Redis** (prod) / in-memory (dev, auto-fallback) |
| Voice Chat | **WebRTC** (peer-to-peer mesh) with WS signaling |
| Auth | JWT tokens, bcrypt password hashing |
| Hosting | **Vercel** (frontend) + **Render** (backend + PostgreSQL) |

## Design

- **Discord-inspired dark theme** with deep blacks (`#0b0c0f` out `#22232b`)
- **Glassmorphism** — frosted glass cards, modals, and navbar pill
- **Animated SVG decorations** — headphones, signal rings, waveform equalizer, orbiting dots
- **Neon glow effects** on buttons, feature icons, and focus states
- **Inter font** with 300–900 weight range
- **Particle canvas** with tri-color (blurple/cyan/pink) connected dots
- **Spring-eased animations** with `cubic-bezier(0.34, 1.56, 0.64, 1)`

## 🚀 Quick Start

### Local Development

```bash
# Clone
git clone https://github.com/SinkAnkit/syncroom.git
cd syncroom

# Backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000** — the backend auto-falls back to SQLite + in-memory cache.

### Docker (Full Stack)

```bash
docker-compose up --build
```

Starts PostgreSQL, Redis, backend, and frontend.

## Project Structure

```
syncroom/
├── backend/
│   └── app/
│       ├── main.py              # FastAPI app + lifespan
│       ├── database.py          # PostgreSQL / SQLite
│       ├── redis_client.py      # Redis / in-memory fallback
│       ├── models.py            # SQLAlchemy models (User, Room, Chat)
│       ├── schemas.py           # Pydantic schemas
│       ├── auth.py              # JWT utilities
│       └── routes/
│           ├── rooms.py         # Room CRUD REST API
│           ├── auth_routes.py   # Signup / Login / Profile
│           └── websocket.py     # WS handler (sync + chat + voice)
├── frontend/
│   └── app/
│       ├── layout.js            # Root layout (Inter font)
│       ├── page.js              # Landing page
│       ├── login/page.js        # Login page
│       ├── signup/page.js       # Signup page
│       ├── room/[id]/page.js    # Room page (player + chat + voice)
│       └── globals.css          # Design system (2600+ lines)
├── docker-compose.yml
├── render.yaml                  # Render deployment config
└── start.sh                     # Local dev convenience script
```

## WebSocket Events

| Event | Direction | Description |
|---|---|---|
| `video:play/pause/seek` | bi-dir | Sync video playback |
| `video:url_change` | bi-dir | Change the room video |
| `chat:message` | bi-dir | Send/receive chat |
| `typing:start/stop` | bi-dir | Typing indicators |
| `reaction:add` | bi-dir | Emoji reactions |
| `role:promote/demote/kick` | out | Admin role management |
| `voice:offer/answer/ice` | bi-dir | WebRTC signaling |
| `voice:state` | bi-dir | Mic muted/unmuted status |
| `voice:mute` | out | Admin force-mute |

## Deployment

- **Frontend:** Auto-deploys to Vercel from `main` branch
- **Backend:** Auto-deploys to Render from `main` branch
- **Database:** Managed PostgreSQL on Render
- **No secrets in code** — all config via environment variables

---

by **Sinkant™**

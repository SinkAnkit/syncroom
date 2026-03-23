"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

function getApiUrl() {
  if (typeof window === "undefined") return "http://localhost:8000";
  if (window.location.hostname === "localhost") return "http://localhost:8000";
  return "https://syncroom-joth.onrender.com";
}

export default function Home() {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [formData, setFormData] = useState({ name: "", video_url: "", host_name: "" });
  const [joinData, setJoinData] = useState({ roomId: "", username: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [recentRooms, setRecentRooms] = useState([]);
  const [user, setUser] = useState(null);
  const canvasRef = useRef(null);

  // Load auth state
  useEffect(() => {
    try {
      const stored = localStorage.getItem("syncroom_user");
      if (stored) {
        const u = JSON.parse(stored);
        setUser(u);
        setFormData((f) => ({ ...f, host_name: u.display_name }));
        setJoinData((j) => ({ ...j, username: u.display_name }));
      }
    } catch { }
  }, []);

  // Fetch recent rooms
  useEffect(() => {
    async function fetchRooms() {
      try {
        const res = await fetch(`${getApiUrl()}/api/rooms?limit=6`);
        if (res.ok) {
          const data = await res.json();
          setRecentRooms(data);
        }
      } catch {
        // Ignore — server might not be running
      }
    }
    fetchRooms();
  }, []);

  // Particle background animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let animId;

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    const particles = Array.from({ length: 60 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r: Math.random() * 2 + 0.5,
      alpha: Math.random() * 0.3 + 0.1,
    }));

    function frame() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(124, 92, 252, ${p.alpha})`;
        ctx.fill();
      });

      // Draw connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 150) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(124, 92, 252, ${0.06 * (1 - dist / 150)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      animId = requestAnimationFrame(frame);
    }
    frame();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError("");

    if (!formData.name.trim() || !formData.video_url.trim() || !formData.host_name.trim()) {
      setError("All fields are required");
      return;
    }

    setLoading(true);
    try {
      const headers = { "Content-Type": "application/json" };
      const token = localStorage.getItem("syncroom_token");
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${getApiUrl()}/api/rooms`, {
        method: "POST",
        headers,
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const data = await res.json();
        // FastAPI returns validation errors as array: [{msg: "..."}, ...]
        let errMsg = "Failed to create room";
        if (Array.isArray(data.detail)) {
          errMsg = data.detail.map(e => e.msg).join(", ");
        } else if (typeof data.detail === "string") {
          errMsg = data.detail;
        }
        throw new Error(errMsg);
      }

      const room = await res.json();
      sessionStorage.setItem(`syncroom_user_${room.id}`, formData.host_name);
      sessionStorage.setItem(`syncroom_host_${room.id}`, "true");
      router.push(`/room/${room.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = (e) => {
    e.preventDefault();
    setError("");

    if (!joinData.roomId.trim() || !joinData.username.trim()) {
      setError("All fields are required");
      return;
    }

    sessionStorage.setItem(`syncroom_user_${joinData.roomId}`, joinData.username);
    router.push(`/room/${joinData.roomId}`);
  };

  function formatTimeAgo(isoString) {
    const diff = Date.now() - new Date(isoString).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  return (
    <div className="landing">
      <canvas ref={canvasRef} className="particle-canvas" />
      <div className="landing-bg" />

      {/* Navbar */}
      <nav className="navbar">
        <div className="navbar-logo">
          <div className="navbar-logo-icon">▶</div>
          SyncRoom
        </div>
        <div className="navbar-links">
          <a href="#features">Features</a>
          <a href="#how-it-works">How It Works</a>
          {recentRooms.length > 0 && <a href="#recent">Active Rooms</a>}
        </div>
        <div className="navbar-auth">
          {user ? (
            <>
              <span className="navbar-user">
                <span className="navbar-user-avatar" style={{ background: user.avatar_color || "var(--accent)" }}>
                  {user.display_name.charAt(0).toUpperCase()}
                </span>
                {user.display_name}
              </span>
              <button className="navbar-cta" onClick={() => setShowModal(true)}>
                Create Room
              </button>
              <button className="navbar-logout" onClick={() => {
                localStorage.removeItem("syncroom_token");
                localStorage.removeItem("syncroom_user");
                setUser(null);
              }}>
                Logout
              </button>
            </>
          ) : (
            <>
              <a href="/login" className="navbar-login">Log In</a>
              <a href="/signup" className="navbar-cta">Sign Up</a>
              <button className="navbar-cta" onClick={() => setShowModal(true)}>
                Create Room
              </button>
            </>
          )}
        </div>
      </nav>

      {/* Hero */}
      <section className="hero">
        <div className="hero-badge">
          <span className="hero-badge-dot" />
          Real-time synchronized watching
        </div>

        <h1>
          Watch Videos <br />
          <span className="hero-gradient-text">Together in Sync</span>
        </h1>

        <p>
          Create a room, paste a YouTube link, invite your friends — and watch
          in perfect sync with live chat. No more "3, 2, 1, play!"
        </p>

        <div className="hero-actions">
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            ✦ Create a Room
          </button>
          <button className="btn-secondary" onClick={() => setShowJoinModal(true)}>
            → Join a Room
          </button>
        </div>

        {/* Preview Window */}
        <div className="hero-preview">
          <div className="hero-preview-bar">
            <span className="hero-preview-dot" />
            <span className="hero-preview-dot" />
            <span className="hero-preview-dot" />
            <span className="hero-preview-title">SyncRoom — Movie Night 🎬</span>
          </div>
          <div className="hero-preview-content">
            <div className="hero-preview-video">
              <div className="hero-preview-play">▶</div>
              <div className="hero-preview-controls">
                <div className="hero-preview-progress">
                  <div className="hero-preview-progress-bar" />
                </div>
              </div>
            </div>
            <div className="hero-preview-chat">
              <div className="hero-preview-msg">
                <div className="hero-preview-msg-user">Alex</div>
                <div className="hero-preview-msg-text">This part is so cool! 🔥</div>
              </div>
              <div className="hero-preview-msg">
                <div className="hero-preview-msg-user" style={{ color: "var(--accent-secondary)" }}>Sam</div>
                <div className="hero-preview-msg-text">Wait for the drop at 2:34 😂</div>
              </div>
              <div className="hero-preview-msg">
                <div className="hero-preview-msg-user" style={{ color: "#e879f9" }}>Jordan</div>
                <div className="hero-preview-msg-text">This is way better than counting down!</div>
              </div>
              <div className="hero-preview-msg">
                <div className="hero-preview-msg-user" style={{ color: "#fc5c8c" }}>Maya</div>
                <div className="hero-preview-msg-text">❤️ Can we rewind a bit?</div>
              </div>
              <div className="hero-preview-typing">
                <span /><span /><span />
                Alex is typing...
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="features" id="features">
        <div className="features-header">
          <h2>Everything You Need</h2>
          <p>Simple, fast, and perfectly synchronized</p>
        </div>

        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon feature-icon-purple">⚡</div>
            <h3>Instant Sync</h3>
            <p>
              Play, pause, or seek — everyone stays perfectly in sync via WebSocket
              connections with sub-second latency.
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon feature-icon-green">💬</div>
            <h3>Live Chat</h3>
            <p>
              React in real-time with your friends. Chat messages are delivered
              instantly with typing indicators and emoji reactions.
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon feature-icon-pink">🔗</div>
            <h3>One-Click Sharing</h3>
            <p>
              Share your room link with friends. No sign-up needed — just enter
              a username and start watching.
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon feature-icon-purple">👥</div>
            <h3>See Who's Watching</h3>
            <p>
              Real-time participant list shows who's in the room with live
              join & leave notifications.
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon feature-icon-green">🎬</div>
            <h3>Any YouTube Video</h3>
            <p>
              Paste any YouTube link — music videos, tutorials, podcasts,
              livestreams. If it's on YouTube, you can sync it.
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon feature-icon-pink">🛡️</div>
            <h3>Host Controls</h3>
            <p>
              Room host controls playback and can change videos mid-session.
              Everyone follows in perfect sync.
            </p>
          </div>
        </div>
      </section>

      {/* Recent Rooms */}
      {recentRooms.length > 0 && (
        <section className="recent-rooms" id="recent">
          <div className="features-header">
            <h2>Active Rooms</h2>
            <p>Join an existing watch party</p>
          </div>
          <div className="recent-rooms-grid">
            {recentRooms.map((r) => (
              <div
                key={r.id}
                className="recent-room-card"
                onClick={() => {
                  setJoinData({ ...joinData, roomId: r.id });
                  setShowJoinModal(true);
                }}
              >
                <div className="recent-room-header">
                  <h3>{r.name}</h3>
                  <span className="recent-room-time">{formatTimeAgo(r.created_at)}</span>
                </div>
                <p className="recent-room-host">Hosted by {r.host_name}</p>
                <div className="recent-room-join">Join →</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* How It Works */}
      <section className="how-it-works" id="how-it-works">
        <h2>How It Works</h2>
        <div className="steps">
          <div className="step">
            <div className="step-number">1</div>
            <h3>Create a Room</h3>
            <p>Give your room a name, paste a YouTube video URL, and hit create.</p>
          </div>
          <div className="step">
            <div className="step-number">2</div>
            <h3>Invite Friends</h3>
            <p>Share the room link. Friends just enter their name and they're in.</p>
          </div>
          <div className="step">
            <div className="step-number">3</div>
            <h3>Watch Together</h3>
            <p>Video plays in sync for everyone. Chat alongside and enjoy together!</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="footer-logo">
          <div className="navbar-logo-icon" style={{ width: 28, height: 28, fontSize: "0.85rem" }}>▶</div>
          SyncRoom
        </div>
        <p>Built with Next.js, FastAPI, PostgreSQL, Redis & WebSockets</p>
      </footer>

      {/* Create Room Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>✦ Create a Room</h2>
            <p className="modal-subtitle">Set up your watch party in seconds</p>

            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label>Your Name</label>
                <input
                  type="text"
                  placeholder="Enter your name"
                  value={formData.host_name}
                  onChange={(e) => setFormData({ ...formData, host_name: e.target.value })}
                  maxLength={50}
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label>Room Name</label>
                <input
                  type="text"
                  placeholder="e.g. Friday Movie Night"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  maxLength={100}
                />
              </div>

              <div className="form-group">
                <label>YouTube Video URL</label>
                <input
                  type="text"
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={formData.video_url}
                  onChange={(e) => setFormData({ ...formData, video_url: e.target.value })}
                />
              </div>

              {error && <p className="form-error">{error}</p>}

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={loading}>
                  {loading ? "Creating..." : "Create Room →"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Join Room Modal */}
      {showJoinModal && (
        <div className="modal-overlay" onClick={() => setShowJoinModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>→ Join a Room</h2>
            <p className="modal-subtitle">Enter the room ID shared by your friend</p>

            <form onSubmit={handleJoin}>
              <div className="form-group">
                <label>Your Name</label>
                <input
                  type="text"
                  placeholder="Enter your name"
                  value={joinData.username}
                  onChange={(e) => setJoinData({ ...joinData, username: e.target.value })}
                  maxLength={50}
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label>Room ID</label>
                <input
                  type="text"
                  placeholder="Paste the room ID here"
                  value={joinData.roomId}
                  onChange={(e) => setJoinData({ ...joinData, roomId: e.target.value })}
                />
              </div>

              {error && <p className="form-error">{error}</p>}

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowJoinModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Join Room →
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

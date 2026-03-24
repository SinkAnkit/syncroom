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
  const [formData, setFormData] = useState({ name: "", video_url: "", host_name: "", is_public: true });
  const [joinData, setJoinData] = useState({ roomId: "", username: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [publicRooms, setPublicRooms] = useState([]);
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

  // Fetch public rooms sorted by viewers
  useEffect(() => {
    async function fetchRooms() {
      try {
        const res = await fetch(`${getApiUrl()}/api/rooms/public?limit=12`);
        if (res.ok) {
          const data = await res.json();
          setPublicRooms(data);
        }
      } catch { }
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

    const particles = Array.from({ length: 70 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      r: Math.random() * 2 + 0.5,
      alpha: Math.random() * 0.25 + 0.08,
      hue: Math.random() > 0.5 ? 235 : 170,
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
        ctx.fillStyle = p.hue === 235 ? `rgba(88, 101, 242, ${p.alpha})` : `rgba(0, 212, 170, ${p.alpha * 0.7})`;
        ctx.fill();
      });

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 150) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(88, 101, 242, ${0.05 * (1 - dist / 150)})`;
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
          <div className="navbar-logo-icon">S</div>
          SyncRoom
        </div>
        <div className="navbar-links">
          <a href="#features">Features</a>
          <a href="#how-it-works">How It Works</a>
          {publicRooms.length > 0 && <a href="#popular">Popular Rooms</a>}
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
          in perfect sync with live chat. No more counting down.
        </p>

        <div className="hero-actions">
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            Create a Room
          </button>
          <button className="btn-secondary" onClick={() => setShowJoinModal(true)}>
            Join a Room
          </button>
        </div>

        {/* Preview Window */}
        <div className="hero-preview">
          <div className="hero-preview-bar">
            <span className="hero-preview-dot" />
            <span className="hero-preview-dot" />
            <span className="hero-preview-dot" />
            <span className="hero-preview-title">SyncRoom — Movie Night</span>
          </div>
          <div className="hero-preview-content">
            <div className="hero-preview-video">
              <div className="hero-preview-play">&#9654;</div>
              <div className="hero-preview-controls">
                <div className="hero-preview-progress">
                  <div className="hero-preview-progress-bar" />
                </div>
              </div>
            </div>
            <div className="hero-preview-chat">
              <div className="hero-preview-msg">
                <div className="hero-preview-msg-user" style={{ color: '#5865f2' }}>Alex</div>
                <div className="hero-preview-msg-text">This part is incredible!</div>
              </div>
              <div className="hero-preview-msg">
                <div className="hero-preview-msg-user" style={{ color: '#23a559' }}>Sam</div>
                <div className="hero-preview-msg-text">Wait for the drop at 2:34</div>
              </div>
              <div className="hero-preview-msg">
                <div className="hero-preview-msg-user" style={{ color: '#eb459e' }}>Jordan</div>
                <div className="hero-preview-msg-text">This is way better than counting down!</div>
              </div>
              <div className="hero-preview-msg">
                <div className="hero-preview-msg-user" style={{ color: '#f0b232' }}>Maya</div>
                <div className="hero-preview-msg-text">Can we rewind a bit?</div>
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
            <div className="feature-icon feature-icon-purple">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
            </div>
            <h3>Instant Sync</h3>
            <p>Play, pause, or seek — everyone stays perfectly in sync via WebSocket connections.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon feature-icon-green">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            </div>
            <h3>Live Chat</h3>
            <p>React in real-time with your friends. Messages delivered instantly with typing indicators.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon feature-icon-pink">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
            </div>
            <h3>One-Click Sharing</h3>
            <p>Share your room link with friends. No sign-up needed — just enter a name and start watching.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon feature-icon-purple">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
            </div>
            <h3>Role System</h3>
            <p>Admin, Mod, and Member roles with granular permissions. Manage your room like a pro.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon feature-icon-green">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            </div>
            <h3>Any YouTube Video</h3>
            <p>Paste any YouTube link — music, tutorials, podcasts, livestreams. If it is on YouTube, sync it.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon feature-icon-pink">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
            </div>
            <h3>Admin Controls</h3>
            <p>Admin controls playback and volume. Promote mods, kick members, and manage your room.</p>
          </div>
        </div>
      </section>

      {/* Popular Public Rooms */}
      {publicRooms.length > 0 && (
        <section className="recent-rooms" id="popular">
          <div className="features-header">
            <h2>Popular Rooms</h2>
            <p>Join a public watch party</p>
          </div>
          <div className="recent-rooms-grid">
            {publicRooms.map((r) => (
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
                <div className="recent-room-footer">
                  <span className="recent-room-viewers">
                    <span className="online-dot" />
                    {r.viewer_count} watching
                  </span>
                  {r.is_public && <span className="room-public-badge">PUBLIC</span>}
                </div>
                <div className="recent-room-join">Join</div>
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
            <p>Share the room link. Friends just enter their name and they are in.</p>
          </div>
          <div className="step">
            <div className="step-number">3</div>
            <h3>Watch Together</h3>
            <p>Video plays in sync for everyone. Chat alongside and enjoy together.</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="footer-logo">
          <div className="navbar-logo-icon" style={{ width: 28, height: 28, fontSize: "0.85rem" }}>S</div>
          SyncRoom
        </div>
        <p>Built with Next.js, FastAPI and WebSockets</p>
      </footer>

      {/* Create Room Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create a Room</h2>
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

              <div className="form-group">
                <label>Room Visibility</label>
                <div className="visibility-toggle">
                  <button
                    type="button"
                    className={`visibility-option ${formData.is_public ? "active" : ""}`}
                    onClick={() => setFormData({ ...formData, is_public: true })}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
                    Public
                  </button>
                  <button
                    type="button"
                    className={`visibility-option ${!formData.is_public ? "active" : ""}`}
                    onClick={() => setFormData({ ...formData, is_public: false })}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                    Private
                  </button>
                </div>
              </div>

              {error && <p className="form-error">{error}</p>}

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={loading}>
                  {loading ? "Creating..." : "Create Room"}
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
            <h2>Join a Room</h2>
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
                  Join Room
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

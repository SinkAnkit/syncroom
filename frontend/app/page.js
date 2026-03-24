"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

function getApiUrl() {
  if (typeof window === "undefined") return "http://localhost:8000";
  if (window.location.hostname === "localhost") return "http://localhost:8000";
  return "https://syncroom-joth.onrender.com";
}

/* ── SVG Icons ─────────────────────────────────────── */

const SyncRoomLogo = () => (
  <div className="logo-icon">
    <svg width="36" height="36" viewBox="0 0 48 48" fill="none">
      <defs>
        <linearGradient id="ring1" x1="0" y1="0" x2="48" y2="48">
          <stop offset="0%" stopColor="#7c8aff" />
          <stop offset="100%" stopColor="#5865f2" />
        </linearGradient>
        <linearGradient id="ring2" x1="48" y1="0" x2="0" y2="48">
          <stop offset="0%" stopColor="#00d4aa" />
          <stop offset="100%" stopColor="#5865f2" />
        </linearGradient>
        <linearGradient id="playFill" x1="18" y1="14" x2="34" y2="34">
          <stop offset="0%" stopColor="#fff" />
          <stop offset="100%" stopColor="#c8d0ff" />
        </linearGradient>
      </defs>
      {/* Outer ring */}
      <circle cx="24" cy="24" r="22" stroke="url(#ring1)" strokeWidth="2.5" fill="none" opacity="0.5" />
      {/* Inner ring with rotation */}
      <circle cx="24" cy="24" r="16" stroke="url(#ring2)" strokeWidth="2" fill="none" opacity="0.7" strokeDasharray="12 6" className="logo-ring-spin" />
      {/* Filled center */}
      <circle cx="24" cy="24" r="11" fill="#5865f2" opacity="0.15" />
      {/* Play triangle */}
      <path d="M20 16 L34 24 L20 32Z" fill="url(#playFill)" />
      {/* Orbiting sync dot */}
      <circle cx="44" cy="14" r="3.5" fill="#00d4aa" className="logo-orbit-dot" />
      <circle cx="44" cy="14" r="1.8" fill="#fff" className="logo-orbit-dot" />
    </svg>
  </div>
);

const BoltIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
  </svg>
);

const ChatIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const LinkIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

const UsersIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const PlayIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const ShieldIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const GlobeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const LockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const ArrowRight = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
  </svg>
);

/* ── Floating Mascot SVG ───────────────────────────── */
const HeadphoneMascot = ({ style }) => (
  <div className="floating-mascot" style={style}>
    <svg width="100" height="100" viewBox="0 0 100 100" fill="none">
      <circle cx="50" cy="50" r="40" fill="rgba(88,101,242,0.06)" stroke="rgba(88,101,242,0.12)" strokeWidth="1" />
      <circle cx="50" cy="50" r="28" fill="rgba(88,101,242,0.04)" />
      {/* Headphone shape */}
      <path d="M30 55 Q30 35, 50 30 Q70 35, 70 55" stroke="rgba(124,138,255,0.5)" strokeWidth="3" fill="none" strokeLinecap="round" />
      <rect x="25" y="50" width="10" height="16" rx="4" fill="rgba(124,138,255,0.35)" />
      <rect x="65" y="50" width="10" height="16" rx="4" fill="rgba(124,138,255,0.35)" />
      {/* Sound waves */}
      <path d="M50 42 L50 62" stroke="rgba(0,212,170,0.3)" strokeWidth="2" strokeLinecap="round" className="wave-line-1" />
      <path d="M44 46 L44 58" stroke="rgba(0,212,170,0.2)" strokeWidth="2" strokeLinecap="round" className="wave-line-2" />
      <path d="M56 44 L56 60" stroke="rgba(0,212,170,0.2)" strokeWidth="2" strokeLinecap="round" className="wave-line-3" />
    </svg>
  </div>
);

const SignalRings = ({ style }) => (
  <div className="floating-mascot" style={style}>
    <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
      <circle cx="40" cy="40" r="35" stroke="rgba(0,212,170,0.08)" strokeWidth="1" strokeDasharray="8 4" className="logo-ring-spin" style={{ transformOrigin: '40px 40px' }} />
      <circle cx="40" cy="40" r="24" stroke="rgba(88,101,242,0.12)" strokeWidth="1" strokeDasharray="6 6" className="logo-ring-spin" style={{ transformOrigin: '40px 40px', animationDirection: 'reverse', animationDuration: '12s' }} />
      <circle cx="40" cy="40" r="12" fill="rgba(88,101,242,0.08)" />
      <circle cx="40" cy="40" r="4" fill="rgba(124,138,255,0.25)" className="logo-orbit-dot" />
    </svg>
  </div>
);

const OrbitDots = ({ style }) => (
  <div className="floating-mascot" style={style}>
    <svg width="90" height="90" viewBox="0 0 90 90" fill="none">
      <circle cx="45" cy="45" r="30" stroke="rgba(235,69,158,0.06)" strokeWidth="1" />
      <circle cx="75" cy="45" r="4" fill="rgba(235,69,158,0.25)" className="logo-orbit-dot" />
      <circle cx="45" cy="15" r="3" fill="rgba(88,101,242,0.2)" className="logo-orbit-dot" style={{ animationDelay: '0.5s' }} />
      <circle cx="15" cy="45" r="3.5" fill="rgba(0,212,170,0.2)" className="logo-orbit-dot" style={{ animationDelay: '1s' }} />
      <circle cx="45" cy="75" r="2.5" fill="rgba(124,138,255,0.15)" className="logo-orbit-dot" style={{ animationDelay: '1.5s' }} />
    </svg>
  </div>
);

const WaveformIcon = ({ style }) => (
  <div className="floating-mascot" style={style}>
    <svg width="70" height="50" viewBox="0 0 70 50" fill="none">
      <rect x="5" y="18" width="4" height="14" rx="2" fill="rgba(88,101,242,0.2)" className="wave-bar-1" />
      <rect x="14" y="10" width="4" height="30" rx="2" fill="rgba(0,212,170,0.18)" className="wave-bar-2" />
      <rect x="23" y="14" width="4" height="22" rx="2" fill="rgba(235,69,158,0.15)" className="wave-bar-3" />
      <rect x="32" y="6" width="4" height="38" rx="2" fill="rgba(88,101,242,0.22)" className="wave-bar-4" />
      <rect x="41" y="12" width="4" height="26" rx="2" fill="rgba(0,212,170,0.18)" className="wave-bar-5" />
      <rect x="50" y="16" width="4" height="18" rx="2" fill="rgba(235,69,158,0.15)" className="wave-bar-6" />
      <rect x="59" y="20" width="4" height="10" rx="2" fill="rgba(88,101,242,0.12)" className="wave-bar-7" />
    </svg>
  </div>
);

const SyncArrows = ({ style }) => (
  <div className="floating-mascot" style={style}>
    <svg width="60" height="60" viewBox="0 0 60 60" fill="none" className="logo-ring-spin" style={{ transformOrigin: '30px 30px', animationDuration: '20s' }}>
      <path d="M30 8 L38 16 L30 16 L30 28" stroke="rgba(0,212,170,0.2)" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M30 52 L22 44 L30 44 L30 32" stroke="rgba(88,101,242,0.2)" strokeWidth="2" fill="none" strokeLinecap="round" />
      <circle cx="30" cy="30" r="20" stroke="rgba(88,101,242,0.06)" strokeWidth="1" strokeDasharray="4 4" />
    </svg>
  </div>
);

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

  // Fetch public rooms
  useEffect(() => {
    async function fetchRooms() {
      try {
        const res = await fetch(`${getApiUrl()}/api/rooms/public?limit=12`);
        if (res.ok) setPublicRooms(await res.json());
      } catch { }
    }
    fetchRooms();
  }, []);

  // Particle animation — neon style
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let animId;

    function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
    resize();
    window.addEventListener("resize", resize);

    const particles = Array.from({ length: 80 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      r: Math.random() * 1.8 + 0.4,
      type: Math.random(),
    }));

    function frame() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p) => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        const alpha = 0.15 + Math.sin(Date.now() * 0.001 + p.x * 0.01) * 0.08;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        if (p.type < 0.4) ctx.fillStyle = `rgba(88, 101, 242, ${alpha})`;
        else if (p.type < 0.7) ctx.fillStyle = `rgba(0, 212, 170, ${alpha * 0.7})`;
        else ctx.fillStyle = `rgba(235, 69, 158, ${alpha * 0.5})`;
        ctx.fill();
      });

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 130) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(88, 101, 242, ${0.04 * (1 - dist / 130)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      animId = requestAnimationFrame(frame);
    }
    frame();
    return () => { cancelAnimationFrame(animId); window.removeEventListener("resize", resize); };
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError("");
    if (!formData.name.trim() || !formData.video_url.trim() || !formData.host_name.trim()) {
      setError("All fields are required"); return;
    }
    setLoading(true);
    try {
      const headers = { "Content-Type": "application/json" };
      const token = localStorage.getItem("syncroom_token");
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${getApiUrl()}/api/rooms`, { method: "POST", headers, body: JSON.stringify(formData) });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(Array.isArray(data.detail) ? data.detail.map(e => e.msg).join(", ") : data.detail || "Failed to create room");
      }
      const room = await res.json();
      sessionStorage.setItem(`syncroom_user_${room.id}`, formData.host_name);
      sessionStorage.setItem(`syncroom_host_${room.id}`, "true");
      router.push(`/room/${room.id}`);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  const handleJoin = (e) => {
    e.preventDefault();
    setError("");
    if (!joinData.roomId.trim() || !joinData.username.trim()) { setError("All fields are required"); return; }
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

  const featureCards = [
    { icon: <BoltIcon />, title: "Instant Sync", desc: "Play, pause, seek — everyone stays perfectly in sync via real-time WebSocket connections.", color: "neon-purple" },
    { icon: <ChatIcon />, title: "Live Chat", desc: "React in real-time with typing indicators, emoji reactions, and persistent message history.", color: "neon-cyan" },
    { icon: <LinkIcon />, title: "One-Click Share", desc: "Share your room link — no sign-up required. Just enter a name and start watching.", color: "neon-pink" },
    { icon: <UsersIcon />, title: "Role System", desc: "Admin, Mod, and Member roles with granular video control and moderation permissions.", color: "neon-purple" },
    { icon: <PlayIcon />, title: "Any YouTube Video", desc: "Paste any YouTube link — music, tutorials, podcasts, livestreams. If it's on YouTube, sync it.", color: "neon-cyan" },
    { icon: <ShieldIcon />, title: "Admin Controls", desc: "Control playback, volume, kick users, promote mods — full room management.", color: "neon-pink" },
  ];

  return (
    <div className="landing">
      <canvas ref={canvasRef} className="particle-canvas" />
      <div className="landing-bg" />

      {/* Floating animated SVG decorations */}
      <HeadphoneMascot style={{ position: "absolute", top: "12%", right: "6%", animation: "floatMascot1 14s ease-in-out infinite" }} />
      <SignalRings style={{ position: "absolute", top: "60%", right: "10%", animation: "floatMascot2 18s ease-in-out infinite" }} />
      <OrbitDots style={{ position: "absolute", top: "30%", left: "4%", animation: "floatMascot1 16s ease-in-out infinite", animationDelay: "2s" }} />
      <WaveformIcon style={{ position: "absolute", bottom: "25%", left: "8%", animation: "floatMascot2 13s ease-in-out infinite" }} />
      <SyncArrows style={{ position: "absolute", bottom: "15%", right: "15%", animation: "floatMascot1 20s ease-in-out infinite", animationDelay: "4s" }} />

      {/* Navbar */}
      <nav className="navbar">
        <div className="navbar-logo">
          <SyncRoomLogo />
          <span>SyncRoom</span>
        </div>
        <div className="navbar-auth">
          {user ? (
            <>
              <span className="navbar-user">
                <span className="navbar-user-avatar" style={{ background: user.avatar_color || "var(--blurple)" }}>
                  {user.display_name.charAt(0).toUpperCase()}
                </span>
                {user.display_name}
              </span>
              <button className="navbar-cta" onClick={() => setShowModal(true)}>Create Room</button>
              <button className="navbar-logout" onClick={() => {
                localStorage.removeItem("syncroom_token");
                localStorage.removeItem("syncroom_user");
                setUser(null);
              }}>Logout</button>
            </>
          ) : (
            <>
              <a href="/login" className="navbar-login">Log In</a>
              <a href="/signup" className="navbar-cta">Sign Up</a>
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
          Watch Videos<br />
          <span className="hero-gradient-text">Together in Sync</span>
        </h1>

        <p>
          Create a room, paste a YouTube link, invite your friends — and watch
          in perfect sync with live chat. No more counting down.
        </p>

        <div className="hero-actions">
          <button className="btn-primary btn-glow" onClick={() => setShowModal(true)}>
            Create a Room <ArrowRight />
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
                <div className="hero-preview-msg-user" style={{ color: '#7c8aff' }}>Alex</div>
                <div className="hero-preview-msg-text">This part is incredible!</div>
              </div>
              <div className="hero-preview-msg">
                <div className="hero-preview-msg-user" style={{ color: '#00d4aa' }}>Sam</div>
                <div className="hero-preview-msg-text">Wait for the drop at 2:34</div>
              </div>
              <div className="hero-preview-msg">
                <div className="hero-preview-msg-user" style={{ color: '#eb459e' }}>Jordan</div>
                <div className="hero-preview-msg-text">This is way better than counting down!</div>
              </div>
              <div className="hero-preview-msg">
                <div className="hero-preview-msg-user" style={{ color: '#faa81a' }}>Maya</div>
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
          {featureCards.map((f, i) => (
            <div key={i} className="feature-card" style={{ animationDelay: `${i * 0.08}s` }}>
              <div className={`feature-icon feature-icon-${f.color}`}>{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
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
              <div key={r.id} className="recent-room-card" onClick={() => {
                setJoinData({ ...joinData, roomId: r.id });
                setShowJoinModal(true);
              }}>
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
                <div className="recent-room-join">Join →</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="footer-logo">
              <SyncRoomLogo />
              <span>SyncRoom</span>
            </div>
            <p className="footer-tagline">Watch videos together in perfect sync.<br />Built for friends, powered by WebSockets.</p>
          </div>
          <div className="footer-links-section">
            <div className="footer-col">
              <h4>Product</h4>
              <button onClick={() => setShowModal(true)}>Create Room</button>
              <button onClick={() => setShowJoinModal(true)}>Join Room</button>
            </div>
            <div className="footer-col">
              <h4>Account</h4>
              <a href="/login">Log In</a>
              <a href="/signup">Sign Up</a>
            </div>
            <div className="footer-col">
              <h4>Connect</h4>
              <a href="https://github.com/SinkAnkit/syncroom" target="_blank" rel="noopener noreferrer" className="footer-social-link">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303, -.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" /></svg>
                GitHub
              </a>
              <a href="mailto:ankitsingh92004@gmail.com" className="footer-social-link">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                Contact Me
              </a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <p className="footer-trademark">© {new Date().getFullYear()} SyncRoom — by Sinkant™</p>
        </div>
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
                <input type="text" placeholder="Enter your name" value={formData.host_name}
                  onChange={(e) => setFormData({ ...formData, host_name: e.target.value })} maxLength={50} autoFocus />
              </div>
              <div className="form-group">
                <label>Room Name</label>
                <input type="text" placeholder="e.g. Friday Movie Night" value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })} maxLength={100} />
              </div>
              <div className="form-group">
                <label>YouTube Video URL</label>
                <input type="text" placeholder="https://www.youtube.com/watch?v=..."
                  value={formData.video_url} onChange={(e) => setFormData({ ...formData, video_url: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Room Visibility</label>
                <div className="visibility-toggle">
                  <button type="button" className={`visibility-option ${formData.is_public ? "active" : ""}`}
                    onClick={() => setFormData({ ...formData, is_public: true })}>
                    <GlobeIcon /> Public
                  </button>
                  <button type="button" className={`visibility-option ${!formData.is_public ? "active" : ""}`}
                    onClick={() => setFormData({ ...formData, is_public: false })}>
                    <LockIcon /> Private
                  </button>
                </div>
              </div>
              {error && <p className="form-error">{error}</p>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
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
                <input type="text" placeholder="Enter your name" value={joinData.username}
                  onChange={(e) => setJoinData({ ...joinData, username: e.target.value })} maxLength={50} autoFocus />
              </div>
              <div className="form-group">
                <label>Room ID</label>
                <input type="text" placeholder="Paste the room ID here" value={joinData.roomId}
                  onChange={(e) => setJoinData({ ...joinData, roomId: e.target.value })} />
              </div>
              {error && <p className="form-error">{error}</p>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowJoinModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Join Room</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

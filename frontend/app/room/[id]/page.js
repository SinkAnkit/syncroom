"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";

function getApiUrl() {
    if (typeof window === "undefined") return "http://localhost:8000";
    if (window.location.hostname === "localhost") return "http://localhost:8000";
    return "https://syncroom-joth.onrender.com";
}

function getWsUrl() {
    if (typeof window === "undefined") return "ws://localhost:8000";
    if (window.location.hostname === "localhost") return "ws://localhost:8000";
    return "wss://syncroom-joth.onrender.com";
}

/* ── Utilities ─────────────────────────────────────── */

function extractVideoId(url) {
    if (!url) return null;
    const match = url.match(
        /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/([\w-]+))/
    );
    // fallback for watch?v= format
    const match2 = url.match(/[?&]v=([\w-]+)/);
    return match2 ? match2[1] : (match ? match[1] : null);
}

function formatTime(isoString) {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getUserColor(username) {
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
        hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 70%, 65%)`;
}

const REACTION_EMOJIS = ["❤️", "😂", "🔥", "👏", "😮", "💯"];

// Simple notification sound via Web Audio API
function playNotificationSound(type = "message") {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        if (type === "join") {
            osc.frequency.value = 800;
            gain.gain.value = 0.08;
        } else if (type === "leave") {
            osc.frequency.value = 400;
            gain.gain.value = 0.06;
        } else {
            osc.frequency.value = 600;
            gain.gain.value = 0.05;
        }

        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.stop(ctx.currentTime + 0.15);
    } catch {
        // Audio not available
    }
}


/* ── Component ─────────────────────────────────────── */

export default function RoomPage() {
    const { id: roomId } = useParams();
    const router = useRouter();

    const [room, setRoom] = useState(null);
    const [username, setUsername] = useState("");
    const [isHost, setIsHost] = useState(false);
    const [joined, setJoined] = useState(false);
    const [joinName, setJoinName] = useState("");
    const [messages, setMessages] = useState([]);
    const [participants, setParticipants] = useState([]);
    const [chatInput, setChatInput] = useState("");
    const [toast, setToast] = useState("");
    const [connectionState, setConnectionState] = useState("disconnected"); // connected | reconnecting | disconnected
    const [error, setError] = useState("");
    const [typingUsers, setTypingUsers] = useState([]);
    const [reactions, setReactions] = useState({}); // { messageId: { emoji: count } }
    const [showVideoModal, setShowVideoModal] = useState(false);
    const [newVideoUrl, setNewVideoUrl] = useState("");
    const [showNewMsgPill, setShowNewMsgPill] = useState(false);
    const [activeReactionPicker, setActiveReactionPicker] = useState(null);
    const [roomIdCopied, setRoomIdCopied] = useState(false);

    const wsRef = useRef(null);
    const playerRef = useRef(null);
    const chatEndRef = useRef(null);
    const chatContainerRef = useRef(null);
    const ignoreNextEvent = useRef(false);
    const playerReady = useRef(false);
    const reconnectAttempt = useRef(0);
    const reconnectTimer = useRef(null);
    const typingTimeout = useRef(null);
    const isTyping = useRef(false);
    const isUserNearBottom = useRef(true);

    /* ── Fetch room info ─────────────────────────── */
    useEffect(() => {
        async function fetchRoom() {
            try {
                const res = await fetch(`${getApiUrl()}/api/rooms/${roomId}`);
                if (!res.ok) {
                    setError("Room not found");
                    return;
                }
                const data = await res.json();
                setRoom(data);

                const storedUser = sessionStorage.getItem(`syncroom_user_${roomId}`);
                const storedHost = sessionStorage.getItem(`syncroom_host_${roomId}`);
                if (storedUser) {
                    setUsername(storedUser);
                    setIsHost(storedHost === "true");
                    setJoined(true);
                }
            } catch {
                setError("Failed to connect to server");
            }
        }
        fetchRoom();
    }, [roomId]);

    /* ── Fetch chat history ───────────────────────── */
    useEffect(() => {
        if (!joined) return;
        async function fetchMessages() {
            try {
                const res = await fetch(`${getApiUrl()}/api/rooms/${roomId}/messages`);
                if (res.ok) {
                    const data = await res.json();
                    setMessages(data.map((m) => ({ ...m, type: "chat:message" })));
                }
            } catch {
                // ignore
            }
        }
        fetchMessages();
    }, [roomId, joined]);

    /* ── Load YouTube IFrame API ──────────────────── */
    useEffect(() => {
        if (!joined || !room) return;

        if (window.YT && window.YT.Player) {
            initPlayer();
            return;
        }

        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(tag);

        window.onYouTubeIframeAPIReady = () => {
            initPlayer();
        };

        return () => {
            window.onYouTubeIframeAPIReady = null;
        };
    }, [joined, room]);

    function initPlayer() {
        const videoId = extractVideoId(room?.video_url);
        if (!videoId) return;
        if (playerRef.current) return;

        playerRef.current = new window.YT.Player("yt-player", {
            videoId,
            width: "100%",
            height: "100%",
            playerVars: {
                autoplay: 0,
                controls: isHost ? 1 : 0,
                modestbranding: 1,
                rel: 0,
            },
            events: {
                onReady: () => {
                    playerReady.current = true;
                },
                onStateChange: (event) => {
                    if (!isHost) return;
                    if (ignoreNextEvent.current) {
                        ignoreNextEvent.current = false;
                        return;
                    }

                    const currentTime = event.target.getCurrentTime();

                    if (event.data === window.YT.PlayerState.PLAYING) {
                        sendWsMessage({ type: "video:play", timestamp: currentTime });
                    } else if (event.data === window.YT.PlayerState.PAUSED) {
                        sendWsMessage({ type: "video:pause", timestamp: currentTime });
                    }
                },
            },
        });

        // Track seeking for host
        if (isHost) {
            let lastTime = 0;
            setInterval(() => {
                if (!playerRef.current || !playerReady.current) return;
                try {
                    const currentTime = playerRef.current.getCurrentTime();
                    const state = playerRef.current.getPlayerState();
                    if (state === window.YT.PlayerState.PLAYING) {
                        if (Math.abs(currentTime - lastTime) > 2) {
                            sendWsMessage({ type: "video:seek", timestamp: currentTime });
                        }
                    }
                    lastTime = currentTime;
                } catch {
                    // player not ready
                }
            }, 1000);
        }
    }

    /* ── WebSocket with auto-reconnect ────────────── */
    const connectWs = useCallback(() => {
        if (!joined || !username) return;

        const ws = new WebSocket(`${getWsUrl()}/ws/${roomId}?username=${encodeURIComponent(username)}`);
        wsRef.current = ws;

        ws.onopen = () => {
            setConnectionState("connected");
            reconnectAttempt.current = 0;
        };

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);

            switch (msg.type) {
                case "ping":
                    ws.send(JSON.stringify({ type: "pong" }));
                    break;

                case "video:play":
                    if (!isHost && playerRef.current && playerReady.current) {
                        ignoreNextEvent.current = true;
                        playerRef.current.seekTo(msg.timestamp, true);
                        playerRef.current.playVideo();
                    }
                    setMessages((prev) => [
                        ...prev,
                        { type: "system", content: `${msg.username} played the video` },
                    ]);
                    break;

                case "video:pause":
                    if (!isHost && playerRef.current && playerReady.current) {
                        ignoreNextEvent.current = true;
                        playerRef.current.seekTo(msg.timestamp, true);
                        playerRef.current.pauseVideo();
                    }
                    setMessages((prev) => [
                        ...prev,
                        { type: "system", content: `${msg.username} paused the video` },
                    ]);
                    break;

                case "video:seek":
                    if (!isHost && playerRef.current && playerReady.current) {
                        ignoreNextEvent.current = true;
                        playerRef.current.seekTo(msg.timestamp, true);
                    }
                    break;

                case "video:state":
                    if (!isHost && playerRef.current && playerReady.current) {
                        ignoreNextEvent.current = true;
                        playerRef.current.seekTo(msg.timestamp, true);
                        if (msg.is_playing) {
                            playerRef.current.playVideo();
                        } else {
                            playerRef.current.pauseVideo();
                        }
                    }
                    break;

                case "video:url_change":
                    if (playerRef.current && playerReady.current) {
                        const newId = extractVideoId(msg.video_url);
                        if (newId) {
                            playerRef.current.loadVideoById(newId);
                        }
                    }
                    setMessages((prev) => [
                        ...prev,
                        { type: "system", content: `${msg.username} changed the video` },
                    ]);
                    break;

                case "chat:message":
                    setMessages((prev) => [...prev, { ...msg, type: "chat:message" }]);
                    if (!isUserNearBottom.current) {
                        setShowNewMsgPill(true);
                    }
                    playNotificationSound("message");
                    break;

                case "room:user_joined":
                    setParticipants(msg.participants);
                    setMessages((prev) => [
                        ...prev,
                        { type: "system", content: `${msg.username} joined the room` },
                    ]);
                    playNotificationSound("join");
                    break;

                case "room:user_left":
                    setParticipants(msg.participants);
                    setMessages((prev) => [
                        ...prev,
                        { type: "system", content: `${msg.username} left the room` },
                    ]);
                    playNotificationSound("leave");
                    break;

                case "typing:start":
                    setTypingUsers((prev) =>
                        prev.includes(msg.username) ? prev : [...prev, msg.username]
                    );
                    break;

                case "typing:stop":
                    setTypingUsers((prev) => prev.filter((u) => u !== msg.username));
                    break;

                case "reaction:add":
                    setReactions((prev) => {
                        const msgReactions = { ...(prev[msg.message_id] || {}) };
                        msgReactions[msg.emoji] = (msgReactions[msg.emoji] || 0) + 1;
                        return { ...prev, [msg.message_id]: msgReactions };
                    });
                    break;
            }
        };

        ws.onclose = () => {
            setConnectionState("reconnecting");
            // Exponential backoff reconnect
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempt.current), 30000);
            reconnectAttempt.current++;
            if (reconnectAttempt.current <= 10) {
                reconnectTimer.current = setTimeout(connectWs, delay);
            } else {
                setConnectionState("disconnected");
            }
        };

        ws.onerror = () => {
            // onclose will fire after this
        };
    }, [joined, username, roomId, isHost]);

    useEffect(() => {
        connectWs();
        return () => {
            if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
            if (wsRef.current) wsRef.current.close();
        };
    }, [connectWs]);

    /* ── Auto-scroll / new msg detection ──────────── */
    useEffect(() => {
        if (isUserNearBottom.current) {
            chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    }, [messages]);

    function handleChatScroll() {
        const el = chatContainerRef.current;
        if (!el) return;
        const isNear = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        isUserNearBottom.current = isNear;
        if (isNear) setShowNewMsgPill(false);
    }

    function scrollToBottom() {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
        setShowNewMsgPill(false);
    }

    /* ── WS helpers ───────────────────────────────── */
    function sendWsMessage(msg) {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(msg));
        }
    }

    function handleSendChat(e) {
        e.preventDefault();
        if (!chatInput.trim()) return;
        sendWsMessage({ type: "chat:message", content: chatInput.trim() });
        setChatInput("");
        // Stop typing
        if (isTyping.current) {
            sendWsMessage({ type: "typing:stop" });
            isTyping.current = false;
        }
    }

    function handleChatInputChange(e) {
        setChatInput(e.target.value);

        // Typing indicator
        if (!isTyping.current && e.target.value.trim()) {
            isTyping.current = true;
            sendWsMessage({ type: "typing:start" });
        }
        if (typingTimeout.current) clearTimeout(typingTimeout.current);
        typingTimeout.current = setTimeout(() => {
            if (isTyping.current) {
                isTyping.current = false;
                sendWsMessage({ type: "typing:stop" });
            }
        }, 2000);
    }

    function handleJoin(e) {
        e.preventDefault();
        if (!joinName.trim()) return;
        setUsername(joinName.trim());
        sessionStorage.setItem(`syncroom_user_${roomId}`, joinName.trim());
        setJoined(true);
    }

    function handleCopyLink() {
        navigator.clipboard.writeText(window.location.href);
        setToast("Link copied!");
        setTimeout(() => setToast(""), 2500);
    }

    function handleCopyRoomId() {
        navigator.clipboard.writeText(roomId);
        setRoomIdCopied(true);
        setTimeout(() => setRoomIdCopied(false), 2000);
    }

    function handleChangeVideo(e) {
        e.preventDefault();
        if (!newVideoUrl.trim()) return;
        sendWsMessage({ type: "video:url_change", video_url: newVideoUrl.trim() });
        setNewVideoUrl("");
        setShowVideoModal(false);
        setToast("Video changed!");
        setTimeout(() => setToast(""), 2500);
    }

    function handleReaction(messageId, emoji) {
        sendWsMessage({ type: "reaction:add", message_id: messageId, emoji });
        setActiveReactionPicker(null);
    }

    /* ── Keyboard shortcuts ───────────────────────── */
    useEffect(() => {
        function handleKeyDown(e) {
            // Space to play/pause (host only, when not focused on input)
            if (isHost && e.code === "Space" && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
                e.preventDefault();
                if (playerRef.current && playerReady.current) {
                    const state = playerRef.current.getPlayerState();
                    if (state === window.YT.PlayerState.PLAYING) {
                        playerRef.current.pauseVideo();
                    } else {
                        playerRef.current.playVideo();
                    }
                }
            }
        }
        if (joined) {
            window.addEventListener("keydown", handleKeyDown);
            return () => window.removeEventListener("keydown", handleKeyDown);
        }
    }, [joined, isHost]);

    /* ── Error screen ─────────────────────────────── */
    if (error) {
        return (
            <div className="loading-screen">
                <div style={{ textAlign: "center" }}>
                    <div className="error-icon">⚠️</div>
                    <h2 style={{ marginBottom: 12 }}>{error}</h2>
                    <p style={{ color: "var(--text-secondary)", marginBottom: 24 }}>
                        The room you're looking for doesn't exist or has been deleted.
                    </p>
                    <button className="btn-primary" onClick={() => router.push("/")}>
                        ← Go Home
                    </button>
                </div>
            </div>
        );
    }

    /* ── Loading skeleton ─────────────────────────── */
    if (!room) {
        return (
            <div className="loading-screen">
                <div className="loading-content">
                    <div className="spinner" />
                    <p style={{ color: "var(--text-secondary)", marginTop: 16 }}>Loading room...</p>
                </div>
            </div>
        );
    }

    /* ── Join screen ──────────────────────────────── */
    if (!joined) {
        return (
            <div className="join-screen">
                <div className="join-card">
                    <div className="join-card-icon">🎬</div>
                    <h1>Join Watch Party</h1>
                    <p className="join-card-room">📺 {room.name}</p>
                    <p className="join-card-host">Hosted by {room.host_name}</p>

                    <form onSubmit={handleJoin}>
                        <div className="form-group">
                            <label>Your Name</label>
                            <input
                                type="text"
                                placeholder="Enter your name to join"
                                value={joinName}
                                onChange={(e) => setJoinName(e.target.value)}
                                maxLength={50}
                                autoFocus
                            />
                        </div>
                        <button type="submit" className="btn-primary" style={{ width: "100%", justifyContent: "center" }}>
                            Join Room →
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    /* ── Room view ────────────────────────────────── */
    return (
        <div className="room-page">
            {/* Connection Status Banner */}
            {connectionState !== "connected" && (
                <div className={`connection-banner ${connectionState}`}>
                    {connectionState === "reconnecting" && (
                        <>
                            <div className="connection-spinner" />
                            Reconnecting...
                        </>
                    )}
                    {connectionState === "disconnected" && (
                        <>
                            ⚠️ Disconnected — <button onClick={connectWs}>Retry</button>
                        </>
                    )}
                </div>
            )}

            {/* Header */}
            <header className="room-header">
                <div className="room-header-left">
                    <button className="room-header-back" onClick={() => router.push("/")}>
                        ← Home
                    </button>
                    <div className="room-header-info">
                        <h1>{room.name}</h1>
                        <span>
                            Hosted by {room.host_name}
                            {isHost && " (you)"}
                        </span>
                    </div>
                </div>
                <div className="room-header-right">
                    <div className="room-participants-badge">
                        <span className="online-dot" />
                        {participants.length} watching
                    </div>
                    <button className="room-id-btn" onClick={handleCopyRoomId} title="Copy Room ID">
                        {roomIdCopied ? "✓ Copied" : `ID: ${roomId.slice(0, 8)}...`}
                    </button>
                    <button className="room-share-btn" onClick={handleCopyLink}>
                        📋 Share
                    </button>
                    {isHost && (
                        <button className="room-video-btn" onClick={() => setShowVideoModal(true)} title="Change Video">
                            🎬 Change Video
                        </button>
                    )}
                </div>
            </header>

            {/* Content */}
            <div className="room-content">
                {/* Video Area */}
                <div className="room-video-area">
                    <div className="video-container">
                        <div id="yt-player" />
                    </div>
                </div>

                {/* Chat Sidebar */}
                <aside className="chat-sidebar">
                    {/* Participants */}
                    <div className="participants-panel">
                        <h4>In This Room</h4>
                        <div className="participants-list">
                            {participants.map((p) => (
                                <span
                                    key={p}
                                    className={`participant-tag ${p === room.host_name ? "host" : ""}`}
                                >
                                    <span
                                        className="participant-avatar"
                                        style={{ background: getUserColor(p) }}
                                    >
                                        {p.charAt(0).toUpperCase()}
                                    </span>
                                    {p}
                                    {p === room.host_name && " ★"}
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* Chat */}
                    <div className="chat-header">
                        <h3>💬 Chat</h3>
                        <span className={`chat-status ${connectionState}`}>
                            {connectionState === "connected" ? "● Connected" : connectionState === "reconnecting" ? "● Reconnecting..." : "● Offline"}
                        </span>
                    </div>

                    <div
                        className="chat-messages"
                        ref={chatContainerRef}
                        onScroll={handleChatScroll}
                    >
                        {messages.length === 0 && (
                            <div className="chat-empty">
                                <div className="chat-empty-icon">💬</div>
                                <p>No messages yet</p>
                                <p className="chat-empty-sub">Be the first to say something!</p>
                            </div>
                        )}
                        {messages.map((msg, i) => {
                            if (msg.type === "system") {
                                return (
                                    <div key={i} className="chat-msg-system">
                                        {msg.content}
                                    </div>
                                );
                            }
                            const msgReactions = reactions[msg.id] || {};
                            return (
                                <div key={msg.id || i} className="chat-msg">
                                    <div className="chat-msg-header">
                                        <span
                                            className="chat-msg-user"
                                            style={{ color: getUserColor(msg.username) }}
                                        >
                                            {msg.username}
                                            {msg.username === room.host_name && " ★"}
                                        </span>
                                        {msg.created_at && (
                                            <span className="chat-msg-time">
                                                {formatTime(msg.created_at)}
                                            </span>
                                        )}
                                    </div>
                                    <div className="chat-msg-content">
                                        {msg.content}
                                        <button
                                            className="chat-msg-react-btn"
                                            onClick={() =>
                                                setActiveReactionPicker(
                                                    activeReactionPicker === msg.id ? null : msg.id
                                                )
                                            }
                                        >
                                            😊
                                        </button>
                                    </div>

                                    {/* Reaction picker */}
                                    {activeReactionPicker === msg.id && (
                                        <div className="reaction-picker">
                                            {REACTION_EMOJIS.map((emoji) => (
                                                <button
                                                    key={emoji}
                                                    onClick={() => handleReaction(msg.id, emoji)}
                                                >
                                                    {emoji}
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {/* Reactions display */}
                                    {Object.keys(msgReactions).length > 0 && (
                                        <div className="reaction-display">
                                            {Object.entries(msgReactions).map(([emoji, count]) => (
                                                <span
                                                    key={emoji}
                                                    className="reaction-badge"
                                                    onClick={() => handleReaction(msg.id, emoji)}
                                                >
                                                    {emoji} {count}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        <div ref={chatEndRef} />
                    </div>

                    {/* Typing indicator */}
                    {typingUsers.length > 0 && (
                        <div className="typing-indicator">
                            <div className="typing-dots">
                                <span /><span /><span />
                            </div>
                            {typingUsers.length === 1
                                ? `${typingUsers[0]} is typing...`
                                : `${typingUsers.length} people are typing...`}
                        </div>
                    )}

                    {/* New message pill */}
                    {showNewMsgPill && (
                        <button className="new-msg-pill" onClick={scrollToBottom}>
                            ↓ New messages
                        </button>
                    )}

                    <form className="chat-input-area" onSubmit={handleSendChat}>
                        <input
                            type="text"
                            placeholder="Type a message..."
                            value={chatInput}
                            onChange={handleChatInputChange}
                            maxLength={500}
                        />
                        <button
                            type="submit"
                            className="chat-send-btn"
                            disabled={!chatInput.trim() || connectionState !== "connected"}
                        >
                            Send
                        </button>
                    </form>
                </aside>
            </div>

            {/* Video URL Change Modal */}
            {showVideoModal && (
                <div className="modal-overlay" onClick={() => setShowVideoModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h2>🎬 Change Video</h2>
                        <p className="modal-subtitle">Paste a new YouTube URL to switch the video for everyone</p>
                        <form onSubmit={handleChangeVideo}>
                            <div className="form-group">
                                <label>YouTube Video URL</label>
                                <input
                                    type="text"
                                    placeholder="https://www.youtube.com/watch?v=..."
                                    value={newVideoUrl}
                                    onChange={(e) => setNewVideoUrl(e.target.value)}
                                    autoFocus
                                />
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="btn-secondary" onClick={() => setShowVideoModal(false)}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn-primary">
                                    Change Video
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Toast */}
            {toast && <div className="toast">{toast}</div>}
        </div>
    );
}

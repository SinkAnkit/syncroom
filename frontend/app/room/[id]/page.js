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
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\s?]+)/,
        /^([a-zA-Z0-9_-]{11})$/,
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m) return m[1];
    }
    return null;
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

function getRoleBadge(role) {
    if (role === "admin") return { label: "ADMIN", className: "role-badge-admin" };
    if (role === "mod") return { label: "MOD", className: "role-badge-mod" };
    return null;
}

function normalizeParticipants(list) {
    if (!Array.isArray(list)) return [];
    return list.map((p) => {
        if (typeof p === "string") return { username: p, role: "member" };
        if (p && typeof p === "object" && p.username) return p;
        return { username: String(p || "Unknown"), role: "member" };
    });
}


/* ── Component ─────────────────────────────────────── */

export default function RoomPage() {
    const { id: roomId } = useParams();
    const router = useRouter();

    const [room, setRoom] = useState(null);
    const [username, setUsername] = useState("");
    const [myRole, setMyRole] = useState("member");
    const [joined, setJoined] = useState(false);
    const [joinName, setJoinName] = useState("");
    const [messages, setMessages] = useState([]);
    const [participants, setParticipants] = useState([]);
    const [chatInput, setChatInput] = useState("");
    const [toast, setToast] = useState("");
    const [connectionState, setConnectionState] = useState("disconnected");
    const [error, setError] = useState("");
    const [typingUsers, setTypingUsers] = useState([]);
    const [showVideoModal, setShowVideoModal] = useState(false);
    const [newVideoUrl, setNewVideoUrl] = useState("");
    const [roomIdCopied, setRoomIdCopied] = useState(false);
    const [volume, setVolume] = useState(80);
    const [contextMenu, setContextMenu] = useState(null);
    const [voiceActive, setVoiceActive] = useState(false);
    const [voiceMuted, setVoiceMuted] = useState(true);
    const [voiceUsers, setVoiceUsers] = useState({}); // { username: { muted, active } }

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
    const peerConnections = useRef({});
    const localStream = useRef(null);
    const remoteAudios = useRef({});

    const canControlVideo = myRole === "admin" || myRole === "mod";
    const canModerate = myRole === "admin";

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
                    if (storedHost === "true") setMyRole("admin");
                    setJoined(true);
                    return;
                }

                try {
                    const authUser = localStorage.getItem("syncroom_user");
                    if (authUser) {
                        const u = JSON.parse(authUser);
                        setJoinName(u.display_name || "");
                    }
                } catch { }
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
            } catch { }
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
        if (!videoId || playerRef.current) return;

        playerRef.current = new window.YT.Player("yt-player", {
            videoId,
            playerVars: { autoplay: 1, controls: 1, modestbranding: 1, rel: 0 },
            events: {
                onReady: (e) => {
                    playerReady.current = true;
                    e.target.setVolume(volume);
                    // Auto-play on load
                    e.target.playVideo();
                },
                onStateChange: handlePlayerStateChange,
            },
        });
    }

    function handlePlayerStateChange(event) {
        if (ignoreNextEvent.current) {
            ignoreNextEvent.current = false;
            return;
        }
        if (!canControlVideo) return;

        const state = event.data;
        const currentTime = playerRef.current?.getCurrentTime() || 0;

        if (state === window.YT.PlayerState.PLAYING) {
            sendWsMessage({ type: "video:play", timestamp: currentTime });
        } else if (state === window.YT.PlayerState.PAUSED) {
            sendWsMessage({ type: "video:pause", timestamp: currentTime });
        }

        // Detect seeking
        if (state === window.YT.PlayerState.BUFFERING) {
            setTimeout(() => {
                if (playerRef.current) {
                    const newTime = playerRef.current.getCurrentTime();
                    if (Math.abs(newTime - currentTime) > 2) {
                        sendWsMessage({ type: "video:seek", timestamp: newTime });
                    }
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

        ws.onmessage = async (event) => {
            const msg = JSON.parse(event.data);

            switch (msg.type) {
                case "ping":
                    ws.send(JSON.stringify({ type: "pong" }));
                    break;

                case "role:assigned":
                    setMyRole(msg.role);
                    showToast(`Your role is now: ${msg.role.toUpperCase()}`);
                    break;

                case "video:play":
                    if (playerRef.current && playerReady.current) {
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
                    if (playerRef.current && playerReady.current) {
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
                    if (playerRef.current && playerReady.current) {
                        ignoreNextEvent.current = true;
                        playerRef.current.seekTo(msg.timestamp, true);
                    }
                    break;

                case "video:state":
                    if (playerRef.current && playerReady.current) {
                        ignoreNextEvent.current = true;
                        playerRef.current.seekTo(msg.timestamp, true);
                        if (msg.is_playing) {
                            playerRef.current.playVideo();
                        } else {
                            playerRef.current.pauseVideo();
                        }
                    }
                    if (msg.volume !== undefined) {
                        setVolume(msg.volume);
                        if (playerRef.current && playerReady.current) {
                            playerRef.current.setVolume(msg.volume);
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

                case "volume:change":
                    setVolume(msg.volume);
                    if (playerRef.current && playerReady.current) {
                        playerRef.current.setVolume(msg.volume);
                    }
                    break;

                case "chat:message":
                    setMessages((prev) => [...prev, { ...msg, type: "chat:message" }]);
                    break;

                case "room:user_joined":
                    setParticipants(normalizeParticipants(msg.participants));
                    setMessages((prev) => [
                        ...prev,
                        { type: "system", content: `${msg.username} joined the room` },
                    ]);
                    break;

                case "room:user_left":
                    setParticipants(normalizeParticipants(msg.participants));
                    setMessages((prev) => [
                        ...prev,
                        { type: "system", content: `${msg.username} left the room` },
                    ]);
                    break;

                case "room:user_kicked":
                    setParticipants(normalizeParticipants(msg.participants));
                    setMessages((prev) => [
                        ...prev,
                        { type: "system", content: `${msg.username} was kicked by ${msg.by}` },
                    ]);
                    break;

                case "role:changed":
                    setParticipants(normalizeParticipants(msg.participants));
                    setMessages((prev) => [
                        ...prev,
                        { type: "system", content: `${msg.target} is now ${msg.new_role}` },
                    ]);
                    break;

                case "role:kicked":
                    // Close WebSocket immediately
                    if (wsRef.current) {
                        wsRef.current.onclose = null;  // prevent auto-reconnect
                        wsRef.current.close();
                        wsRef.current = null;
                    }
                    setJoined(false);
                    alert("You have been kicked from the room.");
                    router.push("/");
                    break;

                case "error":
                    showToast(msg.message || "An error occurred");
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
                    break;

                // ── Voice Chat WebRTC Signaling ──
                case "voice:offer": {
                    const pc = createPeer(msg.from, false);
                    await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);
                    sendWsMessage({ type: "voice:answer", target: msg.from, sdp: answer });
                    break;
                }
                case "voice:answer": {
                    const pc = peerConnections.current[msg.from];
                    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
                    break;
                }
                case "voice:ice": {
                    const pc = peerConnections.current[msg.from];
                    if (pc && msg.candidate) {
                        await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
                    }
                    break;
                }
                case "voice:state":
                    setVoiceUsers(prev => ({
                        ...prev,
                        [msg.username]: { muted: msg.muted, active: msg.active }
                    }));
                    break;
                case "voice:force_mute":
                    // Admin force-muted us
                    if (localStream.current) {
                        localStream.current.getAudioTracks().forEach(t => t.enabled = false);
                    }
                    setVoiceMuted(true);
                    showToast(`You were muted by ${msg.by}`);
                    sendWsMessage({ type: "voice:state", muted: true, active: voiceActive });
                    break;
            }
        };

        ws.onclose = () => {
            setConnectionState("reconnecting");
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempt.current), 30000);
            reconnectAttempt.current++;
            if (reconnectAttempt.current <= 10) {
                reconnectTimer.current = setTimeout(connectWs, delay);
            } else {
                setConnectionState("disconnected");
            }
        };

        ws.onerror = () => { };
    }, [joined, username, roomId]);

    useEffect(() => {
        connectWs();
        return () => {
            if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
            if (wsRef.current) wsRef.current.close();
        };
    }, [connectWs]);

    /* ── Auto-scroll ─────────────────────────────── */
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
    }

    /* ── Helpers ─────────────────────────────────── */
    function sendWsMessage(msg) {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(msg));
        }
    }

    function showToast(text) {
        setToast(text);
        setTimeout(() => setToast(""), 3000);
    }

    function handleSendMessage(e) {
        e.preventDefault();
        if (!chatInput.trim()) return;
        sendWsMessage({ type: "chat:message", content: chatInput.trim() });
        setChatInput("");
        if (isTyping.current) {
            isTyping.current = false;
            sendWsMessage({ type: "typing:stop" });
        }
    }

    function handleTyping() {
        if (!isTyping.current) {
            isTyping.current = true;
            sendWsMessage({ type: "typing:start" });
        }
        clearTimeout(typingTimeout.current);
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
        showToast("Link copied");
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
        showToast("Video changed");
    }

    function handleVolumeChange(val) {
        const v = parseInt(val);
        setVolume(v);
        if (playerRef.current && playerReady.current) {
            playerRef.current.setVolume(v);
        }
        if (canControlVideo) {
            sendWsMessage({ type: "volume:change", volume: v });
        }
    }

    function handleKick(target) {
        sendWsMessage({ type: "role:kick", target });
        setContextMenu(null);
    }

    function handlePromote(target, role) {
        sendWsMessage({ type: "role:promote", target, role });
        setContextMenu(null);
    }

    function handleDemote(target) {
        sendWsMessage({ type: "role:demote", target });
        setContextMenu(null);
    }

    function handleForceMute(target) {
        sendWsMessage({ type: "voice:mute", target });
        setContextMenu(null);
        showToast(`Muted ${target}`);
    }

    /* ── WebRTC Voice Chat ────────────────────────── */
    function createPeer(targetUsername, isInitiator) {
        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: "stun:stun.l.google.com:19302" },
                { urls: "stun:stun1.l.google.com:19302" },
            ]
        });
        peerConnections.current[targetUsername] = pc;

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                sendWsMessage({ type: "voice:ice", target: targetUsername, candidate: e.candidate });
            }
        };

        pc.ontrack = (e) => {
            const audio = new Audio();
            audio.srcObject = e.streams[0];
            audio.autoplay = true;
            remoteAudios.current[targetUsername] = audio;
        };

        if (localStream.current) {
            localStream.current.getTracks().forEach(track => {
                pc.addTrack(track, localStream.current);
            });
        }

        if (isInitiator) {
            pc.createOffer().then(offer => {
                pc.setLocalDescription(offer);
                sendWsMessage({ type: "voice:offer", target: targetUsername, sdp: offer });
            });
        }

        return pc;
    }

    async function toggleVoice() {
        if (!voiceActive) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                localStream.current = stream;
                setVoiceActive(true);
                setVoiceMuted(false);
                sendWsMessage({ type: "voice:state", muted: false, active: true });
                // Connect to all existing participants
                participants.forEach(p => {
                    const pName = typeof p === "string" ? p : p?.username;
                    if (pName && pName !== username && !peerConnections.current[pName]) {
                        createPeer(pName, true);
                    }
                });
                showToast("Voice chat joined");
            } catch {
                showToast("Microphone access denied");
            }
        } else {
            // Leave voice
            if (localStream.current) {
                localStream.current.getTracks().forEach(t => t.stop());
                localStream.current = null;
            }
            Object.values(peerConnections.current).forEach(pc => pc.close());
            peerConnections.current = {};
            Object.values(remoteAudios.current).forEach(a => { a.pause(); a.srcObject = null; });
            remoteAudios.current = {};
            setVoiceActive(false);
            setVoiceMuted(true);
            sendWsMessage({ type: "voice:state", muted: true, active: false });
            showToast("Voice chat left");
        }
    }

    function toggleMic() {
        if (!localStream.current) return;
        const newMuted = !voiceMuted;
        localStream.current.getAudioTracks().forEach(t => t.enabled = !newMuted);
        setVoiceMuted(newMuted);
        sendWsMessage({ type: "voice:state", muted: newMuted, active: true });
    }

    /* ── Close context menu on outside click ─────── */
    useEffect(() => {
        function handleClick() { setContextMenu(null); }
        if (contextMenu) {
            window.addEventListener("click", handleClick);
            return () => window.removeEventListener("click", handleClick);
        }
    }, [contextMenu]);

    /* ── Error screen ─────────────────────────────── */
    if (error) {
        return (
            <div className="loading-screen">
                <div style={{ textAlign: "center" }}>
                    <div className="error-icon">!</div>
                    <h2 style={{ marginBottom: 12 }}>{error}</h2>
                    <p style={{ color: "var(--text-secondary)", marginBottom: 24 }}>
                        The room you are looking for does not exist or has been deleted.
                    </p>
                    <button className="btn-primary" onClick={() => router.push("/")}>
                        Go Home
                    </button>
                </div>
            </div>
        );
    }

    /* ── Loading ──────────────────────────────────── */
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
                    <div className="join-card-icon">SyncRoom</div>
                    <h1>Join Watch Party</h1>
                    <p className="join-card-room">{room.name}</p>
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
                            Join Room
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    /* ── Room view ────────────────────────────────── */
    return (
        <div className="room-page" onClick={() => setContextMenu(null)}>
            {/* Toast */}
            {toast && <div className="toast">{toast}</div>}

            {/* Connection Status */}
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
                            Disconnected — <button onClick={connectWs}>Retry</button>
                        </>
                    )}
                </div>
            )}

            {/* Header */}
            <header className="room-header">
                <div className="room-header-left">
                    <button className="room-header-back" onClick={() => router.push("/")}>
                        &larr; Home
                    </button>
                    <div className="room-header-info">
                        <h1>{room.name}</h1>
                        <span>
                            Hosted by {room.host_name}
                            {myRole === "admin" && " (you)"}
                            {room.is_public ? "" : " | Private"}
                        </span>
                    </div>
                </div>
                <div className="room-header-right">
                    <div className="room-participants-badge">
                        <span className="online-dot" />
                        {participants.length} watching
                    </div>
                    <button className="room-id-btn" onClick={handleCopyRoomId} title="Copy Room ID">
                        {roomIdCopied ? "Copied" : `ID: ${roomId.slice(0, 8)}...`}
                    </button>
                    <button className="room-share-btn" onClick={handleCopyLink}>
                        Share Link
                    </button>
                    {canControlVideo && (
                        <button className="room-video-btn" onClick={() => setShowVideoModal(true)} title="Change Video">
                            Change Video
                        </button>
                    )}
                </div>
            </header>

            {/* Content */}
            <div className="room-content">
                {/* Video + Controls */}
                <div className="room-video-section">
                    <div className="video-wrapper">
                        <div id="yt-player" />
                    </div>

                    {/* Volume Control */}
                    <div className="video-controls-bar">
                        <div className="volume-control">
                            <span className="volume-icon">{volume === 0 ? "muted" : "vol"}</span>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={volume}
                                onChange={(e) => handleVolumeChange(e.target.value)}
                                className="volume-slider"
                                disabled={!canControlVideo}
                            />
                            <span className="volume-value">{volume}%</span>
                        </div>
                        <div className="voice-controls">
                            <button className={`voice-btn ${voiceActive ? (voiceMuted ? 'voice-muted' : 'voice-live') : ''}`} onClick={voiceActive ? toggleMic : toggleVoice} title={voiceActive ? (voiceMuted ? 'Unmute' : 'Mute') : 'Join Voice'}>
                                {voiceActive ? (
                                    voiceMuted ? (
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" /><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.36 2.18" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
                                    ) : (
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
                                    )
                                ) : (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
                                )}
                                <span>{voiceActive ? (voiceMuted ? 'Muted' : 'Live') : 'Voice'}</span>
                            </button>
                            {voiceActive && (
                                <button className="voice-leave-btn" onClick={toggleVoice} title="Leave Voice">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 2H8a2 2 0 0 0-2 2v16l6-3 6 3V4a2 2 0 0 0-2-2z" /></svg>
                                    Leave
                                </button>
                            )}
                        </div>
                        <div className="role-indicator">
                            {myRole === "admin" && <span className="role-tag role-tag-admin">ADMIN</span>}
                            {myRole === "mod" && <span className="role-tag role-tag-mod">MOD</span>}
                            {myRole === "member" && <span className="role-tag role-tag-member">MEMBER</span>}
                        </div>
                    </div>
                </div>

                {/* Sidebar: Participants + Chat */}
                <div className="room-sidebar">
                    {/* Participants */}
                    <div className="participants-panel">
                        <h3>Participants ({participants.length})</h3>
                        <ul className="participants-list">
                            {participants.map((p, idx) => {
                                const pName = (typeof p === "string" ? p : p?.username) || "User";
                                const pRole = (typeof p === "string" ? "member" : p?.role) || "member";
                                const badge = getRoleBadge(pRole);
                                const isMe = pName === username;
                                return (
                                    <li key={pName + idx} className="participant-item"
                                        onContextMenu={(e) => {
                                            if (canModerate && !isMe && pRole !== "admin") {
                                                e.preventDefault();
                                                setContextMenu({ username: pName, role: pRole, x: e.clientX, y: e.clientY });
                                            }
                                        }}
                                        onClick={(e) => {
                                            if (canModerate && !isMe && pRole !== "admin") {
                                                e.stopPropagation();
                                                const rect = e.currentTarget.getBoundingClientRect();
                                                setContextMenu({ username: pName, role: pRole, x: rect.right, y: rect.top });
                                            }
                                        }}
                                    >
                                        <span className="participant-avatar" style={{ background: `hsl(${(pName.charCodeAt(0) * 37) % 360}, 60%, 55%)` }}>
                                            {pName.charAt(0).toUpperCase()}
                                        </span>
                                        <span className="participant-name">
                                            {pName}{isMe ? " (you)" : ""}
                                        </span>
                                        {badge && <span className={`role-badge ${badge.className}`}>{badge.label}</span>}
                                        {voiceUsers[pName]?.active && (
                                            <span className={`voice-indicator ${voiceUsers[pName]?.muted ? 'voice-indicator-muted' : 'voice-indicator-live'}`} title={voiceUsers[pName]?.muted ? 'Muted' : 'Speaking'}>
                                                {voiceUsers[pName]?.muted ? (
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12" /></svg>
                                                ) : (
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /></svg>
                                                )}
                                            </span>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    </div>

                    {/* Context Menu */}
                    {contextMenu && (
                        <div className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}
                            onClick={(e) => e.stopPropagation()}>
                            <div className="context-menu-header">{contextMenu.username}</div>
                            {contextMenu.role === "member" && (
                                <button className="context-menu-item" onClick={() => handlePromote(contextMenu.username, "mod")}>
                                    Promote to Mod
                                </button>
                            )}
                            {contextMenu.role === "mod" && (
                                <button className="context-menu-item" onClick={() => handleDemote(contextMenu.username)}>
                                    Demote to Member
                                </button>
                            )}
                            {voiceUsers[contextMenu.username]?.active && !voiceUsers[contextMenu.username]?.muted && (
                                <button className="context-menu-item" onClick={() => handleForceMute(contextMenu.username)}>
                                    🔇 Force Mute
                                </button>
                            )}
                            <button className="context-menu-item context-menu-danger" onClick={() => handleKick(contextMenu.username)}>
                                Kick from Room
                            </button>
                        </div>
                    )}

                    {/* Chat */}
                    <div className="chat-panel">
                        <h3>Chat</h3>
                        <div className="chat-messages" ref={chatContainerRef} onScroll={handleChatScroll}>
                            {messages.map((msg, i) => (
                                <div key={i} className={`chat-msg ${msg.type === "system" ? "chat-msg-system" : ""}`}>
                                    {msg.type === "system" ? (
                                        <span className="chat-system-text">{msg.content}</span>
                                    ) : (
                                        <>
                                            <span className="chat-author" style={{ color: `hsl(${(msg.username?.charCodeAt(0) * 47) % 360}, 65%, 65%)` }}>{msg.username}</span>
                                            <span className="chat-text">{msg.content}</span>
                                        </>
                                    )}
                                </div>
                            ))}
                            <div ref={chatEndRef} />
                        </div>

                        {typingUsers.length > 0 && (
                            <div className="typing-indicator">
                                {typingUsers.join(", ")} {typingUsers.length === 1 ? "is" : "are"} typing...
                            </div>
                        )}

                        <form className="chat-input-form" onSubmit={handleSendMessage}>
                            <input
                                type="text"
                                placeholder="Send a message..."
                                value={chatInput}
                                onChange={(e) => {
                                    setChatInput(e.target.value);
                                    handleTyping();
                                }}
                                maxLength={1000}
                            />
                            <button type="submit" className="btn-send">Send</button>
                        </form>
                    </div>
                </div>
            </div>

            {/* Change Video Modal */}
            {showVideoModal && (
                <div className="modal-overlay" onClick={() => setShowVideoModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Change Video</h2>
                        <form onSubmit={handleChangeVideo}>
                            <div className="form-group">
                                <label>Video URL</label>
                                <input
                                    type="text"
                                    placeholder="Paste YouTube URL"
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
        </div>
    );
}

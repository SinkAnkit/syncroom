"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { getApiUrl, getWsUrl } from "../../lib/config";

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
    const [screenStream, setScreenStream] = useState(null);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [remoteScreenStream, setRemoteScreenStream] = useState(null);
    const [uploadProgress, setUploadProgress] = useState(null);
    const [uploadedVideoUrl, setUploadedVideoUrl] = useState(null);
    const [screenSharer, setScreenSharer] = useState(null);
    // Browsers refuse to autoplay media that carries audio without a gesture;
    // when that happens we surface a tap-to-play overlay instead of a black box.
    const [screenBlocked, setScreenBlocked] = useState(false);
    const [playbackBlocked, setPlaybackBlocked] = useState(false);

    const wsRef = useRef(null);
    const playerRef = useRef(null);
    const uploadVideoRef = useRef(null);
    const screenVideoRef = useRef(null);
    const remoteScreenRef = useRef(null);
    const screenPeers = useRef({});
    const screenStreamRef = useRef(null);
    const isScreenSharingRef = useRef(false);
    const chatEndRef = useRef(null);
    const chatContainerRef = useRef(null);
    const playerReady = useRef(false);
    const reconnectAttempt = useRef(0);
    const reconnectTimer = useRef(null);
    const typingTimeout = useRef(null);
    const isTyping = useRef(false);
    const isUserNearBottom = useRef(true);
    const peerConnections = useRef({});
    const localStream = useRef(null);
    const remoteAudios = useRef({});
    const pendingVoiceIce = useRef({});
    const voiceActiveRef = useRef(false);
    const wsIntentionalClose = useRef(false);
    const toastTimer = useRef(null);
    const suppressPlayerEventsUntil = useRef(0);
    const suppressUploadEventsUntil = useRef(0);
    const roleRef = useRef("member");

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
        if (!joined || !room || room.mode !== "youtube") return;
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

    // Attach the local preview stream.
    // The <video> is conditionally rendered, so it frequently mounted *after*
    // this effect had already run with a null ref and the stream was never
    // attached. Depending on both the stream and the sharing flag (which gates
    // the element) makes the effect re-run once the node actually exists.
    useEffect(() => {
        const el = screenVideoRef.current;
        if (!el || !screenStream) return;
        if (el.srcObject !== screenStream) el.srcObject = screenStream;
        el.play().catch(() => { });
    }, [screenStream, isScreenSharing]);

    // Attach the received stream and handle autoplay rejection.
    useEffect(() => {
        const el = remoteScreenRef.current;
        if (!el || !remoteScreenStream) return;
        if (el.srcObject !== remoteScreenStream) el.srcObject = remoteScreenStream;
        // Honour the room volume on the freshly-mounted element.
        el.volume = volume / 100;
        el.play()
            .then(() => setScreenBlocked(false))
            .catch(() => setScreenBlocked(true));
    }, [remoteScreenStream]);

    // Set initial upload video URL from room data
    useEffect(() => {
        if (room?.mode === "upload" && room?.upload_filename && !uploadedVideoUrl) {
            setUploadedVideoUrl(`${getApiUrl()}/api/rooms/${roomId}/video`);
        }
    }, [room]);

    // Keep a ref of the role so YouTube callbacks (created once, at player
    // construction) never read a stale value.
    useEffect(() => {
        roleRef.current = myRole;
    }, [myRole]);

    function initPlayer() {
        const videoId = extractVideoId(room?.video_url);
        if (!videoId || playerRef.current) return;

        const controllable = roleRef.current === "admin" || roleRef.current === "mod";
        playerRef.current = new window.YT.Player("yt-player", {
            videoId,
            playerVars: {
                autoplay: 1,
                controls: controllable ? 1 : 0,
                modestbranding: 1,
                rel: 0,
                disablekb: controllable ? 0 : 1,
            },
            events: {
                onReady: (e) => {
                    playerReady.current = true;
                    e.target.setVolume(volume);
                    e.target.playVideo();
                    // Pull authoritative state: the player is usually ready well
                    // after the initial video:state message was handled.
                    sendWsMessage({ type: "video:sync_request" });
                },
                onStateChange: handlePlayerStateChange,
            },
        });
    }

    /**
     * Suppress outbound sync events for a short window.
     *
     * The old single `ignoreNextEvent` boolean was consumed by the first event,
     * but applying a remote command fires several (BUFFERING, then PLAYING),
     * so the extras were echoed straight back to the room and bounced between
     * clients. A time window absorbs the whole burst.
     */
    function applyRemote(fn) {
        suppressPlayerEventsUntil.current = Date.now() + 1200;
        try {
            fn();
        } catch (err) {
            console.warn("remote video command failed", err);
        }
    }

    function handlePlayerStateChange(event) {
        if (Date.now() < suppressPlayerEventsUntil.current) return;
        const controllable = roleRef.current === "admin" || roleRef.current === "mod";
        if (!controllable) return;

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
                if (playerRef.current && Date.now() >= suppressPlayerEventsUntil.current) {
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
            // A dropped socket makes the server run our disconnect cleanup, which
            // clears our screen share and tells viewers to stop. If we're still
            // capturing locally after a reconnect, re-announce so viewers rebuild
            // their streams instead of being left on a frozen last frame.
            if (isScreenSharingRef.current) {
                sendWsMessage({ type: "screen:start" });
            }
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
                    applyRemote(() => {
                        if (playerRef.current && playerReady.current) {
                            playerRef.current.seekTo(msg.timestamp, true);
                            playerRef.current.playVideo();
                        }
                        const el = uploadVideoRef.current;
                        if (el) {
                            suppressUploadEventsUntil.current = Date.now() + 1200;
                            if (Math.abs(el.currentTime - msg.timestamp) > 0.5) {
                                el.currentTime = msg.timestamp;
                            }
                            el.play().catch(() => setPlaybackBlocked(true));
                        }
                    });
                    setMessages((prev) => [
                        ...prev,
                        { type: "system", content: `${msg.username} played the video` },
                    ]);
                    break;

                case "video:pause":
                    applyRemote(() => {
                        if (playerRef.current && playerReady.current) {
                            playerRef.current.seekTo(msg.timestamp, true);
                            playerRef.current.pauseVideo();
                        }
                        const el = uploadVideoRef.current;
                        if (el) {
                            suppressUploadEventsUntil.current = Date.now() + 1200;
                            if (Math.abs(el.currentTime - msg.timestamp) > 0.5) {
                                el.currentTime = msg.timestamp;
                            }
                            el.pause();
                        }
                    });
                    setMessages((prev) => [
                        ...prev,
                        { type: "system", content: `${msg.username} paused the video` },
                    ]);
                    break;

                case "video:seek":
                    applyRemote(() => {
                        if (playerRef.current && playerReady.current) {
                            playerRef.current.seekTo(msg.timestamp, true);
                        }
                        const el = uploadVideoRef.current;
                        if (el) {
                            suppressUploadEventsUntil.current = Date.now() + 1200;
                            el.currentTime = msg.timestamp;
                        }
                    });
                    break;

                case "video:state":
                    applyRemote(() => {
                        if (playerRef.current && playerReady.current) {
                            playerRef.current.seekTo(msg.timestamp, true);
                            if (msg.is_playing) playerRef.current.playVideo();
                            else playerRef.current.pauseVideo();
                        }
                        const el = uploadVideoRef.current;
                        if (el) {
                            suppressUploadEventsUntil.current = Date.now() + 1200;
                            if (Math.abs(el.currentTime - msg.timestamp) > 0.5) {
                                el.currentTime = msg.timestamp;
                            }
                            if (msg.is_playing) el.play().catch(() => setPlaybackBlocked(true));
                            else el.pause();
                        }
                    });
                    if (msg.video_url && msg.video_url !== room?.video_url) {
                        setRoom((prev) => (prev ? { ...prev, video_url: msg.video_url } : prev));
                    }
                    if (msg.volume !== undefined) {
                        setVolume(msg.volume);
                        if (playerRef.current && playerReady.current) {
                            playerRef.current.setVolume(msg.volume);
                        }
                        if (uploadVideoRef.current) {
                            uploadVideoRef.current.volume = msg.volume / 100;
                        }
                    }
                    break;

                case "video:uploaded":
                    if (msg.url) setUploadedVideoUrl(msg.url);
                    showToast(`${msg.username || "The host"} uploaded a video`);
                    break;

                /* ── Screen share signaling (was an empty no-op before) ── */

                case "screen:start":
                    // Someone else began sharing. Ask them to stream to us.
                    if (msg.username && msg.username !== username) {
                        if (isScreenSharingRef.current) stopScreenShare({ notify: false });
                        setScreenSharer(msg.username);
                        setMessages((prev) => [
                            ...prev,
                            { type: "system", content: `${msg.username} started sharing their screen` },
                        ]);
                        sendWsMessage({ type: "screen:request" });
                    }
                    break;

                case "screen:stop":
                    if (msg.username && msg.username === username) {
                        // The server told *us* to stop. When we stopped
                        // ourselves this is just the echo (isScreenSharingRef is
                        // already false, so this is a no-op). But when an admin
                        // demotes or force-stops us, this is the only signal we
                        // get — tear down our own capture so we don't keep the
                        // screen grabbed while everyone else has been cut off.
                        if (isScreenSharingRef.current) stopScreenShare({ notify: false });
                        break;
                    }
                    if (msg.username) {
                        setMessages((prev) => [
                            ...prev,
                            { type: "system", content: `${msg.username} stopped sharing their screen` },
                        ]);
                    }
                    clearRemoteScreen();
                    break;

                case "screen:request":
                    // Sharer side: a viewer wants the stream.
                    if (isScreenSharingRef.current && msg.from && msg.from !== username) {
                        await createScreenOffer(msg.from);
                    }
                    break;

                case "screen:offer":
                    await handleScreenOffer(msg.from, msg.sdp);
                    break;

                case "screen:answer": {
                    const entry = screenPeers.current[msg.from];
                    if (entry) {
                        try {
                            await entry.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
                            await flushScreenCandidates(msg.from);
                        } catch (err) {
                            console.error("screen answer apply failed", err);
                        }
                    }
                    break;
                }

                case "screen:ice": {
                    const entry = screenPeers.current[msg.from];
                    if (!entry || !msg.candidate) break;
                    if (entry.pc.remoteDescription?.type) {
                        try {
                            await entry.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
                        } catch (err) {
                            console.warn("addIceCandidate failed", err);
                        }
                    } else {
                        entry.pending.push(msg.candidate);
                    }
                    break;
                }

                case "video:url_change":
                    // Keep room state in sync too, otherwise a later player
                    // remount rebuilds with the previous video id.
                    setRoom((prev) => (prev ? { ...prev, video_url: msg.video_url } : prev));
                    applyRemote(() => {
                        if (playerRef.current && playerReady.current) {
                            const newId = extractVideoId(msg.video_url);
                            if (newId) playerRef.current.loadVideoById(newId);
                        }
                    });
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
                    if (uploadVideoRef.current) {
                        uploadVideoRef.current.volume = msg.volume / 100;
                    }
                    if (remoteScreenRef.current) {
                        remoteScreenRef.current.volume = msg.volume / 100;
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
                case "room:user_kicked":
                    setParticipants(normalizeParticipants(msg.participants));
                    // Release the per-peer resources we were holding for them,
                    // otherwise dead RTCPeerConnections and <audio> nodes pile up.
                    // A peer who actually leaves the room releases *both* their
                    // voice and screen connections; voice churn alone must not.
                    releasePeerResources(msg.username);
                    closeScreenPeer(msg.username);
                    setVoiceUsers((prev) => {
                        if (!(msg.username in prev)) return prev;
                        const next = { ...prev };
                        delete next[msg.username];
                        return next;
                    });
                    setTypingUsers((prev) => prev.filter((u) => u !== msg.username));
                    setMessages((prev) => [
                        ...prev,
                        {
                            type: "system",
                            content: msg.type === "room:user_kicked"
                                ? `${msg.username} was kicked by ${msg.by}`
                                : `${msg.username} left the room`,
                        },
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
                    // The server refused our screen share (no permission, or
                    // someone else grabbed it first in a race). We optimistically
                    // started capturing locally — undo that so we don't sit on a
                    // live, un-broadcast capture behind a fake "Stop Sharing" UI.
                    if (msg.code === "screen_denied" && isScreenSharingRef.current) {
                        stopScreenShare({ notify: false });
                    }
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
                    try {
                        const pc = createPeer(msg.from, false);
                        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
                        await flushVoiceCandidates(msg.from);
                        const answer = await pc.createAnswer();
                        await pc.setLocalDescription(answer);
                        sendWsMessage({
                            type: "voice:answer",
                            target: msg.from,
                            sdp: pc.localDescription,
                        });
                    } catch (err) {
                        console.error("voice answer failed", err);
                        releasePeerResources(msg.from);
                    }
                    break;
                }
                case "voice:answer": {
                    const pc = peerConnections.current[msg.from];
                    if (!pc) break;
                    try {
                        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
                        await flushVoiceCandidates(msg.from);
                    } catch (err) {
                        console.error("voice answer apply failed", err);
                    }
                    break;
                }
                case "voice:ice": {
                    if (!msg.candidate) break;
                    const pc = peerConnections.current[msg.from];
                    // Candidates routinely beat the SDP through the relay; adding
                    // one before setRemoteDescription throws and silently kills
                    // connectivity, so queue until the description lands.
                    if (pc?.remoteDescription?.type) {
                        try {
                            await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
                        } catch (err) {
                            console.warn("voice addIceCandidate failed", err);
                        }
                    } else {
                        pendingVoiceIce.current[msg.from] =
                            pendingVoiceIce.current[msg.from] || [];
                        pendingVoiceIce.current[msg.from].push(msg.candidate);
                    }
                    break;
                }
                case "voice:state":
                    setVoiceUsers((prev) => ({
                        ...prev,
                        [msg.username]: { muted: msg.muted, active: msg.active },
                    }));
                    // Someone joined voice while we're already live: whoever has
                    // the smaller name dials, so exactly one offer is created.
                    if (
                        msg.active &&
                        msg.username !== username &&
                        voiceActiveRef.current &&
                        !peerConnections.current[msg.username] &&
                        username < msg.username
                    ) {
                        createPeer(msg.username, true);
                    }
                    if (!msg.active) releasePeerResources(msg.username);
                    break;
                case "voice:force_mute":
                    // Admin force-muted us
                    if (localStream.current) {
                        localStream.current.getAudioTracks().forEach((t) => { t.enabled = false; });
                    }
                    setVoiceMuted(true);
                    showToast(`You were muted by ${msg.by}`);
                    // voiceActive is captured from the render this handler was
                    // created in and goes stale; the ref always reflects now.
                    sendWsMessage({ type: "voice:state", muted: true, active: voiceActiveRef.current });
                    break;
            }
        };

        ws.onclose = (event) => {
            // A close we asked for (unmount, re-render, kick) must not schedule a
            // reconnect. Previously the cleanup below called close(), this handler
            // fired afterwards, and a brand-new socket was opened for a component
            // that no longer existed — one zombie connection per navigation.
            if (wsIntentionalClose.current || wsRef.current !== ws) return;

            if (event.code === 4009) {
                // Username already in the room — reconnecting would loop forever.
                setConnectionState("disconnected");
                setError("That name is already taken in this room. Pick another one.");
                return;
            }

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
        wsIntentionalClose.current = false;
        connectWs();
        return () => {
            wsIntentionalClose.current = true;
            if (reconnectTimer.current) {
                clearTimeout(reconnectTimer.current);
                reconnectTimer.current = null;
            }
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [connectWs]);

    /* ── Release every media resource on unmount ─── */
    useEffect(() => {
        return () => {
            if (toastTimer.current) clearTimeout(toastTimer.current);
            if (typingTimeout.current) clearTimeout(typingTimeout.current);
            if (screenStreamRef.current) {
                screenStreamRef.current.getTracks().forEach((t) => t.stop());
                screenStreamRef.current = null;
            }
            if (localStream.current) {
                localStream.current.getTracks().forEach((t) => t.stop());
                localStream.current = null;
            }
            Object.values(screenPeers.current).forEach((entry) => {
                try { entry?.pc?.close(); } catch { }
            });
            screenPeers.current = {};
            Object.values(peerConnections.current).forEach((pc) => {
                try { pc.close(); } catch { }
            });
            peerConnections.current = {};
            Object.values(remoteAudios.current).forEach((a) => {
                a.pause();
                a.srcObject = null;
                a.remove();
            });
            remoteAudios.current = {};
            if (playerRef.current?.destroy) {
                try { playerRef.current.destroy(); } catch { }
                playerRef.current = null;
            }
        };
    }, []);

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
        // Without clearing, a second toast inherits the first timer and vanishes early.
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(""), 3000);
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
        if (uploadVideoRef.current) {
            uploadVideoRef.current.volume = v / 100;
        }
        // A shared screen can carry system audio; the slider has to drive it too,
        // otherwise the volume control is a dead knob in screenshare mode.
        if (remoteScreenRef.current) {
            remoteScreenRef.current.volume = v / 100;
        }
        if (canControlVideo) {
            sendWsMessage({ type: "volume:change", volume: v });
        }
    }

    /* ── Screen Share (native WebRTC over our own WS signaling) ──────────
     *
     * Replaces the previous PeerJS + HTTP-polling implementation, which could
     * never work: the viewer called `peer.call(id, new MediaStream())`, and an
     * empty stream produces an SDP offer with zero m-lines. An answer may not
     * introduce media sections the offer didn't have, so the sharer's
     * `call.answer(screenStream)` had nowhere to attach its tracks and the
     * viewer's `stream` event never fired.
     *
     * The side that owns the media must be the offerer. So: viewers announce
     * themselves with `screen:request`, and the sharer creates one
     * RTCPeerConnection per viewer and offers into it.
     */

    function getIceServers() {
        const extra = process.env.NEXT_PUBLIC_TURN_URL
            ? [{
                urls: process.env.NEXT_PUBLIC_TURN_URL,
                username: process.env.NEXT_PUBLIC_TURN_USERNAME,
                credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
            }]
            : [];
        return [
            { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
            ...extra,
        ];
    }

    function closeScreenPeer(peerName) {
        const entry = screenPeers.current[peerName];
        if (!entry) return;
        try { entry.pc.close(); } catch { }
        delete screenPeers.current[peerName];
    }

    function closeAllScreenPeers() {
        Object.keys(screenPeers.current).forEach(closeScreenPeer);
        screenPeers.current = {};
    }

    /** Sharer side: build a send-only connection for one viewer and offer. */
    async function createScreenOffer(viewer) {
        const stream = screenStreamRef.current;
        if (!stream) return;

        closeScreenPeer(viewer);
        const pc = new RTCPeerConnection({ iceServers: getIceServers() });
        screenPeers.current[viewer] = { pc, pending: [] };

        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                sendWsMessage({ type: "screen:ice", target: viewer, candidate: e.candidate });
            }
        };
        pc.onconnectionstatechange = () => {
            if (["failed", "closed"].includes(pc.connectionState)) closeScreenPeer(viewer);
        };

        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            sendWsMessage({ type: "screen:offer", target: viewer, sdp: pc.localDescription });
        } catch (err) {
            console.error("screen offer failed", err);
            closeScreenPeer(viewer);
        }
    }

    /** Viewer side: accept the sharer's offer with a receive-only connection. */
    async function handleScreenOffer(from, sdp) {
        closeScreenPeer(from);
        const pc = new RTCPeerConnection({ iceServers: getIceServers() });
        screenPeers.current[from] = { pc, pending: [] };

        pc.ontrack = (e) => {
            // Both audio and video tracks arrive on the same stream.
            setRemoteScreenStream(e.streams[0]);
            setScreenSharer(from);
        };
        pc.onicecandidate = (e) => {
            if (e.candidate) {
                sendWsMessage({ type: "screen:ice", target: from, candidate: e.candidate });
            }
        };
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === "failed") {
                showToast("Screen stream connection failed — retrying");
                closeScreenPeer(from);
                sendWsMessage({ type: "screen:request" });
            }
        };

        try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
            await flushScreenCandidates(from);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendWsMessage({ type: "screen:answer", target: from, sdp: pc.localDescription });
        } catch (err) {
            console.error("screen answer failed", err);
            closeScreenPeer(from);
        }
    }

    /** ICE can arrive before the remote description — buffer and replay. */
    async function flushScreenCandidates(peerName) {
        const entry = screenPeers.current[peerName];
        if (!entry) return;
        const queued = entry.pending.splice(0);
        for (const candidate of queued) {
            try {
                await entry.pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
                console.warn("addIceCandidate failed", err);
            }
        }
    }

    async function startScreenShare() {
        if (!navigator.mediaDevices?.getDisplayMedia) {
            showToast("Screen sharing needs a secure (https or localhost) origin");
            return;
        }
        let stream;
        try {
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: { ideal: 30, max: 60 } },
                audio: true,
            });
        } catch {
            showToast("Screen share cancelled");
            return;
        }

        screenStreamRef.current = stream;
        isScreenSharingRef.current = true;
        setScreenStream(stream);
        setIsScreenSharing(true);
        setScreenSharer(username);
        setRemoteScreenStream(null);

        // "Stop sharing" in the browser's own bar must tear everything down too.
        stream.getVideoTracks().forEach((t) => {
            t.onended = () => stopScreenShare();
        });

        // Announce; every viewer replies with screen:request and we offer to each.
        sendWsMessage({ type: "screen:start" });
    }

    function stopScreenShare({ notify = true } = {}) {
        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach((t) => {
                t.onended = null;
                t.stop();
            });
        }
        closeAllScreenPeers();
        screenStreamRef.current = null;
        isScreenSharingRef.current = false;
        setScreenStream(null);
        setIsScreenSharing(false);
        setScreenSharer(null);
        setRemoteScreenStream(null);
        setScreenBlocked(false);
        if (notify) sendWsMessage({ type: "screen:stop" });
    }

    /** Viewer teardown when the sharer stops or drops. */
    function clearRemoteScreen() {
        closeAllScreenPeers();
        setRemoteScreenStream(null);
        setScreenSharer(null);
        setScreenBlocked(false);
    }

    /* Upload Video */
    async function handleFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        // Allow re-selecting the same file after a failure.
        e.target.value = "";

        setUploadProgress(0);
        const formData = new FormData();
        formData.append("file", file);

        // These used raw setToast, which never scheduled the clear timer, so the
        // message stayed on screen forever.
        const fail = (reason) => {
            setUploadProgress(null);
            showToast(reason);
        };

        try {
            const xhr = new XMLHttpRequest();
            xhr.upload.onprogress = (ev) => {
                if (ev.lengthComputable) {
                    setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
                }
            };
            xhr.onload = () => {
                if (xhr.status === 200) {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        const url = `${getApiUrl()}${data.url}`;
                        setUploadedVideoUrl(url);
                        setUploadProgress(null);
                        showToast("Video uploaded");
                        sendWsMessage({ type: "video:uploaded", url });
                    } catch {
                        fail("Upload succeeded but the response was unreadable");
                    }
                } else {
                    let detail = "Upload failed";
                    try {
                        detail = JSON.parse(xhr.responseText).detail || detail;
                    } catch { }
                    fail(detail);
                }
            };
            xhr.onerror = () => fail("Upload failed");
            xhr.open("POST", `${getApiUrl()}/api/rooms/${roomId}/upload`);
            xhr.send(formData);
        } catch {
            fail("Upload failed");
        }
    }

    /* Upload video sync controls.
     * `suppressUploadEventsUntil` is set whenever we apply a remote state to the
     * <video> element. Without this guard the element's own play/pause/seeked
     * events fire and get rebroadcast, which ping-pongs between clients. */
    function isRemoteEcho() {
        return Date.now() < suppressUploadEventsUntil.current;
    }

    function handleUploadVideoPlay() {
        setPlaybackBlocked(false);
        if (!canControlVideo || isRemoteEcho()) return;
        const time = uploadVideoRef.current?.currentTime || 0;
        sendWsMessage({ type: "video:play", timestamp: time });
    }

    function handleUploadVideoPause() {
        if (!canControlVideo || isRemoteEcho()) return;
        const time = uploadVideoRef.current?.currentTime || 0;
        sendWsMessage({ type: "video:pause", timestamp: time });
    }

    function handleUploadVideoSeek() {
        if (!canControlVideo || isRemoteEcho()) return;
        const time = uploadVideoRef.current?.currentTime || 0;
        sendWsMessage({ type: "video:seek", timestamp: time });
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

    /**
     * Tear down the *voice* resources we hold for one peer.
     *
     * This must NOT touch the screen-share peer: voice and screen are two
     * independent RTCPeerConnections that happen to be keyed by the same
     * username. Leaving voice, a failed voice offer, or a dropped voice
     * connection previously called closeScreenPeer() here too, which ripped a
     * live screen stream out from under every viewer the instant the sharer's
     * voice state changed. Screen peers are released explicitly where a peer
     * actually leaves the room (room:user_left / room:user_kicked).
     */
    function releasePeerResources(peerName) {
        if (!peerName) return;
        const pc = peerConnections.current[peerName];
        if (pc) {
            try { pc.close(); } catch { }
            delete peerConnections.current[peerName];
        }
        const audio = remoteAudios.current[peerName];
        if (audio) {
            audio.pause();
            audio.srcObject = null;
            audio.remove();
            delete remoteAudios.current[peerName];
        }
        delete pendingVoiceIce.current[peerName];
    }

    function createPeer(targetUsername, isInitiator) {
        const pc = new RTCPeerConnection({ iceServers: getIceServers() });
        peerConnections.current[targetUsername] = pc;
        pendingVoiceIce.current[targetUsername] = pendingVoiceIce.current[targetUsername] || [];

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                sendWsMessage({ type: "voice:ice", target: targetUsername, candidate: e.candidate });
            }
        };

        pc.ontrack = (e) => {
            // Reuse one <audio> per peer. Creating a fresh detached Audio() on
            // every track leaked elements and often never started playing, since
            // an element outside the document can't recover from a blocked play().
            let audio = remoteAudios.current[targetUsername];
            if (!audio) {
                audio = document.createElement("audio");
                audio.autoplay = true;
                audio.playsInline = true;
                audio.style.display = "none";
                document.body.appendChild(audio);
                remoteAudios.current[targetUsername] = audio;
            }
            audio.srcObject = e.streams[0];
            audio.play().catch(() => {
                showToast("Click anywhere to enable voice audio");
            });
        };

        pc.onconnectionstatechange = () => {
            if (["failed", "closed"].includes(pc.connectionState)) {
                releasePeerResources(targetUsername);
            }
        };

        if (localStream.current) {
            localStream.current.getTracks().forEach((track) => {
                pc.addTrack(track, localStream.current);
            });
        }

        if (isInitiator) {
            (async () => {
                try {
                    const offer = await pc.createOffer();
                    // Must await: sending before setLocalDescription resolves can
                    // ship an SDP the local peer hasn't committed to yet.
                    await pc.setLocalDescription(offer);
                    sendWsMessage({
                        type: "voice:offer",
                        target: targetUsername,
                        sdp: pc.localDescription,
                    });
                } catch (err) {
                    console.error("voice offer failed", err);
                    releasePeerResources(targetUsername);
                }
            })();
        }

        return pc;
    }

    async function flushVoiceCandidates(peerName) {
        const pc = peerConnections.current[peerName];
        const queued = pendingVoiceIce.current[peerName]?.splice(0) || [];
        if (!pc) return;
        for (const candidate of queued) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
                console.warn("voice addIceCandidate failed", err);
            }
        }
    }

    async function toggleVoice() {
        if (!voiceActive) {
            let stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: true, noiseSuppression: true },
                });
            } catch {
                showToast("Microphone access denied");
                return;
            }
            localStream.current = stream;
            voiceActiveRef.current = true;
            setVoiceActive(true);
            setVoiceMuted(false);
            sendWsMessage({ type: "voice:state", muted: false, active: true });

            // Rebuild from scratch: a connection created while we had no mic has
            // no audio track and can never gain one without renegotiation, which
            // is why users who answered before joining could hear but not speak.
            Object.keys(peerConnections.current).forEach((name) => {
                const pc = peerConnections.current[name];
                if (pc) { try { pc.close(); } catch { } }
                delete peerConnections.current[name];
                delete pendingVoiceIce.current[name];
            });

            participants.forEach((p) => {
                const pName = typeof p === "string" ? p : p?.username;
                if (!pName || pName === username) return;
                // Only dial peers that are actually in voice, and let the
                // lexicographically smaller name offer so both sides don't
                // offer at once (glare).
                if (!voiceUsers[pName]?.active) return;
                if (username < pName) createPeer(pName, true);
            });
            showToast("Voice chat joined");
        } else {
            if (localStream.current) {
                localStream.current.getTracks().forEach((t) => t.stop());
                localStream.current = null;
            }
            Object.keys(peerConnections.current).forEach((name) => {
                const pc = peerConnections.current[name];
                if (pc) { try { pc.close(); } catch { } }
                delete peerConnections.current[name];
            });
            Object.entries(remoteAudios.current).forEach(([, a]) => {
                a.pause();
                a.srcObject = null;
                a.remove();
            });
            remoteAudios.current = {};
            pendingVoiceIce.current = {};
            voiceActiveRef.current = false;
            setVoiceActive(false);
            setVoiceMuted(true);
            sendWsMessage({ type: "voice:state", muted: true, active: false });
            showToast("Voice chat left");
        }
    }

    function toggleMic() {
        if (!localStream.current) return;
        const newMuted = !voiceMuted;
        localStream.current.getAudioTracks().forEach((t) => { t.enabled = !newMuted; });
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
                        {/* YouTube mode */}
                        {room?.mode === "youtube" && <div id="yt-player" />}

                        {/* Screen Share mode */}
                        {room?.mode === "screenshare" && (
                            <div className="screenshare-wrapper">
                                {isScreenSharing ? (
                                    <video
                                        ref={screenVideoRef}
                                        autoPlay
                                        muted
                                        playsInline
                                        className="screenshare-video"
                                    />
                                ) : remoteScreenStream ? (
                                    <>
                                        <video
                                            ref={remoteScreenRef}
                                            autoPlay
                                            playsInline
                                            className="screenshare-video"
                                        />
                                        {screenBlocked && (
                                            <button
                                                className="screenshare-unblock"
                                                onClick={() => {
                                                    remoteScreenRef.current
                                                        ?.play()
                                                        .then(() => setScreenBlocked(false))
                                                        .catch(() => { });
                                                }}
                                            >
                                                Tap to play stream
                                            </button>
                                        )}
                                    </>
                                ) : (
                                    <div className="screenshare-placeholder">
                                        {screenSharer && screenSharer !== username ? (
                                            <>
                                                <div className="spinner" />
                                                <p>Connecting to {screenSharer}&apos;s screen...</p>
                                            </>
                                        ) : canControlVideo ? (
                                            <button className="btn-primary" onClick={startScreenShare}>
                                                Share Your Screen
                                            </button>
                                        ) : (
                                            <p>Waiting for the host to start screen sharing...</p>
                                        )}
                                    </div>
                                )}
                                {isScreenSharing && (
                                    <button className="screenshare-stop-btn" onClick={() => stopScreenShare()}>
                                        Stop Sharing
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Upload mode */}
                        {room?.mode === "upload" && (
                            <div className="upload-wrapper">
                                {uploadedVideoUrl || room?.upload_filename ? (
                                    <>
                                        <video
                                            ref={uploadVideoRef}
                                            src={uploadedVideoUrl || `${getApiUrl()}/api/rooms/${roomId}/video`}
                                            className="upload-video"
                                            playsInline
                                            controls={canControlVideo}
                                            onPlay={handleUploadVideoPlay}
                                            onPause={handleUploadVideoPause}
                                            onSeeked={handleUploadVideoSeek}
                                        />
                                        {playbackBlocked && (
                                            <button
                                                className="screenshare-unblock"
                                                onClick={() => {
                                                    uploadVideoRef.current
                                                        ?.play()
                                                        .then(() => setPlaybackBlocked(false))
                                                        .catch(() => { });
                                                }}
                                            >
                                                Tap to start playback
                                            </button>
                                        )}
                                    </>
                                ) : (
                                    <div className="upload-placeholder">
                                        {canControlVideo ? (
                                            <>
                                                <p>Upload a video to start streaming</p>
                                                <label className="btn-primary upload-btn">
                                                    Choose File
                                                    <input type="file" accept="video/*" onChange={handleFileUpload} hidden />
                                                </label>
                                                {uploadProgress !== null && (
                                                    <div className="upload-progress">
                                                        <div className="upload-progress-bar" style={{ width: `${uploadProgress}%` }} />
                                                        <span>{uploadProgress}%</span>
                                                    </div>
                                                )}
                                            </>
                                        ) : (
                                            <p>Waiting for host to upload a video...</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Fallback for rooms without mode */}
                        {!room?.mode && <div id="yt-player" />}
                    </div>

                    {/* Video Controls */}
                    <div className="video-controls-bar">
                        <div className="volume-control">
                            <svg className="volume-icon-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                {volume === 0 ? (
                                    <><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>
                                ) : (
                                    <><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.08" /></>
                                )}
                            </svg>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={volume}
                                onChange={(e) => handleVolumeChange(e.target.value)}
                                className="volume-slider"
                            />
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

"""
Regression checks for the non-screen-share features touched by this pass:
chat history ordering, playback sync, roles/moderation, volume, upload relay,
room CRUD and input validation.
"""
import asyncio
import json
import os
import sys

os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./_e2e_core.db"

import uvicorn
import websockets
from httpx import ASGITransport, AsyncClient

from app.main import app

HOST, PORT = "127.0.0.1", 8124
WS = f"ws://{HOST}:{PORT}"

failures: list[str] = []


def check(label: str, ok: bool, detail: str = ""):
    print(f"  {'PASS' if ok else 'FAIL'}  {label}{'' if ok else f'  <- {detail}'}")
    if not ok:
        failures.append(label)


async def recv_type(ws, wanted, timeout=5.0, match=None):
    """Read until a message of the given type (optionally matching a predicate)."""
    async def _pump():
        while True:
            msg = json.loads(await ws.recv())
            if msg.get("type") == wanted and (match is None or match(msg)):
                return msg
    return await asyncio.wait_for(_pump(), timeout)


async def main():
    config = uvicorn.Config(app, host=HOST, port=PORT, log_level="error")
    server = uvicorn.Server(config)
    task = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.05)

    client = AsyncClient(transport=ASGITransport(app=app), base_url="http://t")
    try:
        r = await client.post("/api/rooms", json={
            "name": "Core Room", "host_name": "alice",
            "mode": "youtube", "video_url": "https://youtu.be/dQw4w9WgXcQ",
        })
        room_id = r.json()["id"]
        check("room created", r.status_code == 200, r.text)

        # --- validation still enforced -----------------------------------
        bad = await client.post("/api/rooms", json={
            "name": "x", "host_name": "bob", "mode": "not-a-mode",
        })
        check("invalid mode rejected", bad.status_code == 422, str(bad.status_code))

        missing = await client.get("/api/rooms/does-not-exist")
        check("unknown room 404s", missing.status_code == 404, str(missing.status_code))

        alice = await websockets.connect(f"{WS}/ws/{room_id}?username=alice")
        await recv_type(alice, "role:assigned")
        bob = await websockets.connect(f"{WS}/ws/{room_id}?username=bob")
        await recv_type(bob, "role:assigned")

        # --- chat relays and persists ------------------------------------
        for i in range(3):
            await alice.send(json.dumps({"type": "chat:message", "content": f"msg-{i}"}))
            await recv_type(bob, "chat:message")
        hist = await client.get(f"/api/rooms/{room_id}/messages?limit=2")
        contents = [m["content"] for m in hist.json()]
        # Must be the two NEWEST, in chronological order (was oldest-first before).
        check("chat history returns newest N chronologically",
              contents == ["msg-1", "msg-2"], str(contents))

        # --- playback sync: admin drives, member cannot ------------------
        await alice.send(json.dumps({"type": "video:play", "timestamp": 42.5}))
        play = await recv_type(bob, "video:play")
        check("member receives play with timestamp", play["timestamp"] == 42.5, str(play))

        await bob.send(json.dumps({"type": "video:pause", "timestamp": 0}))
        denied = await recv_type(bob, "error")
        check("member denied video control",
              "permission" in denied["message"].lower(), str(denied))

        # --- state replay for a late joiner ------------------------------
        carol = await websockets.connect(f"{WS}/ws/{room_id}?username=carol")
        state = await recv_type(carol, "video:state")
        check("late joiner gets current position", state["timestamp"] == 42.5, str(state))
        check("late joiner gets playing flag", state["is_playing"] is True, str(state))
        check("video_url preserved in state",
              "dQw4w9WgXcQ" in state["video_url"], str(state))

        # --- volume -------------------------------------------------------
        await alice.send(json.dumps({"type": "volume:change", "volume": 55}))
        vol = await recv_type(bob, "volume:change")
        check("volume broadcast", vol["volume"] == 55, str(vol))

        # --- url change persists -----------------------------------------
        await alice.send(json.dumps({"type": "video:url_change",
                                     "video_url": "https://youtu.be/abcdefghijk"}))
        await recv_type(bob, "video:url_change")
        room_now = await client.get(f"/api/rooms/{room_id}")
        check("url change persisted to DB",
              room_now.json()["video_url"] == "https://youtu.be/abcdefghijk",
              room_now.text)

        # --- upload relay (the branch that did not exist before) ----------
        await alice.send(json.dumps({"type": "video:uploaded", "url": "/api/x/video"}))
        up = await recv_type(bob, "video:uploaded")
        check("video:uploaded relayed to members", up["url"] == "/api/x/video", str(up))

        # --- moderation ---------------------------------------------------
        await alice.send(json.dumps({"type": "role:promote", "target": "bob", "role": "mod"}))
        promoted = await recv_type(bob, "role:assigned")
        check("promote to mod", promoted["role"] == "mod", str(promoted))

        await bob.send(json.dumps({"type": "video:play", "timestamp": 99}))
        as_mod = await recv_type(carol, "video:play")
        check("mod can now control video", as_mod["timestamp"] == 99, str(as_mod))

        await alice.send(json.dumps({"type": "role:kick", "target": "carol"}))
        kicked = await recv_type(carol, "role:kicked")
        check("kick delivered to target", kicked["type"] == "role:kicked", str(kicked))
        left = await recv_type(bob, "room:user_kicked")
        check("kick announced to room", left["username"] == "carol", str(left))

        # --- non-admin cannot moderate ------------------------------------
        await bob.send(json.dumps({"type": "role:kick", "target": "alice"}))
        await asyncio.sleep(0.3)
        alive = await client.get(f"/api/rooms/{room_id}")
        check("mod cannot kick admin", alive.status_code == 200, alive.text)

        # --- chat flood protection ----------------------------------------
        for i in range(8):
            await alice.send(json.dumps({"type": "chat:message", "content": f"flood-{i}"}))
        flood = await recv_type(alice, "error")
        check("chat rate limit engages", "too fast" in flood["message"].lower(), str(flood))

        # --- malformed frame does not kill the socket ---------------------
        # Skip the rate-limit errors still queued from the flood above.
        await alice.send("this-is-not-json")
        bad_msg = await recv_type(
            alice, "error", match=lambda m: "malformed" in m["message"].lower()
        )
        check("malformed frame handled", "malformed" in bad_msg["message"].lower(), str(bad_msg))
        await alice.send(json.dumps({"type": "video:seek", "timestamp": 7}))
        still = await recv_type(bob, "video:seek")
        check("socket survives malformed frame", still["timestamp"] == 7, str(still))

        # --- anonymous cannot delete an owned room ------------------------
        signup = await client.post("/api/auth/signup", json={
            "email": "owner@test.com", "password": "secret123", "display_name": "Owner",
        })
        token = signup.json()["access_token"]
        owned = await client.post(
            "/api/rooms",
            json={"name": "Owned", "host_name": "Owner", "mode": "youtube", "video_url": "x"},
            headers={"Authorization": f"Bearer {token}"},
        )
        oid = owned.json()["id"]
        anon_del = await client.delete(f"/api/rooms/{oid}")
        check("anonymous cannot delete owned room", anon_del.status_code == 403, str(anon_del.status_code))
        own_del = await client.delete(f"/api/rooms/{oid}",
                                      headers={"Authorization": f"Bearer {token}"})
        check("owner can delete own room", own_del.status_code == 200, str(own_del.status_code))

        await alice.close()
        await bob.close()
    finally:
        await client.aclose()
        server.should_exit = True
        await task
        for suffix in ("", "-shm", "-wal"):
            p = f"./_e2e_core.db{suffix}"
            if os.path.exists(p):
                os.remove(p)

    print()
    if failures:
        print(f"{len(failures)} CHECK(S) FAILED: {', '.join(failures)}")
        sys.exit(1)
    print("ALL CORE FUNCTIONALITY CHECKS PASSED")


asyncio.run(main())

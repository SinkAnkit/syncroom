"""
End-to-end check of the screen-share signalling path.

Drives a real backend over real WebSockets and asserts the full handshake:
  host announces -> viewer is told -> viewer requests -> host offers ->
  viewer answers -> ICE relays both ways -> host drops -> viewer told to stop.
"""
import asyncio
import json
import os
import sys

os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./_e2e_test.db"

import uvicorn
import websockets
from httpx import ASGITransport, AsyncClient

from app.main import app

HOST, PORT = "127.0.0.1", 8123
BASE = f"http://{HOST}:{PORT}"
WS = f"ws://{HOST}:{PORT}"

failures: list[str] = []


def check(label: str, ok: bool, detail: str = ""):
    print(f"  {'PASS' if ok else 'FAIL'}  {label}{'' if ok else f'  <- {detail}'}")
    if not ok:
        failures.append(label)


async def recv_type(ws, wanted: str, timeout: float = 5.0) -> dict:
    """Read until a message of the given type arrives (skipping pings/noise)."""
    async def _pump():
        while True:
            msg = json.loads(await ws.recv())
            if msg.get("type") == wanted:
                return msg
    return await asyncio.wait_for(_pump(), timeout)


async def main():
    config = uvicorn.Config(app, host=HOST, port=PORT, log_level="error")
    server = uvicorn.Server(config)
    task = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.05)

    try:
        # Create a screenshare room
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            r = await c.post("/api/rooms", json={
                "name": "E2E Screen Room",
                "host_name": "hostuser",
                "mode": "screenshare",
                "is_public": True,
            })
            check("room created", r.status_code == 200, r.text)
            room_id = r.json()["id"]

        host = await websockets.connect(f"{WS}/ws/{room_id}?username=hostuser")
        role = await recv_type(host, "role:assigned")
        check("host gets admin role", role["role"] == "admin", str(role))

        viewer = await websockets.connect(f"{WS}/ws/{room_id}?username=viewer1")
        vrole = await recv_type(viewer, "role:assigned")
        check("viewer gets member role", vrole["role"] == "member", str(vrole))

        # --- 1. host announces the share -------------------------------------
        await host.send(json.dumps({"type": "screen:start"}))
        started = await recv_type(viewer, "screen:start")
        check("viewer notified of screen:start", started["username"] == "hostuser", str(started))

        # --- 2. viewer requests the stream -----------------------------------
        await viewer.send(json.dumps({"type": "screen:request"}))
        req = await recv_type(host, "screen:request")
        check("host receives screen:request", req["from"] == "viewer1", str(req))

        # --- 3. host offers, viewer answers ----------------------------------
        await host.send(json.dumps({
            "type": "screen:offer", "target": "viewer1", "sdp": {"type": "offer", "sdp": "v=0-fake"},
        }))
        offer = await recv_type(viewer, "screen:offer")
        check("viewer receives offer from host",
              offer["from"] == "hostuser" and offer["sdp"]["sdp"] == "v=0-fake", str(offer))

        await viewer.send(json.dumps({
            "type": "screen:answer", "target": "hostuser", "sdp": {"type": "answer", "sdp": "v=0-ans"},
        }))
        answer = await recv_type(host, "screen:answer")
        check("host receives answer", answer["sdp"]["sdp"] == "v=0-ans", str(answer))

        # --- 4. ICE relays both directions -----------------------------------
        await host.send(json.dumps({
            "type": "screen:ice", "target": "viewer1", "candidate": {"candidate": "cand-h"},
        }))
        ice_v = await recv_type(viewer, "screen:ice")
        check("ICE host -> viewer", ice_v["candidate"]["candidate"] == "cand-h", str(ice_v))

        await viewer.send(json.dumps({
            "type": "screen:ice", "target": "hostuser", "candidate": {"candidate": "cand-v"},
        }))
        ice_h = await recv_type(host, "screen:ice")
        check("ICE viewer -> host", ice_h["candidate"]["candidate"] == "cand-v", str(ice_h))

        # --- 5. a late joiner learns a share is already running --------------
        late = await websockets.connect(f"{WS}/ws/{room_id}?username=latecomer")
        late_start = await recv_type(late, "screen:start")
        check("late joiner told about active share",
              late_start["username"] == "hostuser", str(late_start))

        # --- 6. members may not hijack the share -----------------------------
        await viewer.send(json.dumps({"type": "screen:start"}))
        err = await recv_type(viewer, "error")
        check("member blocked from sharing", "permission" in err["message"].lower(), str(err))

        # --- 7. duplicate usernames are rejected -----------------------------
        dup = await websockets.connect(f"{WS}/ws/{room_id}?username=viewer1")
        dup_err = await recv_type(dup, "error")
        check("duplicate username rejected", dup_err.get("code") == "name_taken", str(dup_err))
        await dup.close()

        # --- 8. sharer drops -> viewers are told to stop ---------------------
        await host.close()
        stopped = await recv_type(viewer, "screen:stop")
        check("viewer told to stop when sharer drops",
              stopped["username"] == "hostuser", str(stopped))

        # --- 9. admin is handed over so the room stays usable ----------------
        handover = await recv_type(viewer, "role:assigned", timeout=5.0)
        check("admin transferred after host left", handover["role"] == "admin", str(handover))

        await viewer.close()
        await late.close()
    finally:
        server.should_exit = True
        await task
        for suffix in ("", "-shm", "-wal"):
            p = f"./_e2e_test.db{suffix}"
            if os.path.exists(p):
                os.remove(p)

    print()
    if failures:
        print(f"{len(failures)} CHECK(S) FAILED: {', '.join(failures)}")
        sys.exit(1)
    print("ALL SCREEN-SHARE SIGNALLING CHECKS PASSED")


asyncio.run(main())

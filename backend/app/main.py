"""Imperial Base backend — FastAPI + WebSockets, local-first, read-only observation of Claude Code."""
from __future__ import annotations

import asyncio
import contextlib
import time
from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config, system
from .engine import Engine
from .store import Store


def create_app(db_path: str | None = None, spool_path: str | None = None, start_tailer: bool = True) -> FastAPI:
    store = Store(db_path or config.DB_PATH)
    from pathlib import Path

    engine = Engine(store, Path(spool_path) if spool_path else config.SPOOL_PATH)
    clients: set[WebSocket] = set()

    async def system_loop() -> None:
        system.sample()  # prime psutil cpu_percent
        while True:
            await asyncio.sleep(config.SYSTEM_SAMPLE_SECONDS)
            if clients:  # only sample while someone is watching
                data = await asyncio.to_thread(system.sample)
                await engine.broadcast({"type": "system", "system": data})

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI):
        tasks = []
        if start_tailer:
            tasks.append(asyncio.create_task(engine.tail_spool_forever()))
            tasks.append(asyncio.create_task(system_loop()))
        yield
        for t in tasks:
            t.cancel()

    app = FastAPI(title="Imperial Base", version="0.1.0", lifespan=lifespan)
    app.state.engine = engine

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {"ok": True, "service": "imperial-base", "ingest": engine.status()}

    @app.get("/api/snapshot")
    def snapshot() -> dict[str, Any]:
        return engine.snapshot()

    @app.get("/api/agents")
    def agents() -> list[dict[str, Any]]:
        now = time.time()
        return [a.public(now, config.STALE_AFTER_SECONDS) for a in engine.registry.agents.values()]

    @app.get("/api/agents/{agent_key:path}")
    def agent(agent_key: str) -> dict[str, Any]:
        a = engine.registry.agents.get(agent_key)
        if not a:
            raise HTTPException(404, "unknown agent")
        tasks = [t.__dict__ for t in engine.registry.tasks.values() if t.agent_id == agent_key]
        return {"agent": a.public(stale_after=config.STALE_AFTER_SECONDS), "tasks": tasks,
                "events": store.recent_events(100, agent_key=agent_key)}

    @app.get("/api/events")
    def events(limit: int = 200, session_id: str | None = None) -> list[dict[str, Any]]:
        return store.recent_events(min(max(limit, 1), 2000), session_id=session_id)

    @app.get("/api/tasks")
    def tasks() -> list[dict[str, Any]]:
        return [t.__dict__ for t in engine.registry.tasks.values()]

    @app.get("/api/sessions")
    def sessions() -> list[dict[str, Any]]:
        out = []
        for a in engine.registry.agents.values():
            if a.kind == "main":
                d = a.public(stale_after=config.STALE_AFTER_SECONDS)
                d["subagents"] = len(a.children)
                out.append(d)
        return sorted(out, key=lambda d: d["last_event_at"], reverse=True)

    @app.get("/api/schema")
    def schema() -> dict[str, Any]:
        """Top-level hook payload keys actually observed at runtime, per event (validation evidence)."""
        return {k: sorted(v) for k, v in sorted(engine.schema_keys.items())}

    @app.get("/api/system")
    async def system_info() -> dict[str, Any]:
        data = await asyncio.to_thread(system.sample)
        data["docker"] = await asyncio.to_thread(system.docker_status)
        return data

    @app.post("/api/ingest")
    async def ingest(request: Request) -> JSONResponse:
        """Direct ingestion (loopback only). Same validation as the spool."""
        if request.client and request.client.host not in ("127.0.0.1", "::1", "localhost", "testclient"):
            raise HTTPException(403, "loopback only")
        body = await request.json()
        recs = body if isinstance(body, list) else [body]
        n = 0
        for r in recs[:500]:
            if await engine.ingest(r):
                n += 1
        return JSONResponse({"accepted": n})

    @app.get("/api/commands")
    def commands() -> dict[str, Any]:
        # Observation-only by design. Command dispatch will require a real, supported integration
        # and explicit Commander authorisation; none is enabled.
        return {"enabled": False, "available": [], "note": "Imperial Base is observation-only. No agent commands are implemented."}

    @app.websocket("/ws")
    async def ws(sock: WebSocket) -> None:
        await sock.accept()
        clients.add(sock)

        async def push(msg: dict[str, Any]) -> None:
            await sock.send_json(msg)

        engine.listeners.add(push)
        try:
            await sock.send_json(engine.snapshot())
            await sock.send_json({"type": "system", "system": await asyncio.to_thread(system.sample)})
            while True:
                msg = await sock.receive_json()
                if isinstance(msg, dict) and msg.get("type") == "ping":
                    await sock.send_json({"type": "pong", "ts": time.time()})
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            engine.listeners.discard(push)
            clients.discard(sock)

    dist = config.FRONTEND_DIST
    if dist.is_dir() and (dist / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{path:path}")
        def spa(path: str):
            f = dist / path
            if path and f.is_file() and dist in f.resolve().parents:
                return FileResponse(f)
            return FileResponse(dist / "index.html")

    return app


# Run with: uvicorn --factory app.main:create_app

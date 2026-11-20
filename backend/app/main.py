"""Imperial Base backend — FastAPI + WebSockets, local-first.

Observes Claude Code through hooks, and (since the Commander asked for it) can start agents in this
project folder from the base's chat: see orders.py for the rules that apply to those.
"""
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
from .orders import OrderError, OrderManager, Runner
from .store import Store


LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1", "[::1]"}
# The Vite dev servers (dev.cmd and the QA preview) serve the base's pages from these ports.
DEV_ORIGINS = {f"http://{h}:{p}" for h in ("127.0.0.1", "localhost", "[::1]") for p in (5273, 5274)}


def _hostname(value: str) -> str:
    """Host part of a Host header or an Origin (scheme and port removed)."""
    v = value.split("://", 1)[-1].split("/", 1)[0]
    if v.startswith("["):
        return v.split("]", 1)[0] + "]"
    return v.rsplit(":", 1)[0] if ":" in v else v


def _own_origin(origin: str, host_header: str) -> bool:
    """True when a page's Origin is the base itself: the exact scheme, host and port it was served from
    (the same as the Host it connects to), or one of the Vite dev servers. Host names alone are not enough:
    any other program serving a page on 127.0.0.1 at a different port would otherwise pass."""
    o = origin.strip().lower().rstrip("/")
    return o == f"http://{host_header.strip().lower()}" or o in DEV_ORIGINS


def require_local(request: Request) -> None:
    """Refuse anything that is not this machine talking to itself.

    Starting an agent is far more powerful than reading state, so three things are checked: the caller's
    address, the Host header (a web page that points its own domain name at 127.0.0.1 still sends its
    own name here), and the Origin header (a page on another site sends that site). The body must be
    declared as JSON, which a cross-site form or a simple request cannot do without the browser asking first.
    """
    if request.client and request.client.host not in LOCAL_HOSTS:
        raise HTTPException(403, "loopback only")
    host = request.headers.get("host", "")
    if _hostname(host) not in LOCAL_HOSTS:
        raise HTTPException(403, "loopback only")
    origin = request.headers.get("origin")
    if origin and not _own_origin(origin, host):
        raise HTTPException(403, "cross-site requests are refused")
    if request.method == "POST" and not request.headers.get("content-type", "").lower().startswith("application/json"):
        raise HTTPException(415, "send JSON")


def create_app(db_path: str | None = None, spool_path: str | None = None, start_tailer: bool = True,
               order_runner: Runner | None = None, orders_cwd: str | None = None) -> FastAPI:
    store = Store(db_path or config.DB_PATH)
    from pathlib import Path

    engine = Engine(store, Path(spool_path) if spool_path else config.SPOOL_PATH)
    clients: set[WebSocket] = set()
    orders = OrderManager(Path(orders_cwd) if orders_cwd else config.ORDERS_CWD, engine.broadcast,
                          runner=order_runner, enabled=config.ORDERS_ENABLED)

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
        await orders.shutdown()

    app = FastAPI(title="Imperial Base", version="0.1.0", lifespan=lifespan)
    app.state.engine = engine
    app.state.orders = orders

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
        if request.client and request.client.host not in LOCAL_HOSTS:
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
        st = orders.status()
        return {"enabled": st["enabled"], "available": ["orders"] if st["enabled"] else [],
                "note": "Orders start a Claude Code agent in the base's own folder. Everything else is observation only."}

    # ---- orders: the Commander's chat (see orders.py)
    async def order_text(request: Request) -> Any:
        require_local(request)
        try:
            body = await request.json()
        except ValueError:
            raise HTTPException(400, "send JSON")
        return body.get("text") if isinstance(body, dict) else None

    def refuse(e: OrderError) -> HTTPException:
        return HTTPException(e.status, str(e))

    @app.get("/api/orders")
    def list_orders(request: Request) -> dict[str, Any]:
        require_local(request)
        return {**orders.status(), "orders": orders.list()}

    @app.post("/api/orders")
    async def new_order(request: Request) -> dict[str, Any]:
        text = await order_text(request)
        try:
            return (await orders.start(text)).public()
        except OrderError as e:
            raise refuse(e)

    @app.post("/api/orders/{order_id}/messages")
    async def order_message(order_id: str, request: Request) -> dict[str, Any]:
        text = await order_text(request)
        try:
            return (await orders.send(order_id, text)).public()
        except OrderError as e:
            raise refuse(e)

    @app.post("/api/orders/{order_id}/stop")
    async def order_stop(order_id: str, request: Request) -> dict[str, Any]:
        require_local(request)
        try:
            return (await orders.stop(order_id)).public()
        except OrderError as e:
            raise refuse(e)

    @app.websocket("/ws")
    async def ws(sock: WebSocket) -> None:
        # Browsers let any web page open a websocket to any address, so the page's Origin is checked here.
        # A page from anywhere else (its Origin is not exactly the scheme, host and port it connected to,
        # nor a Vite dev server) is refused outright.
        host_header = sock.headers.get("host", "")
        host = _hostname(host_header)
        origin = sock.headers.get("origin")
        if origin and not _own_origin(origin, host_header):
            await sock.close(code=1008)
            return
        # Conversations with agents go only to this machine talking to itself (same rule as the order endpoints).
        local = host in LOCAL_HOSTS and (sock.client is None or sock.client.host in LOCAL_HOSTS)
        await sock.accept()
        clients.add(sock)

        async def push(msg: dict[str, Any]) -> None:
            if not local and msg.get("type") in ("order", "orders"):
                return
            await sock.send_json(msg)

        engine.listeners.add(push)
        try:
            await sock.send_json(engine.snapshot())
            await sock.send_json({"type": "system", "system": await asyncio.to_thread(system.sample)})
            if local:
                await sock.send_json({"type": "orders", **orders.status(), "orders": orders.list()})
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

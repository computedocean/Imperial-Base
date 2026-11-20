"""Imperial Base backend — FastAPI + WebSockets, local-first.

Observes Claude Code through hooks, and (when IMPERIAL_ORDERS=1) can start agents in a separate workspace
folder from the base's chat: see orders.py for the rules that apply to those.
"""
from __future__ import annotations

import asyncio
import contextlib
import hmac
import json
import os
import re
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config, system
from .engine import Engine
from .orders import OrderError, OrderManager, Runner
from .pathsafe import safe_relative_under
from .store import Store

MAX_ORDER_BODY_BYTES = 64 * 1024  # an order is at most 8000 characters; this leaves room for JSON escaping
MAX_WS_CLIENTS = 32  # live sockets open at once; the base's own tabs need one each
MAX_WS_MESSAGE = 4096  # characters per message from a socket (only pings are expected)


# ---------------------------------------------------------------------------- the local boundary (M2, M3)
#
# Every HTTP request and WebSocket handshake passes through LocalBoundary before any route runs. A web page can make
# the browser send requests to 127.0.0.1, and a site can point its own name at 127.0.0.1 (DNS rebinding) so that its
# page counts as the same origin; the Host header still carries the site's name and port. So the Host must be
# exactly one loopback name with the port the server is actually listening on, the caller must be a loopback
# address, any Origin must be exactly that Host, and a browser that says the request is cross-site is refused on
# /api and /ws. Forwarding headers (X-Forwarded-Host, Forwarded) are never read: nothing can override the Host.

LOOPBACK_PEERS = {"127.0.0.1", "::1"}
_HOST_RE = re.compile(r"(127\.0\.0\.1|localhost|\[::1\])(?::([1-9][0-9]{0,4}))?")
DEV_PROXY_HEADER = b"x-imperial-dev-proxy"
_TOKEN_RE = re.compile(rb"[A-Za-z0-9_-]{32,128}")


def parse_host(value: str) -> tuple[str, int | None] | None:
    """(name, port) for an exact loopback Host header, else None. Accepted: ``127.0.0.1``, ``localhost`` and
    ``[::1]`` (any letter case), optionally with a decimal port 1-65535 without leading zeros. Refused: other names
    (including ones that resolve to 127.0.0.1), user info (``a@127.0.0.1``), trailing dots, spaces, extra colons,
    other IPv6 spellings, percent-encoding, paths, and anything over 64 characters."""
    if not isinstance(value, str) or not value or len(value) > 64:
        return None
    m = _HOST_RE.fullmatch(value.lower())
    if m is None:
        return None
    port = int(m.group(2)) if m.group(2) else None
    if port is not None and port > 65535:
        return None
    return m.group(1), port


def dev_proxy_token(port: int) -> bytes | None:
    """The token the Vite dev server listening on ``port`` wrote when it started, or None if there is none."""
    path = config.DEV_PROXY_DIR / f"vite-{port}.token"
    try:
        with open(path, "rb") as fh:
            token = fh.read(256).strip()
    except OSError:
        return None
    return token if _TOKEN_RE.fullmatch(token) else None


def boundary_problem(scope: dict[str, Any]) -> str | None:
    """Why a request or handshake is refused (a short code), or None. Pure function of the ASGI scope plus the
    dev-proxy token file; called before any route sees the request."""
    headers = [(k.lower(), v) for k, v in scope.get("headers") or []]

    def values(name: bytes) -> list[bytes]:
        return [v for k, v in headers if k == name]

    hosts = values(b"host")
    if len(hosts) != 1:
        return "host"
    try:
        host_text = hosts[0].decode("ascii")
    except UnicodeDecodeError:
        return "host"
    parsed = parse_host(host_text)
    if parsed is None:
        return "host"
    client = scope.get("client")
    if not client or client[0] not in LOOPBACK_PEERS:
        return "peer"
    server = scope.get("server")
    server_port = server[1] if server and len(server) > 1 and isinstance(server[1], int) else config.PORT
    port = parsed[1] if parsed[1] is not None else 80
    if port != server_port:
        # Only the base's own Vite dev server may forward a request that names its port, proved by the token it
        # wrote at start-up. Another program on that port does not know it; with no dev server there is no token.
        if port not in config.DEV_PROXY_PORTS:
            return "port"
        sent = values(DEV_PROXY_HEADER)
        expected = dev_proxy_token(port)
        if len(sent) != 1 or expected is None or not hmac.compare_digest(sent[0], expected):
            return "port"
    origins = values(b"origin")
    if len(origins) > 1:
        return "origin"
    if origins:
        try:
            origin = origins[0].decode("ascii")
        except UnicodeDecodeError:
            return "origin"
        if origin.lower() != f"http://{host_text.lower()}":
            return "origin"
    path = scope.get("path") or ""
    if path.startswith(("/api/", "/ws")) or path == "/api":
        site = values(b"sec-fetch-site")
        if len(site) > 1 or (site and site[0].lower() not in (b"same-origin", b"none")):
            return "fetch-site"
    return None


class LocalBoundary:
    """ASGI middleware: refuse anything ``boundary_problem`` objects to, before routing (HTTP 403, or a WebSocket
    closed before it is accepted, which the server turns into a 403 handshake response)."""

    def __init__(self, app: Any):
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] in ("http", "websocket"):
            problem = boundary_problem(scope)
            if problem is not None:
                if scope["type"] == "http":
                    body = json.dumps({"detail": "refused: this server only talks to the base on this machine",
                                       "code": problem}).encode()
                    await send({"type": "http.response.start", "status": 403,
                                "headers": [(b"content-type", b"application/json"),
                                            (b"content-length", str(len(body)).encode())]})
                    await send({"type": "http.response.body", "body": body})
                else:
                    await send({"type": "websocket.close", "code": 1008})
                return
        await self.app(scope, receive, send)


def require_local(request: Request) -> None:
    """The boundary check again (defence in depth for the endpoints that change state), plus: a POST body must be
    declared as JSON, which a cross-site form or a simple request cannot do without the browser asking first."""
    if boundary_problem(request.scope) is not None:
        raise HTTPException(403, "loopback only")
    if request.method == "POST" and not _is_json_type(request.headers.get("content-type", "")):
        raise HTTPException(415, "send JSON")


def _is_json_type(content_type: str) -> bool:
    """Exactly application/json (parameters such as charset allowed); not text/plain, not application/jsonp."""
    return content_type.split(";", 1)[0].strip().lower() == "application/json"


async def read_json_limited(request: Request, limit: int) -> Any:
    """The JSON body, refused with 413 once it passes ``limit`` bytes (checked on the declared length and again
    while reading, so a missing or false Content-Length does not help), or 400 if it is not JSON."""
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            if int(declared) > limit:
                raise HTTPException(413, "request body too large")
        except ValueError:
            raise HTTPException(400, "bad Content-Length")
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise HTTPException(413, "request body too large")
        chunks.append(chunk)
    try:
        return json.loads(b"".join(chunks) or b"null")
    except ValueError:
        raise HTTPException(400, "send JSON")


def create_app(db_path: str | None = None, spool_path: str | None = None, start_tailer: bool = True,
               order_runner: Runner | None = None, orders_cwd: str | None = None) -> FastAPI:
    store = Store(db_path or config.DB_PATH)
    engine = Engine(store, Path(spool_path) if spool_path else config.SPOOL_PATH)
    clients: set[WebSocket] = set()
    orders = OrderManager(Path(orders_cwd) if orders_cwd else config.ORDERS_CWD, engine.broadcast,
                          runner=order_runner, enabled=config.ORDERS_ENABLED,
                          protected=config.protected_paths(), settings_dir=config.ORDERS_SETTINGS_DIR,
                          read_access=config.ORDERS_READ)

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
        record = None
        if start_tailer:  # a real server (tests run with start_tailer=False and leave no records behind)
            tasks.append(asyncio.create_task(engine.tail_spool_forever()))
            tasks.append(asyncio.create_task(system_loop()))
            record = write_run_record(config.RUN_DIR)
        yield
        for t in tasks:
            t.cancel()
        await orders.shutdown()
        if record is not None:
            with contextlib.suppress(OSError):
                record.unlink()

    app = FastAPI(title="Imperial Base", version="0.1.0", lifespan=lifespan, debug=False)
    app.add_middleware(LocalBoundary)
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
        """Direct ingestion. Same record validation as the spool, plus the same request checks as the order
        endpoints: loopback caller and Host, the base's own Origin if one is sent, a JSON body, size-limited.
        (A web page could otherwise post a text/plain body here without the browser asking first.)"""
        require_local(request)
        body = await read_json_limited(request, config.MAX_INGEST_BYTES)
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
                "note": "Orders start a Claude Code agent in a separate workspace folder. Everything else is "
                        "observation only."}

    # ---- orders: the Commander's chat (see orders.py)
    async def order_text(request: Request) -> Any:
        require_local(request)
        body = await read_json_limited(request, MAX_ORDER_BODY_BYTES)
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
        # LocalBoundary has already refused other hosts, ports, callers and Origins before this handler runs (a
        # browser lets any page open a websocket to any address). Checked again here as a second layer.
        if boundary_problem(sock.scope) is not None:
            await sock.close(code=1008)
            return
        if len(clients) >= MAX_WS_CLIENTS:
            await sock.close(code=1013)  # try again later
            return
        await sock.accept()
        clients.add(sock)

        async def push(msg: dict[str, Any]) -> None:
            await sock.send_json(msg)

        engine.listeners.add(push)
        try:
            await sock.send_json(engine.snapshot())
            await sock.send_json({"type": "system", "system": await asyncio.to_thread(system.sample)})
            await sock.send_json({"type": "orders", **orders.status(), "orders": orders.list()})
            while True:
                text = await sock.receive_text()
                if len(text) > MAX_WS_MESSAGE:
                    await sock.close(code=1009)  # too big
                    break
                try:
                    msg = json.loads(text)
                except ValueError:
                    continue
                if isinstance(msg, dict) and msg.get("type") == "ping":
                    await sock.send_json({"type": "pong", "ts": time.time()})
        except (WebSocketDisconnect, RuntimeError, KeyError):  # KeyError: a binary frame where text was expected
            pass
        finally:
            engine.listeners.discard(push)
            clients.discard(sock)

    dist = config.FRONTEND_DIST
    if dist.is_dir() and (dist / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        index = dist / "index.html"

        @app.get("/{path:path}")
        def spa(path: str):
            # The path is checked as text and resolved inside dist before any filesystem call on it; anything
            # odd (backslashes, colons, .., a UNC or drive path) simply gets the app page, like any unknown route.
            f = safe_relative_under(path, dist)
            if f is not None and f.is_file():
                return FileResponse(f)
            return FileResponse(index)

    return app


def write_run_record(run_dir: Path) -> Path | None:
    """Note this server process (and its parent: with --reload the parent holds the listening socket) with their
    start times, so scripts/stop.ps1 can tell the base's own server from an unrelated program on the same port.
    Best effort: without a record the stop script simply leaves the process alone."""
    try:
        import psutil

        me = psutil.Process(os.getpid())
        parent = me.parent()
        data = {"kind": "backend", "pid": me.pid, "started": me.create_time(),
                "parent": parent.pid if parent else None, "parent_started": parent.create_time() if parent else None}
        run_dir.mkdir(parents=True, exist_ok=True)
        path = run_dir / f"backend-{me.pid}.json"
        tmp = run_dir / f"backend-{me.pid}.json.tmp"
        tmp.write_text(json.dumps(data), encoding="utf-8")
        tmp.replace(path)
        return path
    except Exception:  # never stop the server over this; the stop script then refuses to touch the process
        return None


# Run with: uvicorn --factory app.main:create_app

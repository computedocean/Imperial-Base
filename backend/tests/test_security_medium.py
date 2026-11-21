"""Regression tests for the remaining findings.

M2  Host validation / DNS rebinding for every HTTP endpoint and the WebSocket handshake
M3  dev-server (5273/5274) trust: a per-launch token, never the port number alone
M4  secret redaction in the hook and again on the server (literal expected strings, written by hand)
N1  Orders file boundary: the PreToolUse guard (workspace only), read tools off by default
H1  follow-up: user and managed Claude Code settings that could widen access keep orders off
N3  one securely created settings file per launch, removed when the agent ends
N4  Windows letter case, slashes and drive letters in path checks
9   operational: stop.ps1 identity checks, size bounds, hook_installed with CLAUDE_CONFIG_DIR, error pages

No agent is ever started: subprocess.Popen is replaced by fakes, taskkill is replaced by a recorder, and the real
user's Claude Code settings are never read (an isolated folder stands in). Processes started here are small
Python listeners on 127.0.0.1 owned by the test, and the guard script itself.
"""
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urljoin

import pytest
from fastapi.testclient import TestClient as _TestClient
from starlette.websockets import WebSocketDisconnect

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app import config, engine as engine_mod, main as main_mod, orders as orders_mod, orders_guard, state as state_mod  # noqa: E402
from app.engine import sanitise  # noqa: E402
from app.main import boundary_problem, create_app, parse_host  # noqa: E402
from app.redact import redact_text  # noqa: E402

WIN = sys.platform == "win32"
HOOK = ROOT / "hooks" / "imperial-hook.js"
GUARD = ROOT / "backend" / "app" / "orders_guard.py"


class Client(_TestClient):
    """A local client on 127.0.0.1:8742 whose WebSocket goes to the same address."""

    def websocket_connect(self, url, *args, headers=None, **kwargs):
        return super().websocket_connect(urljoin("ws://127.0.0.1:8742", url), *args,
                                         headers={"host": "127.0.0.1:8742", **(headers or {})}, **kwargs)


def local(app, peer=("127.0.0.1", 50000)):
    return Client(app, base_url="http://127.0.0.1:8742", client=peer)


@pytest.fixture()
def app(tmp_path, monkeypatch):
    monkeypatch.setattr(main_mod.system, "sample", lambda: {"cpu": 1})
    monkeypatch.setattr(main_mod.system, "docker_status", lambda: {"available": False})
    monkeypatch.setattr(config, "DEV_PROXY_DIR", tmp_path / "dev-proxy")
    monkeypatch.setattr(config, "FRONTEND_DIST", tmp_path / "no-dist")
    return create_app(db_path=str(tmp_path / "t.db"), spool_path=str(tmp_path / "s.jsonl"), start_tailer=False)


def ev(event, sid="S1", **kw):
    return {"v": 1, "event": event, "session_id": sid, "ts": "2026-11-20T04:00:00.000Z", **kw}


def scope(host="127.0.0.1:8742", peer=("127.0.0.1", 5), server=("127.0.0.1", 8742), path="/api/snapshot",
          extra=(), kind="http"):
    headers = [] if host is None else [(b"host", host.encode("latin-1"))]
    headers += [(k.encode("latin-1"), v.encode("latin-1")) for k, v in extra]
    return {"type": kind, "path": path, "headers": headers, "client": peer, "server": server}


# ====================================================================== M2: Host validation

SENSITIVE_GETS = ["/api/health", "/api/snapshot", "/api/agents", "/api/agents/session:S1", "/api/events",
                  "/api/events?session_id=S1", "/api/tasks", "/api/sessions", "/api/schema", "/api/system",
                  "/api/commands", "/api/orders"]


@pytest.mark.parametrize("value,expected", [
    ("127.0.0.1:8742", ("127.0.0.1", 8742)),
    ("localhost:8742", ("localhost", 8742)),
    ("LOCALHOST:8742", ("localhost", 8742)),
    ("[::1]:8742", ("[::1]", 8742)),
    ("127.0.0.1", ("127.0.0.1", None)),
    ("localhost:65535", ("localhost", 65535)),
    ("127.0.0.1:65536", None), ("127.0.0.1:08742", None), ("127.0.0.1:0", None), ("127.0.0.1:", None),
    ("evil.example:8742", None), ("127.0.0.1.nip.io:8742", None), ("attacker.localhost:8742", None),
    ("user@127.0.0.1:8742", None), ("127.0.0.1:8742@evil.example", None), ("localhost.:8742", None),
    (" 127.0.0.1:8742", None), ("127.0.0.1:8742 ", None), ("127.0.0.1 :8742", None), ("127.0.0.1:8742/x", None),
    ("127.1:8742", None), ("2130706433:8742", None), ("0x7f000001:8742", None), ("0.0.0.0:8742", None),
    ("127.0.0.2:8742", None), ("[::ffff:127.0.0.1]:8742", None), ("[0:0:0:0:0:0:0:1]:8742", None),
    ("::1:8742", None), ("[::1]8742", None), ("127.0.0.1:8742:8742", None), ("%31%32%37.0.0.1:8742", None),
    ("", None), ("l" * 70, None),
])
def test_parse_host_accepts_only_exact_loopback_forms(value, expected):
    assert parse_host(value) == expected


@pytest.mark.parametrize("host", ["evil.example:8742", "127.0.0.1.nip.io:8742", "localtest.me:8742",
                                  "127.0.0.1:8743", "127.0.0.1:80", "127.0.0.1", "localhost", "[::1]:9000",
                                  "user@127.0.0.1:8742", "127.0.0.1:8742.", "0.0.0.0:8742", "192.168.1.5:8742", ""])
def test_boundary_refuses_rebinding_and_alternate_hosts_and_ports(host):
    assert boundary_problem(scope(host=host)) in ("host", "port")


@pytest.mark.parametrize("host", ["127.0.0.1:8742", "localhost:8742", "Localhost:8742", "[::1]:8742"])
def test_boundary_accepts_the_loopback_names_on_the_server_port(host):
    assert boundary_problem(scope(host=host)) is None


def test_boundary_uses_the_port_the_server_actually_listens_on():
    assert boundary_problem(scope(host="127.0.0.1:8743", server=("127.0.0.1", 8743))) is None
    assert boundary_problem(scope(host="127.0.0.1:8742", server=("127.0.0.1", 8743))) == "port"


def test_boundary_refuses_missing_duplicate_and_non_ascii_hosts():
    assert boundary_problem(scope(host=None)) == "host"
    s = scope(extra=[("host", "127.0.0.1:8742")])  # two Host headers
    assert boundary_problem(s) == "host"
    s = scope(host=None)
    s["headers"] = [(b"host", "lo\u0441alhost:8742".encode("utf-8"))]  # Cyrillic "c"
    assert boundary_problem(s) == "host"


@pytest.mark.parametrize("peer", [("192.168.1.9", 5), ("10.0.0.1", 5), ("127.0.0.2", 5), ("testclient", 5), None])
def test_boundary_refuses_callers_that_are_not_loopback(peer):
    assert boundary_problem(scope(peer=peer)) == "peer"
    assert boundary_problem(scope(peer=("::1", 5))) is None


def test_forwarding_headers_cannot_override_the_host():
    fwd = [("x-forwarded-host", "127.0.0.1:8742"), ("forwarded", "host=127.0.0.1:8742"),
           ("x-forwarded-for", "127.0.0.1"), ("x-real-ip", "127.0.0.1"), ("x-original-host", "127.0.0.1:8742")]
    assert boundary_problem(scope(host="evil.example:8742", extra=fwd)) == "host"
    assert boundary_problem(scope(peer=("192.168.1.9", 5), extra=fwd)) == "peer"
    bad_fwd = [("x-forwarded-host", "evil.example"), ("forwarded", "host=evil.example")]
    assert boundary_problem(scope(extra=bad_fwd)) is None  # ignored either way: they never decide anything


@pytest.mark.parametrize("origin,ok", [
    (None, True), ("http://127.0.0.1:8742", True), ("HTTP://127.0.0.1:8742", True),
    ("http://127.0.0.1:8742/", False), ("null", False), ("https://127.0.0.1:8742", False),
    ("http://localhost:8742", False),  # a different origin than the Host the page connected to
    ("http://127.0.0.1:5273", False), ("http://127.0.0.1:3000", False), ("http://evil.example", False),
    ("http://127.0.0.1:8742.evil.example", False), ("file://", False), ("", False),
])
def test_origin_must_be_exactly_the_host(origin, ok):
    extra = [] if origin is None else [("origin", origin)]
    assert (boundary_problem(scope(extra=extra)) is None) is ok


def test_two_origin_headers_are_refused():
    assert boundary_problem(scope(extra=[("origin", "http://127.0.0.1:8742")] * 2)) == "origin"


@pytest.mark.parametrize("site,path,ok", [
    ("same-origin", "/api/snapshot", True), ("none", "/api/snapshot", True),
    ("cross-site", "/api/snapshot", False), ("same-site", "/api/orders", False), ("cross-site", "/ws", False),
    ("cross-site", "/", True), ("cross-site", "/some/route", True),  # following a link to the app still works
])
def test_cross_site_fetches_of_the_api_are_refused(site, path, ok):
    assert (boundary_problem(scope(path=path, extra=[("sec-fetch-site", site)])) is None) is ok


@pytest.mark.parametrize("url", SENSITIVE_GETS)
@pytest.mark.parametrize("host", ["evil.example:8742", "127.0.0.1:8743", "localhost", "user@127.0.0.1:8742"])
def test_every_sensitive_get_is_refused_before_its_handler(app, url, host):
    eng = app.state.engine
    called = []
    eng.snapshot = lambda: called.append("snapshot")
    eng.status = lambda: called.append("status")
    with local(app) as c:
        r = c.get(url, headers={"host": host})
    assert r.status_code == 403
    assert r.json()["code"] in ("host", "port")  # answered by the boundary, not by the route
    assert called == []


@pytest.mark.parametrize("url", SENSITIVE_GETS)
def test_every_sensitive_get_refuses_a_forged_origin_and_a_remote_caller(app, url):
    with local(app) as c:
        assert c.get(url, headers={"origin": "http://evil.example"}).status_code == 403
    with local(app, peer=("192.168.1.9", 50000)) as c:
        assert c.get(url).status_code == 403


@pytest.mark.parametrize("url", SENSITIVE_GETS)
def test_every_sensitive_get_still_works_locally(app, url):
    with local(app) as c:
        assert c.get(url).status_code in (200, 404)  # 404: the agent does not exist
        assert c.get(url, headers={"origin": "http://127.0.0.1:8742"}).status_code in (200, 404)


@pytest.mark.parametrize("headers", [
    {"host": "evil.example:8742", "origin": "http://evil.example:8742"},  # DNS rebinding: Origin matches its Host
    {"host": "127.0.0.1:8743"}, {"host": "localhost"}, {"origin": "http://evil.example"}, {"origin": "null"},
    {"origin": "http://127.0.0.1:5273"}, {"sec-fetch-site": "cross-site"},
])
def test_websocket_handshake_is_refused_before_anything_is_sent(app, headers):
    called = []
    app.state.engine.snapshot = lambda: called.append("snapshot") or {"type": "snapshot"}
    with local(app) as c:
        with pytest.raises(WebSocketDisconnect):
            with c.websocket_connect("/ws", headers=headers):
                pass
    assert called == []


def test_websocket_from_a_remote_caller_is_refused(app):
    with local(app, peer=("192.168.1.9", 50000)) as c:
        with pytest.raises(WebSocketDisconnect):
            with c.websocket_connect("/ws"):
                pass


@pytest.mark.parametrize("headers", [{}, {"origin": "http://127.0.0.1:8742"}, {"host": "localhost:8742"},
                                     {"host": "[::1]:8742", "origin": "http://[::1]:8742"}])
def test_websocket_valid_loopback_cases_work(app, headers):
    with local(app) as c:
        with c.websocket_connect("/ws", headers=headers) as ws:
            assert ws.receive_json()["type"] == "snapshot"
            assert ws.receive_json()["type"] == "system"
            assert ws.receive_json()["type"] == "orders"


def test_post_endpoints_refuse_rebinding_hosts(app):
    with local(app) as c:
        for url in ("/api/ingest", "/api/orders", "/api/orders/x/messages", "/api/orders/x/stop"):
            r = c.post(url, json={"text": "x"}, headers={"host": "evil.example:8742", "origin": "http://evil.example:8742"})
            assert r.status_code == 403, url


def test_production_errors_do_not_show_traces(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "FRONTEND_DIST", tmp_path / "no-dist")
    app = create_app(db_path=str(tmp_path / "t.db"), spool_path=str(tmp_path / "s.jsonl"), start_tailer=False)

    @app.get("/api/boom")
    def boom():
        raise RuntimeError("internal-detail-DB_PASSWORD=hunter2")

    with Client(app, base_url="http://127.0.0.1:8742", client=("127.0.0.1", 1), raise_server_exceptions=False) as c:
        r = c.get("/api/boom")
    assert r.status_code == 500
    assert "internal-detail" not in r.text and "hunter2" not in r.text and "Traceback" not in r.text
    assert app.debug is False


# ====================================================================== M3: dev-server trust

TOKEN = "a1b2c3d4" * 8


def write_token(port, token=TOKEN):
    config.DEV_PROXY_DIR.mkdir(parents=True, exist_ok=True)
    (config.DEV_PROXY_DIR / f"vite-{port}.token").write_text(token, encoding="ascii")


def dev(port=5273, token=TOKEN, origin=True, host=None):
    h = {"host": host or f"127.0.0.1:{port}"}
    if token is not None:
        h["x-imperial-dev-proxy"] = token
    if origin:
        h["origin"] = f"http://{h['host']}"
    return h


def test_the_expected_dev_server_is_accepted(app):
    write_token(5273)
    write_token(5274, "f" * 64)
    with local(app) as c:
        assert c.get("/api/snapshot", headers=dev()).status_code == 200
        assert c.post("/api/ingest", json=ev("SessionStart"), headers=dev()).status_code == 200
        assert c.get("/api/snapshot", headers=dev(5274, "f" * 64)).status_code == 200
        with c.websocket_connect("/ws", headers=dev()) as ws:
            assert ws.receive_json()["type"] == "snapshot"


def test_no_dev_server_running_means_no_trust(app):
    with local(app) as c:  # no token file at all
        assert c.get("/api/snapshot", headers=dev()).status_code == 403
        with pytest.raises(WebSocketDisconnect):
            with c.websocket_connect("/ws", headers=dev()):
                pass


@pytest.mark.parametrize("token", [None, "", "wrong" * 10, TOKEN[:-1], TOKEN + "x", TOKEN.upper()])
def test_another_program_on_the_dev_port_is_not_trusted(app, token):
    """Something else proxying from 5273 (wrong process or server) does not know the token."""
    write_token(5273)
    with local(app) as c:
        assert c.get("/api/snapshot", headers=dev(token=token)).status_code == 403
        with pytest.raises(WebSocketDisconnect):
            with c.websocket_connect("/ws", headers=dev(token=token)):
                pass


def test_port_spoofing_is_refused(app):
    write_token(5274)  # only the QA dev server is running
    with local(app) as c:
        assert c.get("/api/snapshot", headers=dev(5273)).status_code == 403  # its token does not cover 5273
        assert c.get("/api/snapshot", headers=dev(5275)).status_code == 403  # not a dev port at all
        # a page served on a dev port talking to the backend directly: its Origin is not the Host
        assert c.get("/api/snapshot", headers={"origin": "http://127.0.0.1:5274"}).status_code == 403
        assert c.get("/api/snapshot", headers={"origin": "http://127.0.0.1:5274",
                                               "x-imperial-dev-proxy": TOKEN}).status_code == 403
        h = dev(5274)
        h["origin"] = "http://127.0.0.1:5273"  # mixed ports
        assert c.get("/api/snapshot", headers=h).status_code == 403


@pytest.mark.parametrize("host", ["evil.example:5273", "127.0.0.1.nip.io:5273", "user@127.0.0.1:5273"])
def test_a_hostile_host_with_the_right_token_is_refused(app, host):
    write_token(5273)
    with local(app) as c:
        assert c.get("/api/snapshot", headers=dev(host=host)).status_code == 403


@pytest.mark.parametrize("content", ["short", "", "x" * 300, "has space in it and is long enough to pass...",
                                     "\u00e9" * 40])
def test_a_malformed_token_file_trusts_nothing(app, content):
    config.DEV_PROXY_DIR.mkdir(parents=True, exist_ok=True)
    (config.DEV_PROXY_DIR / "vite-5273.token").write_text(content, encoding="utf-8")
    with local(app) as c:
        for header in ("short", "x" * 256, "x" * 64):
            assert c.get("/api/snapshot", headers=dev(token=header)).status_code == 403


def test_two_proxy_headers_are_refused(app):  # the app fixture points DEV_PROXY_DIR at a temporary folder
    write_token(5273)
    s = scope(host="127.0.0.1:5273", extra=[("x-imperial-dev-proxy", TOKEN), ("x-imperial-dev-proxy", TOKEN)])
    assert boundary_problem(s) == "port"


def test_vite_config_matches_the_backend():
    text = (ROOT / "frontend" / "vite.config.ts").read_text(encoding="utf-8")
    assert main_mod.DEV_PROXY_HEADER.decode() in text
    assert "strictPort: true" in text
    assert "changeOrigin" not in text  # the browser's Host reaches the backend unchanged
    assert "vite-${port}.token" in text and "'dev-proxy'" in text
    assert "process.env.VITEST" in text  # the test runner never writes tokens


# ====================================================================== M4: redaction

# (input, expected) - every expected string is written out by hand from the documented rules.
REDACTION_CASES = [
    ("DB_PASSWORD=hunter2", "DB_PASSWORD=[redacted]"),
    ("ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnop", "ANTHROPIC_API_KEY=[redacted]"),
    ('export ANTHROPIC_API_KEY="sk-ant-xyz123456789"', "export ANTHROPIC_API_KEY=[redacted]"),
    ("charge with sk_" + "live_51HxAbCdEfGhIjKlMnOpQrStUv now", "charge with [redacted] now"),
    ("test key sk_" + "test_4eC39HqLyjWDarjtT1zdp7dc", "test key [redacted]"),
    ("token hf_AbCdEfGhIjKlMnOpQrStUvWxYz12 ok", "token [redacted] ok"),
    ("remote uses glpat-AbCdEfGhIjKlMnOpQrSt", "remote uses [redacted]"),
    ("hash 0123456789abcdef0123456789abcdef done", "hash [redacted] done"),
    ("sha " + "0123456789abcdef" * 4, "sha [redacted]"),
    ("long " + "AbCdEfGhIjKlMnOpQrStUvWxYz" + "0123456789AbCd end", "long [redacted] end"),
    ("--password hunter2", "--password [redacted]"),
    ("mysql -u root --password=hunter2 db", "mysql -u root --password=[redacted] db"),
    ("gh auth login --token ghp_AbCdEfGhIjKlMnOpQrStUv12", "gh auth login --token [redacted]"),
    ('tool --api-key "abc def"', "tool --api-key [redacted]"),
    ("deploy --db-password 'p@ss w0rd' now", "deploy --db-password [redacted] now"),
    ("postgres://admin:s3cret@db.internal:5432/app", "postgres://[redacted]@db.internal:5432/app"),
    ("https://user:pa55word@example.com/path?x=1", "https://[redacted]@example.com/path?x=1"),
    ("Authorization: Bearer abc123def456ghi789", "Authorization: [redacted]"),
    ('curl -H "Authorization: Basic dXNlcjpwYXNz" https://api.example.com',
     'curl -H "Authorization: [redacted]" https://api.example.com'),
    ("Proxy-Authorization: Basic Zm9vOmJhcg==", "Proxy-Authorization: [redacted]"),
    ("authorization=token abc", "authorization=[redacted]"),
    ("bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij", "bearer [redacted]"),
    ('{"password": "hunter2", "user": "bob"}', '{"password": [redacted], "user": "bob"}'),
    ("{\"api_key\":\"abc\",\"token\":'xyz'}", "{\"api_key\":[redacted],\"token\":[redacted]}"),
    ("https://api.example.com/v1?token=abc123&page=2", "https://api.example.com/v1?token=[redacted]&page=2"),
    ("client_secret: abcd", "client_secret: [redacted]"),
    ("Password = Hunter2", "Password = [redacted]"),
    ("x-api-key: abc123", "x-api-key: [redacted]"),
    ("set GITLAB_TOKEN=glpat-AbCdEfGhIjKlMnOpQrSt", "set GITLAB_TOKEN=[redacted]"),
    ('$env:HF_TOKEN = "hf_abcdefghijklmnopqrstuvwxyz"', "$env:HF_TOKEN = [redacted]"),
    ("connect(password='x1', user='u')", "connect(password=[redacted], user='u')"),
    ("Cookie: session=abc", "Cookie: [redacted]"),
    ("key id AKIA" + "ABCDEFGHIJKLMNOP", "key id [redacted]"),
    ("contact ops@example.com", "contact [redacted]"),
    ("error: invalid api_key=abcd1234 for user bob@example.com", "error: invalid api_key=[redacted] for user [redacted]"),
    ("deploy --db-password 'p@ss w0rd' to postgres://u:p@h/db with Authorization=Bearer xyz",
     "deploy --db-password [redacted] to postgres://[redacted]@h/db with Authorization=[redacted]"),
    # ordinary text is left alone
    ("max_tokens=100 author=alice passive=true", "max_tokens=100 author=alice passive=true"),
    ("C:\\Users\\alice\\project\\main.py", "C:\\Users\\alice\\project\\main.py"),
    ("Fix the login form", "Fix the login form"),
    ("claude-opus-5-5", "claude-opus-5-5"),
]


@pytest.mark.parametrize("raw,expected", REDACTION_CASES)
def test_server_redaction_literal(raw, expected):
    assert redact_text(raw) == expected


@pytest.mark.parametrize("raw,expected", REDACTION_CASES)
def test_server_redaction_is_idempotent(raw, expected):
    assert redact_text(redact_text(raw)) == expected


def _js(fn: str, values: list) -> list:
    script = ("const h=require(process.argv[1]);let d='';process.stdin.setEncoding('utf8');"
              "process.stdin.on('data',c=>d+=c).on('end',()=>{process.stdout.write(JSON.stringify("
              f"JSON.parse(d).map(s=>{fn})))}})")
    r = subprocess.run(["node", "-e", script, str(HOOK)], input=json.dumps(values), capture_output=True,
                       encoding="utf-8", timeout=30)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_hook_redaction_literal():
    got = _js("h.redact(s)", [raw for raw, _ in REDACTION_CASES])
    for (raw, expected), out in zip(REDACTION_CASES, got):
        assert out == expected, raw


def test_hook_redaction_is_idempotent():
    got = _js("h.redact(h.redact(s))", [raw for raw, _ in REDACTION_CASES])
    assert got == [expected for _, expected in REDACTION_CASES]


def run_hook(payload, tmp_path, raw=None):
    env = {"IMPERIAL_BASE_DIR": str(tmp_path), "PATH": os.environ["PATH"], "SYSTEMROOT": os.environ.get("SYSTEMROOT", "")}
    r = subprocess.run(["node", str(HOOK)], input=raw if raw is not None else json.dumps(payload),
                       capture_output=True, encoding="utf-8", env=env, timeout=10)
    spool = tmp_path / "spool" / "events.jsonl"
    return r, (spool.read_text(encoding="utf-8") if spool.exists() else "")


def test_hook_redacts_nested_and_mixed_payloads(tmp_path):
    r, spool = run_hook({
        "hook_event_name": "PostToolUseFailure", "session_id": "S1", "tool_name": "Bash", "tool_use_id": "t1",
        "cwd": "C:\\work\\proj",
        "tool_input": {"command": "psql postgres://a:b@h", "description": "Connect with DB_PASSWORD=hunter2"},
        "error": "auth failed: token=abc123 Authorization: Bearer zzzzzzzzzzzzzz",
    }, tmp_path)
    assert r.returncode == 0 and r.stdout == ""
    rec = json.loads(spool.splitlines()[-1])
    assert rec["tool_target"] == "Connect with DB_PASSWORD=[redacted]"
    assert rec["error"] == "auth failed: token=[redacted] Authorization: [redacted]"
    for secret in ("hunter2", "abc123", "zzzzzzzzzzzzzz", "a:b@h", "psql"):
        assert secret not in spool, secret


def test_hook_redacts_fields_that_were_not_redacted_before(tmp_path):
    _, spool = run_hook({"hook_event_name": "PreToolUse", "session_id": "S1", "tool_name": "Read", "tool_use_id": "t",
                         "tool_input": {"file_path": "C:\\x\\token=abc123.txt"}}, tmp_path)
    rec = json.loads(spool.splitlines()[-1])
    assert rec["tool_target"] == "token=[redacted]"
    _, spool = run_hook({"hook_event_name": "SessionEnd", "session_id": "S2", "reason": "password: hunter2"}, tmp_path)
    assert json.loads(spool.splitlines()[-1])["reason"] == "password: [redacted]"
    _, spool = run_hook({"hook_event_name": "SessionStart", "session_id": "S3",
                         "model": {"id": "claude-opus-5-5", "note": "api_key=abc123"}}, tmp_path)
    assert "abc123" not in spool and "claude-opus-5-5" in spool


def test_hook_failure_writes_nothing_and_echoes_nothing(tmp_path):
    raw = 'not json{ "DB_PASSWORD=hunter2"'
    r, spool = run_hook(None, tmp_path, raw=raw)
    assert r.returncode == 0 and r.stdout == "" and "hunter2" not in r.stderr
    assert "hunter2" not in spool


def test_server_redacts_records_from_any_source(tmp_path):
    out = sanitise(ev("UserPromptSubmit", prompt_excerpt="use DB_PASSWORD=hunter2 please", cwd="C:\\work\\x",
                      summary="token: abc", error="Authorization: Bearer abcdefghijklmnop", tool_target="--token xyz",
                      raw_keys=["prompt", "api_key=leaked1"], model={"id": "sk-ant-api03-abcdefgh"}))
    assert out["prompt_excerpt"] == "use DB_PASSWORD=[redacted] please"
    assert out["summary"] == "token: [redacted]"
    assert out["error"] == "Authorization: [redacted]"
    assert out["tool_target"] == "--token [redacted]"
    assert out["raw_keys"] == ["prompt", "api_key=[redacted]"]
    assert out["model"] == "[redacted]"
    assert out["cwd"] == "C:\\work\\x" and out["session_id"] == "S1"  # identity fields untouched


def test_ingest_endpoint_stores_only_redacted_text(app):
    with local(app) as c:
        c.post("/api/ingest", json=ev("UserPromptSubmit", prompt_excerpt="my ANTHROPIC_API_KEY=sk-ant-zzzzzzzzzz"))
        blob = json.dumps(c.get("/api/events").json()) + json.dumps(c.get("/api/snapshot").json())
    assert "sk-ant-zzzzzzzzzz" not in blob and "ANTHROPIC_API_KEY=[redacted]" in blob


def test_spool_errors_log_the_type_only(tmp_path, monkeypatch, capsys):
    import asyncio
    eng = engine_mod.Engine(engine_mod.Store(str(tmp_path / "t.db")), tmp_path / "s.jsonl")

    async def boom():
        raise ValueError("line content DB_PASSWORD=hunter2")

    eng.poll_spool = boom
    monkeypatch.setattr(engine_mod.config, "SPOOL_POLL_SECONDS", 0.01)

    async def run_once():
        task = asyncio.create_task(eng.tail_spool_forever())
        await asyncio.sleep(0.05)
        task.cancel()

    asyncio.run(run_once())
    out = capsys.readouterr().out
    assert "ValueError" in out and "hunter2" not in out


# ====================================================================== N1 / N4: the workspace guard

ALL = ("Read", "Edit", "Write", "Glob", "Grep")


@pytest.fixture()
def box(tmp_path):
    ws = tmp_path / "ws"
    (ws / "src").mkdir(parents=True)
    (ws / "src" / "app.py").write_text("x", encoding="utf-8")
    (tmp_path / "ws2").mkdir()
    (tmp_path / "ws2" / "x.txt").write_text("x", encoding="utf-8")
    (tmp_path / "ws-other").mkdir()
    (tmp_path / "secret.txt").write_text("SECRET", encoding="utf-8")
    (tmp_path / "home" / ".ssh").mkdir(parents=True)
    (tmp_path / "home" / ".ssh" / "id_rsa").write_text("KEY", encoding="utf-8")
    return tmp_path, ws


def allowed(tool, inp, ws, tools=ALL):
    return orders_guard.decide(tool, inp, str(ws), tools)[0]


def test_guard_allows_work_inside_the_workspace(box):
    _, ws = box
    assert allowed("Read", {"file_path": str(ws / "src" / "app.py")}, ws)
    assert allowed("Edit", {"file_path": str(ws / "src" / "app.py"), "old_string": "x", "new_string": "y"}, ws)
    assert allowed("Write", {"file_path": str(ws / "new" / "file.txt"), "content": "hi"}, ws)
    assert allowed("Read", {"file_path": "src/app.py"}, ws)
    assert allowed("Glob", {"pattern": "**/*.py"}, ws)
    assert allowed("Glob", {"pattern": "*.md", "path": str(ws)}, ws)
    assert allowed("Glob", {"pattern": "*.py", "path": "src"}, ws)
    assert allowed("Grep", {"pattern": "TODO"}, ws)
    assert allowed("Grep", {"pattern": "x", "path": ".", "glob": "*.{ts,tsx}"}, ws)
    assert allowed("Grep", {"pattern": "x", "path": str(ws / "src"), "glob": "*.py"}, ws)
    assert allowed("Read", {"file_path": str(ws / "CLAUDE.md")}, ws)  # reading configuration is not writing it


def test_guard_refuses_parents_siblings_and_home_secrets(box):
    tmp, ws = box
    for target in (tmp / "secret.txt", tmp / "ws2" / "x.txt", tmp / "ws-other" / "a.txt", tmp / "home" / ".ssh" / "id_rsa",
                   tmp, Path(str(ws) + "2") / "x.txt", Path(str(ws) + "-other") / "x"):
        for tool in ("Read", "Edit", "Write"):
            assert not allowed(tool, {"file_path": str(target)}, ws), (tool, target)
        assert not allowed("Glob", {"pattern": "*", "path": str(target)}, ws), target
        assert not allowed("Grep", {"pattern": "x", "path": str(target)}, ws), target


@pytest.mark.parametrize("text", [
    "{ws}/../secret.txt", "{ws}\\..\\secret.txt", "{ws}/src/../../secret.txt", "../secret.txt", "..\\secret.txt",
    "src/../../secret.txt", "~/.ssh/id_rsa", "~", "{ws}/./src/app.py", "", "{ws}/src/app.py\x00", "{ws}/a\nb",
])
def test_guard_refuses_traversal_and_odd_text(box, text):
    _, ws = box
    path = text.replace("{ws}", str(ws))
    for tool in ("Read", "Edit", "Write"):
        assert not allowed(tool, {"file_path": path}, ws), (tool, path)


@pytest.mark.skipif(not WIN, reason="Windows path forms")
@pytest.mark.parametrize("text", [
    r"\\attacker.invalid\share\x.txt", "//attacker.invalid/share/x.txt", r"\\?\{ws}\src\app.py", r"\\.\pipe\x",
    r"\\?\UNC\attacker.invalid\share\x", r"\\localhost\c$\Windows\win.ini", "{ws}\\src\\app.py:stream",
    "{ws}\\CON", "{ws}\\nul.txt", "{ws}\\COM1.py", "C:relative.txt", "\\Windows\\win.ini",
])
def test_guard_refuses_unc_device_stream_and_drive_relative_paths(box, text):
    _, ws = box
    path = text.replace("{ws}", str(ws))
    for tool in ("Read", "Edit", "Write"):
        assert not allowed(tool, {"file_path": path}, ws), (tool, path)
    assert not allowed("Glob", {"pattern": "*", "path": path}, ws)


@pytest.mark.skipif(not WIN, reason="Windows drive letters")
def test_guard_refuses_another_drive(box):
    _, ws = box
    other = ("D" if str(ws)[0].upper() != "D" else "E") + str(ws)[1:]
    assert not allowed("Read", {"file_path": other + "\\src\\app.py"}, ws)
    assert not allowed("Write", {"file_path": other + "\\x.txt"}, ws)


@pytest.mark.skipif(not WIN, reason="case-insensitive Windows file names")
def test_guard_folds_letter_case_and_separators_on_windows(box):
    """N4: the same file in any letter case, drive-letter case or slash direction is the same file."""
    tmp, ws = box
    s = str(ws)
    variants = [s.upper() + "\\SRC\\APP.PY", s.lower() + "\\src\\app.py", s[0].lower() + s[1:] + "\\src\\app.py",
                s.replace("\\", "/") + "/src/app.py", s + "/src\\app.py"]
    for v in variants:
        assert allowed("Read", {"file_path": v}, ws), v
    # and the case variants of outside paths stay outside
    for v in (str(tmp / "secret.txt").upper(), str(tmp / "WS2" / "X.TXT"), s.upper() + "2\\x.txt",
              str(tmp / "HOME" / ".SSH" / "ID_RSA").lower()):
        assert not allowed("Read", {"file_path": v}, ws), v
    # the workspace given in another case still contains its own files
    assert allowed("Read", {"file_path": s + "\\src\\app.py"}, Path(s.upper()))


@pytest.mark.parametrize("name", ["CLAUDE.md", "claude.md", "Claude.Local.MD", ".mcp.json", ".MCP.JSON", ".claude",
                                  ".claude/settings.json", ".Claude/agents/evil.md", "sub/.CLAUDE/skills/s/SKILL.md",
                                  "a/b/CLAUDE.local.md", "sub/.mcp.json"])
def test_guard_refuses_writing_configuration_in_any_case(box, name):
    _, ws = box
    target = str(ws / Path(name))
    assert not allowed("Write", {"file_path": target, "content": "x"}, ws), name
    assert not allowed("Edit", {"file_path": target, "old_string": "a", "new_string": "b"}, ws), name


@pytest.mark.parametrize("name", ["claude_notes.md", "CLAUDE.md.txt", "mcp.json", "src/claude.py", "docs/.claudeignore"])
def test_guard_allows_ordinary_names_that_look_alike(box, name):
    _, ws = box
    assert allowed("Write", {"file_path": str(ws / Path(name)), "content": "x"}, ws), name


@pytest.mark.parametrize("pattern", ["C:/Users/**/id_rsa", "/etc/**", "\\\\host\\share\\*", "../**", "**/../x",
                                     "{..,x}/**", "~/x", "src/..", "a:b", "", "x\x00"])
def test_guard_refuses_patterns_that_leave_the_workspace(box, pattern):
    _, ws = box
    assert not allowed("Glob", {"pattern": pattern}, ws), pattern
    if pattern:
        assert not allowed("Grep", {"pattern": "x", "glob": pattern}, ws), pattern


@pytest.mark.parametrize("tool", ["Bash", "PowerShell", "WebFetch", "Agent", "NotebookEdit", "MultiEdit",
                                  "mcp__fs__read_file", "Skill", "", None, 5])
def test_guard_refuses_every_other_tool(box, tool):
    _, ws = box
    assert not allowed(tool, {"file_path": str(ws / "a.txt"), "command": "dir"}, ws)


def test_guard_refuses_read_tools_unless_they_were_granted(box):
    _, ws = box
    write_only = ("Edit", "Write")
    assert allowed("Write", {"file_path": str(ws / "a.txt")}, ws, write_only)
    for tool, inp in (("Read", {"file_path": str(ws / "src" / "app.py")}), ("Glob", {"pattern": "*"}),
                      ("Grep", {"pattern": "x"})):
        assert not allowed(tool, inp, ws, write_only), tool


def test_guard_refuses_malformed_input(box):
    _, ws = box
    for inp in (None, "C:/x", [], {"file_path": 5}, {"file_path": ["a"]}, {}):
        assert not allowed("Read", inp, ws), inp
    assert not orders_guard.decide("Read", {"file_path": "x"}, "relative/ws", ALL)[0]


def _link(link: Path, target: Path, directory: bool) -> None:
    if WIN and directory:
        r = subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], capture_output=True, text=True)
        if r.returncode != 0:
            pytest.skip("could not create a junction")
        return
    try:
        link.symlink_to(target, target_is_directory=directory)
    except (OSError, NotImplementedError):
        pytest.skip("creating symlinks needs Developer Mode or admin rights on Windows")


def test_guard_refuses_a_junction_that_leaves_the_workspace(box):
    tmp, ws = box
    outside = tmp / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("S", encoding="utf-8")
    _link(ws / "escape", outside, directory=True)
    for tool in ("Read", "Edit", "Write"):
        assert not allowed(tool, {"file_path": str(ws / "escape" / "secret.txt")}, ws), tool
    assert not allowed("Write", {"file_path": str(ws / "escape" / "new.txt")}, ws)
    assert not allowed("Glob", {"pattern": "*", "path": str(ws / "escape")}, ws)
    assert not allowed("Glob", {"pattern": "*", "path": "escape"}, ws)


def test_guard_refuses_a_file_link_that_leaves_the_workspace(box):
    tmp, ws = box
    _link(ws / "leak.txt", tmp / "secret.txt", directory=False)
    assert not allowed("Read", {"file_path": str(ws / "leak.txt")}, ws)


def test_guard_refuses_the_base_and_database_files(box, monkeypatch, tmp_path):
    _, ws = box
    db = tmp_path / "data" / "imperial.db"
    for p in (config.APP_ROOT / "backend" / "app" / "orders.py", db, Path(str(db) + "-wal"), Path(str(db) + "-shm"),
              Path(str(db) + "-journal"), config.ORDERS_SETTINGS_DIR / "orders-x.json"):
        assert not allowed("Read", {"file_path": str(p)}, ws), p
        assert not allowed("Write", {"file_path": str(p)}, ws), p


# -- the guard as Claude Code runs it

def run_guard(ws, tools, payload, raw=None):
    return subprocess.run([sys.executable, "-I", "-B", str(GUARD), str(ws), tools],
                          input=raw if raw is not None else json.dumps(payload), capture_output=True, text=True,
                          timeout=30)


def test_guard_process_exit_codes_and_messages(box):
    tmp, ws = box
    ok = run_guard(ws, "Edit+Write", {"tool_name": "Write", "tool_input": {"file_path": str(ws / "a.txt")}})
    assert ok.returncode == 0 and ok.stdout == "" and ok.stderr == ""
    no = run_guard(ws, "Edit+Write", {"tool_name": "Write", "tool_input": {"file_path": str(tmp / "secret-path.txt")}})
    assert no.returncode == 2 and "orders folder" in no.stderr
    assert "secret-path" not in no.stderr and "secret-path" not in no.stdout  # the path is never echoed
    rd = run_guard(ws, "Edit+Write", {"tool_name": "Read", "tool_input": {"file_path": str(ws / "src" / "app.py")}})
    assert rd.returncode == 2


@pytest.mark.parametrize("raw", ["", "not json", "[]", '"x"', '{"tool_name": "Read"}', "{" * 5000])
def test_guard_process_fails_closed_on_bad_input(box, raw):
    _, ws = box
    r = run_guard(ws, "Read+Edit+Write+Glob+Grep", None, raw=raw)
    assert r.returncode == 2 and r.stdout == ""


def test_guard_process_without_arguments_fails_closed():
    r = subprocess.run([sys.executable, "-I", "-B", str(GUARD)], input="{}", capture_output=True, text=True, timeout=30)
    assert r.returncode == 2


def _posix_shell() -> str | None:
    """Git Bash on Windows (what Claude Code uses for shell commands there), or the system bash elsewhere."""
    import shutil
    if not WIN:
        return shutil.which("bash")
    candidates = [os.environ.get("CLAUDE_CODE_GIT_BASH_PATH", "")]
    for root in (os.environ.get("ProgramFiles", r"C:\Program Files"), os.environ.get("LOCALAPPDATA", "")):
        if root:
            candidates += [str(Path(root) / "Git" / "bin" / "bash.exe"), str(Path(root) / "Programs" / "Git" / "bin" / "bash.exe")]
    return next((c for c in candidates if c and Path(c).is_file()), None)


def test_the_hook_command_is_plain_words():
    """No quotes or shell characters: the same command line parses identically in a POSIX shell and PowerShell."""
    import shlex
    cmd = orders_mod.guard_command(Path(sys.executable).parent, ("Edit", "Write"))
    if cmd is None:
        pytest.skip("this interpreter's path needs quoting; orders would be unavailable here (by design)")
    words = cmd.split(" ")
    assert shlex.split(cmd) == words and len(words) == 6
    assert words[1:3] == ["-I", "-B"] and words[-1] == "Edit+Write"
    assert not any(ch in cmd for ch in "\"'`$&|;<>()%!\\")


def test_guard_command_runs_unquoted_in_a_posix_shell(box):
    """The exact hook command, run through bash, allows inside the workspace and refuses outside it."""
    tmp, ws = box
    cmd = orders_mod.guard_command(ws, ("Edit", "Write"))
    bash = _posix_shell()
    if cmd is None or bash is None:
        pytest.skip("no POSIX shell here, or this interpreter's path needs quoting")
    inside = json.dumps({"tool_name": "Write", "tool_input": {"file_path": str(ws / "a.txt")}})
    outside = json.dumps({"tool_name": "Write", "tool_input": {"file_path": str(tmp / "b.txt")}})
    run = lambda data: subprocess.run([bash, "-c", cmd], input=data, capture_output=True, text=True, timeout=60)  # noqa: E731
    assert run(inside).returncode == 0
    assert run(outside).returncode == 2


def test_guard_command_refuses_paths_that_need_quoting(tmp_path):
    ws = tmp_path / "ws"
    ws.mkdir()
    spaced = tmp_path / "has space"
    spaced.mkdir()
    fake_py = spaced / "python.exe"
    fake_py.write_text("", encoding="utf-8")
    assert orders_mod.guard_command(ws, ("Edit", "Write"), python=str(fake_py)) is None
    assert orders_mod.guard_command(spaced, ("Edit", "Write")) is None
    for odd in ("a&b", "a%b", "a$b", "a'b", "a(b)"):
        d = tmp_path / odd
        d.mkdir()
        assert orders_mod.guard_command(d, ("Edit", "Write")) is None, odd
    assert orders_mod.guard_command(ws, ("Edit", "Write"), python=str(tmp_path / "missing.exe")) is None
    assert orders_mod.guard_command(ws, ()) is None


def test_agent_settings_install_the_guard_literally(tmp_path):
    settings = orders_mod.agent_settings([], None, guard="GUARD-CMD")
    assert settings["disableAllHooks"] is False
    assert settings["hooks"] == {"PreToolUse": [{"matcher": "*", "hooks": [
        {"type": "command", "command": "GUARD-CMD", "timeout": 30}]}]}
    assert settings["permissions"]["deny"][:11] == ["Bash", "PowerShell", "Monitor", "WebFetch", "WebSearch", "Agent",
                                                    "Skill", "Workflow", "Read", "Glob", "Grep"]
    with_read = orders_mod.agent_settings([], None, guard="GUARD-CMD", read_access=True)
    assert "Read" not in with_read["permissions"]["deny"] and "Glob" not in with_read["permissions"]["deny"]


def _strict_match(rule: str, target: str) -> bool:
    """Case-sensitive reading of a deny rule (written here, independent of production code)."""
    import re
    if re.match(r"^[A-Za-z]:[\\/]", target):
        target = "/" + target[0].lower() + target[2:].replace("\\", "/")
    pattern = re.escape(rule[1:]).replace(r"\*\*", ".+").replace(r"\*", "[^/]*")
    return re.fullmatch(pattern, target) is not None


@pytest.mark.skipif(not WIN, reason="Windows letter case")
def test_case_variants_that_text_deny_rules_could_miss_are_refused_by_the_guard(box):
    """N4: a case-sensitive matcher would miss these against the deny rules; the guard refuses them anyway."""
    tmp, ws = box
    ws_rule = orders_mod._rule_path(ws)
    variant = str(ws) + "\\.CLAUDE\\settings.json"
    assert not _strict_match(f"{ws_rule}/.claude/**", variant)  # the gap a text match would leave
    assert not allowed("Write", {"file_path": variant}, ws)
    home_rule = orders_mod.rule_path_text(tmp / "home" / ".ssh")
    secret_variant = str(tmp / "HOME" / ".SSH" / "id_rsa")
    assert not _strict_match(f"{home_rule}/**", secret_variant)
    assert not allowed("Read", {"file_path": secret_variant}, ws)


# ====================================================================== H1 follow-up: user settings

@pytest.mark.parametrize("data,code", [
    ({}, None),
    ({"model": "opus", "theme": "dark", "env": {"X": "1"}, "hooks": {"PreToolUse": []}}, None),
    ({"permissions": {"allow": ["Bash(git status)", "WebFetch(domain:example.com)", "mcp__context7__*"]}}, None),
    ({"permissions": {"deny": ["Read(//c/secret/**)", "Edit"], "ask": ["Write"]}}, None),  # narrowing only
    ({"permissions": {"defaultMode": "acceptEdits", "additionalDirectories": []}}, None),
    ({"disableAllHooks": False, "allowManagedHooksOnly": False}, None),
    ({"permissions": {"allow": ["Read"]}}, "allow_rule_file_tool"),
    ({"permissions": {"allow": ["Edit(//c/**)"]}}, "allow_rule_file_tool"),
    ({"permissions": {"allow": ["Write(*)"]}}, "allow_rule_file_tool"),
    ({"permissions": {"allow": ["Glob"]}}, "allow_rule_file_tool"),
    ({"permissions": {"allow": ["Grep(**)"]}}, "allow_rule_file_tool"),
    ({"permissions": {"allow": ["MultiEdit"]}}, "allow_rule_file_tool"),
    ({"permissions": {"allow": ["NotebookEdit(x)"]}}, "allow_rule_file_tool"),
    ({"permissions": {"allow": ["read(**)"]}}, "allow_rule_file_tool"),  # any letter case
    ({"permissions": {"allow": [" Edit "]}}, "allow_rule_file_tool"),
    ({"permissions": {"allow": ["*"]}}, "allow_rule_file_tool"),
    ({"permissions": {"allow": [""]}}, "allow_rule_file_tool"),
    # precedence: a matching deny does not make an allow rule acceptable (the base does not merge rules itself)
    ({"permissions": {"allow": ["Edit(//c/x/**)"], "deny": ["Edit(//c/x/**)"]}}, "allow_rule_file_tool"),
    ({"permissions": {"additionalDirectories": ["C:/Projects/other"]}}, "additional_directories"),
    ({"permissions": {"defaultMode": "bypassPermissions"}}, "bypass_default_mode"),
    ({"disableAllHooks": True}, "hooks_disabled"),
    ({"disableAllHooks": "yes"}, "hooks_disabled"),
    ({"allowManagedHooksOnly": True}, "managed_hooks_only"),
    ({"someFutureSetting": 1}, "unknown_setting"),
    ({"permissions": {"allowEverything": True}}, "unknown_permission_key"),
    ([], "settings_invalid"), ("x", "settings_invalid"), ({"permissions": []}, "settings_invalid"),
    ({"permissions": {"allow": "Read"}}, "settings_invalid"), ({"permissions": {"allow": [1]}}, "settings_invalid"),
])
def test_inspect_settings(data, code):
    assert orders_mod.inspect_settings(data) == code


def test_settings_problem_reads_files_safely(tmp_path):
    user = tmp_path / "cfg" / "settings.json"
    managed = tmp_path / "managed" / "managed-settings.json"
    assert orders_mod.settings_problem(user, [managed]) is None  # neither exists
    user.parent.mkdir()
    user.write_text("\ufeff" + json.dumps({"model": "opus"}), encoding="utf-8")  # a BOM is fine
    assert orders_mod.settings_problem(user, [managed]) is None
    user.write_text("{not json", encoding="utf-8")
    assert orders_mod.settings_problem(user, [managed]) == "settings_invalid"
    user.unlink()
    user.mkdir()  # exists but cannot be read as a file
    assert orders_mod.settings_problem(user, [managed]) == "settings_unreadable"
    user.rmdir()
    managed.parent.mkdir()
    managed.write_text(json.dumps({"allowManagedHooksOnly": True}), encoding="utf-8")
    assert orders_mod.settings_problem(user, [managed]) == "managed_hooks_only"
    user.write_bytes(b"\xff\xfe\x00bad")
    assert orders_mod.settings_problem(user, []) in ("settings_unreadable", "settings_invalid")


def test_user_settings_follow_claude_config_dir(monkeypatch, tmp_path):
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_path / "alt"))
    assert config.user_settings_file() == tmp_path / "alt" / "settings.json"
    monkeypatch.delenv("CLAUDE_CONFIG_DIR")
    monkeypatch.setattr(config, "HOME", tmp_path / "home")
    assert config.user_settings_file() == tmp_path / "home" / ".claude" / "settings.json"


@pytest.fixture()
def real_runner(monkeypatch, tmp_path):
    """The production runner wiring with the process, claude lookup and settings locations replaced."""
    launches = []

    class Popen:
        def __init__(self, args, cwd=None, **kw):
            self.args, self.cwd = args, cwd
            self.stdin = _Sink()
            self.stdout = iter([json.dumps({"type": "result", "subtype": "success", "result": "ok"}) + "\n"])
            self.stderr = iter([])
            self.pid = -1
            self.settings_seen = Path(args[args.index("--settings") + 1]).exists()
            launches.append(self)

        def wait(self, timeout=None):
            return 0

        def poll(self):
            return 0

    monkeypatch.setattr(orders_mod.subprocess, "Popen", Popen)
    monkeypatch.setattr(orders_mod, "find_claude", lambda work_dir=None: str(tmp_path / "bin" / "claude.exe"))
    cfg = tmp_path / "claude-config"
    cfg.mkdir()
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(cfg))
    monkeypatch.setattr(config, "managed_settings_files", lambda: [tmp_path / "managed-settings.json"])
    monkeypatch.setattr(config, "ORDERS_ENABLED", True)
    monkeypatch.setattr(config, "ORDERS_SETTINGS_DIR", tmp_path / "base" / "orders-settings")
    monkeypatch.setattr(config, "FRONTEND_DIST", tmp_path / "no-dist")
    return launches, cfg


class _Sink:
    def write(self, s):
        return len(s)

    def close(self):
        pass


def _orders_app(tmp_path):
    return create_app(db_path=str(tmp_path / "t.db"), spool_path=str(tmp_path / "s.jsonl"), start_tailer=False,
                      orders_cwd=str(tmp_path / "workspace"))


@pytest.mark.parametrize("settings,code", [
    ({"permissions": {"allow": ["Edit(//c/**)"]}, "env": {"TOKEN": "SECRETVALUE123"}}, "allow_rule_file_tool"),
    ({"permissions": {"additionalDirectories": ["C:/x"]}}, "additional_directories"),
    ({"disableAllHooks": True}, "hooks_disabled"),
    ({"unknownThing": "SECRETVALUE123"}, "unknown_setting"),
])
def test_unsafe_user_settings_in_claude_config_dir_keep_orders_off(real_runner, tmp_path, settings, code):
    launches, cfg = real_runner
    (cfg / "settings.json").write_text(json.dumps(settings), encoding="utf-8")
    with local(_orders_app(tmp_path)) as c:
        st = c.get("/api/orders").json()
        assert st["enabled"] is False and st["reason"] == orders_mod.SETTINGS_REASONS[code]
        assert "SECRETVALUE123" not in json.dumps(st)  # contents are never reported
        assert c.post("/api/orders", json={"text": "x"}).status_code == 503
    assert launches == []
    with pytest.raises(orders_mod.OrderError):  # and again right before a launch
        orders_mod.CliRun("x", "sid", False, tmp_path / "workspace", protected=[], settings_dir=tmp_path / "sd")
    assert launches == []


def test_unsafe_managed_settings_keep_orders_off(real_runner, tmp_path):
    launches, _ = real_runner
    (tmp_path / "managed-settings.json").write_text(json.dumps({"allowManagedHooksOnly": True}), encoding="utf-8")
    with local(_orders_app(tmp_path)) as c:
        assert c.get("/api/orders").json()["reason"] == orders_mod.SETTINGS_REASONS["managed_hooks_only"]
    assert launches == []


def test_safe_user_settings_allow_orders_and_the_launch_carries_the_guard(real_runner, tmp_path):
    launches, cfg = real_runner
    (cfg / "settings.json").write_text(json.dumps({"model": "opus", "permissions": {"deny": ["Read(//c/x/**)"]}}),
                                       encoding="utf-8")
    with local(_orders_app(tmp_path)) as c:
        st = c.get("/api/orders").json()
        assert st["enabled"] is True and st["tools"] == ["Edit", "Write"] and st["read_access"] is False
        assert c.post("/api/orders", json={"text": "write a haiku"}).status_code == 200
        for _ in range(100):
            if c.get("/api/orders").json()["orders"][0]["status"] != "running":
                break
            time.sleep(0.02)
    (p,) = launches
    assert p.settings_seen  # the settings file existed when the process was started
    assert p.args[p.args.index("--tools") + 1] == "Edit,Write"
    assert list((tmp_path / "base" / "orders-settings").iterdir()) == []  # and was removed afterwards


def test_read_access_is_opt_in(real_runner, tmp_path, monkeypatch):
    launches, _ = real_runner
    monkeypatch.setattr(config, "ORDERS_READ", True)
    with local(_orders_app(tmp_path)) as c:
        st = c.get("/api/orders").json()
        assert st["read_access"] is True and st["tools"] == ["Read", "Edit", "Write", "Glob", "Grep"]


def test_orders_are_off_when_the_guard_cannot_be_installed(real_runner, tmp_path, monkeypatch):
    monkeypatch.setattr(orders_mod, "guard_command", lambda *a, **k: None)
    launches, _ = real_runner
    with local(_orders_app(tmp_path)) as c:
        assert c.get("/api/orders").json()["reason"] == orders_mod.GUARD_UNAVAILABLE
        assert c.post("/api/orders", json={"text": "x"}).status_code == 503
    assert launches == []


def test_hook_installed_follows_claude_config_dir(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "HOME", tmp_path / "home")
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)
    assert engine_mod.hook_installed() is False
    cfg = tmp_path / "alt"
    cfg.mkdir()
    (cfg / "settings.json").write_text('{"hooks": {"Stop": [{"hooks": [{"command": "node imperial-hook.js"}]}]}}',
                                       encoding="utf-8")
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(cfg))
    assert engine_mod.hook_installed() is True


def run_installer(tmp_path, *args, extra_env=None):
    env = {k: v for k, v in os.environ.items() if k not in ("IMPERIAL_BASE_DIR", "CLAUDE_CONFIG_DIR")}
    env.update(USERPROFILE=str(tmp_path), HOME=str(tmp_path), HOMEDRIVE="", HOMEPATH="", **(extra_env or {}))
    return subprocess.run([sys.executable, str(ROOT / "scripts" / "install_hooks.py"), *args], env=env,
                          capture_output=True, text=True, timeout=60)


def test_installer_writes_where_claude_config_dir_points(tmp_path):
    cfg = tmp_path / "alt-config"
    st = run_installer(tmp_path, "--status", extra_env={"CLAUDE_CONFIG_DIR": str(cfg)})
    assert str(cfg) in st.stdout, "safety: the installer must be pointed at the temporary folder"
    r = run_installer(tmp_path, extra_env={"CLAUDE_CONFIG_DIR": str(cfg)})
    assert r.returncode == 0, r.stderr
    assert "imperial-hook.js" in (cfg / "settings.json").read_text(encoding="utf-8")
    assert not (tmp_path / ".claude").exists()


@pytest.mark.parametrize("args,env", [(("--status", "--bogus"), {}), (("--uninstall", "x"), {}),
                                      ((), {"CLAUDE_CONFIG_DIR": "relative-config"}),
                                      (("--status",), {"CLAUDE_CONFIG_DIR": "relative-config"})])
def test_installer_changes_nothing_on_bad_arguments(tmp_path, args, env):
    r = run_installer(tmp_path, *args, extra_env=env)
    assert r.returncode == 2 and "nothing was changed" in r.stderr
    assert not (tmp_path / ".claude").exists() and not (tmp_path / ".imperial-base").exists()
    assert not (tmp_path / "relative-config").exists()


# ====================================================================== N3: per-launch settings files

def test_each_launch_gets_its_own_new_file(tmp_path):
    d = tmp_path / "orders-settings"
    a = orders_mod.write_launch_settings(d, {"n": 1})
    b = orders_mod.write_launch_settings(d, {"n": 2})
    assert a != b and a.parent == d and b.parent == d
    assert json.loads(a.read_text(encoding="utf-8")) == {"n": 1}
    assert json.loads(b.read_text(encoding="utf-8")) == {"n": 2}
    assert a.name.startswith("orders-") and a.suffix == ".json"
    if not WIN:
        assert (a.stat().st_mode & 0o777) == 0o600


def test_concurrent_launches_never_share_a_file(tmp_path):
    d = tmp_path / "orders-settings"
    paths, errors = [], []

    def make(i):
        try:
            paths.append(orders_mod.write_launch_settings(d, {"i": i}))
        except Exception as e:  # pragma: no cover - reported below
            errors.append(e)

    threads = [threading.Thread(target=make, args=(i,)) for i in range(32)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == [] and len(set(paths)) == 32
    assert sorted(json.loads(p.read_text(encoding="utf-8"))["i"] for p in paths) == list(range(32))


class RunningPopen:
    """A process that keeps running until it is ended (taskkill is recorded, never executed)."""
    instances: list["RunningPopen"] = []

    def __init__(self, args, cwd=None, **kw):
        self.args, self.cwd = args, cwd
        self.stdin = _Sink()
        self.stdout = iter([])
        self.stderr = iter([])
        self.pid = -(20000 + len(RunningPopen.instances))  # negative: never a real process id
        self._ended = threading.Event()
        self.stubborn = False
        RunningPopen.instances.append(self)

    @property
    def settings(self) -> Path:
        return Path(self.args[self.args.index("--settings") + 1])

    def end(self):
        self._ended.set()

    def poll(self):
        return 0 if self._ended.is_set() else None

    def wait(self, timeout=None):
        if not self._ended.wait(timeout if timeout is not None else 30):
            raise subprocess.TimeoutExpired("claude", timeout or 30)
        return 0

    def terminate(self):
        if not self.stubborn:
            self.end()


@pytest.fixture()
def running(monkeypatch, tmp_path):
    RunningPopen.instances = []
    killed = []

    def fake_run(args, **kw):  # stands in for taskkill: ends the fake process it names
        killed.append(args)
        for p in RunningPopen.instances:
            if str(p.pid) in args and not p.stubborn:
                p.end()
        return subprocess.CompletedProcess(args, 0)

    monkeypatch.setattr(orders_mod.subprocess, "Popen", RunningPopen)
    monkeypatch.setattr(orders_mod.subprocess, "run", fake_run)
    monkeypatch.setattr(orders_mod, "find_claude", lambda work_dir=None: str(tmp_path / "bin" / "claude.exe"))
    monkeypatch.setattr(config, "user_settings_file", lambda: tmp_path / "isolated" / "settings.json")
    monkeypatch.setattr(config, "managed_settings_files", lambda: [])
    ws = tmp_path / "ws"
    ws.mkdir()
    return ws, tmp_path / "orders-settings", killed


def test_settings_file_lives_until_the_process_ends_then_goes(running):
    ws, sdir, _ = running
    run = orders_mod.CliRun("x", "s1", False, ws, protected=[], settings_dir=sdir)
    p = RunningPopen.instances[0]
    assert p.settings.exists()
    run._cleanup()  # still running: kept (Claude Code may read its settings again)
    assert p.settings.exists()
    run.stop()
    assert not p.settings.exists()


def test_stop_and_finish_only_remove_their_own_file(running):
    ws, sdir, _ = running
    first = orders_mod.CliRun("a", "s1", False, ws, protected=[], settings_dir=sdir)
    second = orders_mod.CliRun("b", "s2", False, ws, protected=[], settings_dir=sdir)
    p1, p2 = RunningPopen.instances
    assert p1.settings != p2.settings
    first.stop()
    assert not p1.settings.exists() and p2.settings.exists()  # the other session's file is untouched
    p2.end()
    list(second.records())  # the process ended normally
    assert not p2.settings.exists()
    assert list(sdir.iterdir()) == []


def test_a_launch_that_fails_to_start_leaves_no_file(running, monkeypatch):
    ws, sdir, _ = running

    def broken(*a, **k):
        raise OSError("cannot start")

    monkeypatch.setattr(orders_mod.subprocess, "Popen", broken)
    with pytest.raises(OSError):
        orders_mod.CliRun("x", "s1", False, ws, protected=[], settings_dir=sdir)
    assert not sdir.exists() or list(sdir.iterdir()) == []


def test_a_process_that_will_not_stop_keeps_its_file_until_it_ends(running):
    """Timeout while stopping: the file stays (the process may still read it) and goes once the process ends."""
    ws, sdir, _ = running
    run = orders_mod.CliRun("x", "s1", False, ws, protected=[], settings_dir=sdir)
    p = RunningPopen.instances[0]
    p.stubborn = True
    original = p._ended.wait
    p._ended.wait = lambda timeout=None: original(0.01) if timeout is not None else original(timeout)  # quick "timeout"
    run.stop()
    assert p.settings.exists()
    p.end()
    list(run.records())
    assert not p.settings.exists()


def test_shutdown_cancels_running_orders_and_cleans_up(running, monkeypatch, tmp_path):
    import asyncio
    ws, sdir, _ = running

    async def nothing(msg):
        return None

    mgr = orders_mod.OrderManager(ws, nothing, enabled=True, protected=[], settings_dir=sdir)
    monkeypatch.setattr(orders_mod, "workspace_problem", lambda cwd, protected: None)

    async def scenario():
        await mgr.start("one")
        await mgr.start("two")
        assert len(list(sdir.iterdir())) == 2
        await mgr.shutdown()
        await asyncio.sleep(0.3)  # let the readers see the ended processes before the loop closes

    asyncio.run(scenario())
    assert list(sdir.iterdir()) == []


def test_settings_files_are_never_created_in_the_repository():
    assert config.ORDERS_SETTINGS_DIR.resolve() != ROOT and ROOT not in config.ORDERS_SETTINGS_DIR.resolve().parents
    for folder in (ROOT, ROOT / "backend", ROOT / "backend" / "app", ROOT / "backend" / "data", ROOT / "frontend"):
        assert not list(folder.glob("orders-*.json")), folder
    assert config.ORDERS_SETTINGS_DIR in config.protected_paths()


# ====================================================================== 9: operational

def test_registry_stays_bounded(monkeypatch):
    monkeypatch.setattr(state_mod, "MAX_TASKS", 50)
    monkeypatch.setattr(state_mod, "MAX_AGENTS", 20)
    monkeypatch.setattr(state_mod, "MAX_PENDING_PER_SESSION", 5)
    monkeypatch.setattr(state_mod, "MAX_PENDING_SESSIONS", 3)
    reg = state_mod.Registry()
    for i in range(200):
        sid = f"S{i}"
        reg.apply(ev("UserPromptSubmit", sid, prompt_excerpt="x"))
        reg.apply(ev("PreToolUse", sid, tool_name="Agent", tool_use_id=f"t{i}"))
        reg.apply(ev("SubagentStart", sid, agent_id=f"a{i}", agent_type="Explore"))
    for i in range(20):
        reg.apply(ev("PreToolUse", "S199", tool_name="Agent", tool_use_id=f"u{i}"))
    assert len(reg.tasks) <= 50 and len(reg.agents) <= 20
    assert len(reg.pending_delegations) <= 3 and all(len(q) <= 5 for q in reg.pending_delegations.values())
    reg.delegations()  # still consistent


def test_schema_map_ignores_unknown_event_names(app):
    with local(app) as c:
        c.post("/api/ingest", json=[ev(f"Made-up-{i}", raw_keys=["a"]) for i in range(50)])
        c.post("/api/ingest", json=ev("SessionStart", raw_keys=["session_id"]))
        schema = c.get("/api/schema").json()
    assert list(schema) == ["SessionStart"]


def test_websocket_messages_and_clients_are_bounded(app, monkeypatch):
    monkeypatch.setattr(main_mod, "MAX_WS_CLIENTS", 1)
    with local(app) as c:
        with c.websocket_connect("/ws") as ws:
            for _ in range(3):
                ws.receive_json()
            with pytest.raises(WebSocketDisconnect):  # a second socket is refused while the first is open
                with c.websocket_connect("/ws") as second:
                    second.receive_json()
            ws.send_text("x" * (main_mod.MAX_WS_MESSAGE + 1))
            with pytest.raises(WebSocketDisconnect):
                ws.receive_json()


def test_request_bodies_are_bounded(app):
    with local(app) as c:
        big = json.dumps({"text": "x" * (main_mod.MAX_ORDER_BODY_BYTES + 10)})
        r = c.post("/api/orders", content=big, headers={"content-type": "application/json"})
        assert r.status_code == 413


def test_run_record_names_this_process(tmp_path):
    import psutil
    path = main_mod.write_run_record(tmp_path / "run")
    data = json.loads(path.read_text(encoding="utf-8"))
    me = psutil.Process(os.getpid())
    assert data["pid"] == os.getpid() and abs(data["started"] - me.create_time()) < 0.01
    assert data["parent"] == me.ppid()


# -- stop.ps1 (Windows): only processes the base recorded are ever stopped

LISTENER = ("import os, socket, time; s = socket.socket(); s.bind(('127.0.0.1', 0)); s.listen(); "
            "print(s.getsockname()[1], os.getpid(), flush=True); time.sleep(120)")


@pytest.fixture()
def listener():
    if not WIN:
        pytest.skip("stop.ps1 is a Windows script")
    import psutil
    proc = subprocess.Popen([sys.executable, "-c", LISTENER], stdout=subprocess.PIPE, text=True)
    port, pid = (int(x) for x in proc.stdout.readline().split())
    try:
        yield port, pid, psutil.Process(pid).create_time()
    finally:
        for p in (pid, proc.pid):
            try:
                psutil.Process(p).kill()
            except psutil.Error:
                pass
        proc.wait(timeout=10)


def stop_script(base, port, *extra):
    return subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                           str(ROOT / "scripts" / "stop.ps1"), "-Ports", str(port), "-BaseDir", str(base), *extra],
                          capture_output=True, text=True, timeout=120)


def record(base, **data):
    (base / "run").mkdir(parents=True, exist_ok=True)
    (base / "run" / f"{data.get('kind', 'backend')}-{data['pid']}.json").write_text(json.dumps(data), encoding="utf-8")


def test_stop_leaves_an_unrelated_python_listener_alone(listener, tmp_path):
    import psutil
    port, pid, _ = listener
    r = stop_script(tmp_path, port)
    assert "Left alone" in r.stdout, r.stdout + r.stderr
    assert psutil.pid_exists(pid) and psutil.Process(pid).is_running()


def test_stop_leaves_a_reused_process_id_alone(listener, tmp_path):
    import psutil
    port, pid, started = listener
    record(tmp_path, pid=pid, started=started - 1000)  # an old record whose process id was reused
    r = stop_script(tmp_path, port)
    assert "Left alone" in r.stdout, r.stdout + r.stderr
    assert psutil.Process(pid).is_running()


def test_stop_dry_run_recognises_the_base_but_stops_nothing(listener, tmp_path):
    import psutil
    port, pid, started = listener
    record(tmp_path, pid=pid, started=started)
    r = stop_script(tmp_path, port, "-DryRun")
    assert "Would stop" in r.stdout and "Dry run" in r.stdout, r.stdout + r.stderr
    assert psutil.Process(pid).is_running()
    (tmp_path / "run" / f"backend-{pid}.json").unlink()
    record(tmp_path, pid=999999, started=0, parent=pid, parent_started=started)  # a reloading backend's parent
    assert "Would stop" in stop_script(tmp_path, port, "-DryRun").stdout


def test_stop_ends_a_recorded_server(listener, tmp_path):
    import psutil
    port, pid, started = listener
    record(tmp_path, pid=pid, started=started)
    r = stop_script(tmp_path, port)
    assert "Stopping" in r.stdout, r.stdout + r.stderr
    for _ in range(50):
        if not psutil.pid_exists(pid):
            break
        time.sleep(0.1)
    assert not psutil.pid_exists(pid)

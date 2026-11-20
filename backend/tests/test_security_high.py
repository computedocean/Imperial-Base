"""Regression tests for the high-severity findings H1 (order isolation), H2 (/api/ingest) and H3 (catch-all route).

No real agent is ever started: every test either uses a scripted runner, or replaces subprocess.Popen with a
recorder, and the real CliRun/find_claude are never reached with a working executable. Network paths are never
touched: the filesystem calls are wrapped so that a UNC path is recorded and refused instead.
"""
import io
import json
import os
import pathlib
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient as _TestClient

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app import config, orders as orders_mod  # noqa: E402
from app.main import create_app  # noqa: E402
from app.pathsafe import plain_local_absolute, safe_file_under, safe_relative_under  # noqa: E402
from app.transcripts import usage_from_transcript  # noqa: E402


class _Local(_TestClient):
    def websocket_connect(self, url, *args, headers=None, **kwargs):
        return super().websocket_connect(url, *args, headers={"host": "127.0.0.1:8742", **(headers or {})}, **kwargs)


def local_client(app):
    return _Local(app, base_url="http://127.0.0.1:8742", client=("127.0.0.1", 50000))


def ev(event, sid="S1", **kw):
    return {"v": 1, "event": event, "session_id": sid, "ts": "2026-11-05T04:00:00.000Z", "project": "demo", **kw}


@pytest.fixture()
def unc_guard(monkeypatch):
    """Record (and refuse) any filesystem call on a network path, so a test can prove none was made."""
    seen: list[str] = []
    real_is_file, real_stat, real_resolve = pathlib.Path.is_file, pathlib.Path.stat, pathlib.Path.resolve

    def bad(p):
        s = str(p)
        if s.startswith(("\\\\", "//")):
            seen.append(s)
            return True
        return False

    def is_file(self, *a, **k):
        return False if bad(self) else real_is_file(self, *a, **k)

    def stat(self, *a, **k):
        if bad(self):
            raise FileNotFoundError(str(self))
        return real_stat(self, *a, **k)

    def resolve(self, *a, **k):
        if bad(self):
            raise OSError("network path refused by test guard")
        return real_resolve(self, *a, **k)

    monkeypatch.setattr(pathlib.Path, "is_file", is_file)
    monkeypatch.setattr(pathlib.Path, "stat", stat)
    monkeypatch.setattr(pathlib.Path, "resolve", resolve)
    return seen


@pytest.fixture()
def client(tmp_path):
    app = create_app(db_path=str(tmp_path / "t.db"), spool_path=str(tmp_path / "s.jsonl"), start_tailer=False)
    with local_client(app) as c:
        yield c


# ====================================================================== H2: /api/ingest

def test_ingest_accepts_legitimate_local_json(client):
    r = client.post("/api/ingest", json=[ev("SessionStart"), ev("UserPromptSubmit", prompt_excerpt="hi")])
    assert r.status_code == 200 and r.json() == {"accepted": 2}
    # the base's own page (exact origin) and the Vite dev server are fine too
    for origin in ("http://127.0.0.1:8742", "http://localhost:5273"):
        assert client.post("/api/ingest", json=ev("SessionStart", "S2"), headers={"origin": origin}).status_code == 200


def test_ingest_without_origin_from_a_local_program_is_allowed(client):
    # browsers always send Origin on a cross-site POST; a missing Origin means a local program (like the tests)
    assert client.post("/api/ingest", json=ev("SessionStart")).json() == {"accepted": 1}


@pytest.mark.parametrize("host", ["evil.invalid", "evil.invalid:8742", "127.0.0.1.evil.invalid", "192.168.1.5:8742"])
def test_ingest_refuses_malicious_host(client, host):
    assert client.post("/api/ingest", json=ev("SessionStart"), headers={"host": host}).status_code == 403


@pytest.mark.parametrize("origin", ["https://evil.invalid", "null", "http://127.0.0.1:3000", "http://localhost:8080",
                                    "https://127.0.0.1:8742", "http://127.0.0.1:8742.evil.invalid", "file://"])
def test_ingest_refuses_invalid_origin(client, origin):
    assert client.post("/api/ingest", json=ev("SessionStart"), headers={"origin": origin}).status_code == 403


@pytest.mark.parametrize("ctype", ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x",
                                   "application/jsonp", "application/json-patch+json", ""])
def test_ingest_refuses_other_content_types(client, ctype):
    headers = {"content-type": ctype} if ctype else {}
    r = client.post("/api/ingest", content=json.dumps(ev("SessionStart")), headers=headers)
    assert r.status_code == 415


def test_ingest_json_with_charset_is_fine(client):
    r = client.post("/api/ingest", content=json.dumps(ev("SessionStart")),
                    headers={"content-type": "application/json; charset=utf-8"})
    assert r.status_code == 200


def test_ingest_refuses_oversized_bodies(client, monkeypatch):
    monkeypatch.setattr(config, "MAX_INGEST_BYTES", 10_000)
    big = json.dumps([ev("SessionStart", f"B{i}", cwd="x" * 500) for i in range(100)])
    assert len(big) > 10_000
    # declared length
    assert client.post("/api/ingest", content=big, headers={"content-type": "application/json"}).status_code == 413

    # no Content-Length at all (streamed): refused while reading
    def chunks():
        for i in range(0, len(big), 1000):
            yield big[i:i + 1000].encode()

    r = client.post("/api/ingest", content=chunks(), headers={"content-type": "application/json"})
    assert r.status_code == 413
    assert client.get("/api/agents").json() == [] or all(not a["id"].startswith("session:B")
                                                          for a in client.get("/api/agents").json())


def test_ingest_refuses_malformed_json(client):
    r = client.post("/api/ingest", content="{not json", headers={"content-type": "application/json"})
    assert r.status_code == 400


@pytest.mark.parametrize("path", [r"\\attacker.invalid\share\t.jsonl", "//attacker.invalid/share/t.jsonl",
                                  r"\\?\UNC\attacker.invalid\share\t.jsonl", r"\\.\pipe\x"])
def test_unc_transcript_paths_are_never_touched(client, unc_guard, path):
    r = client.post("/api/ingest", json=[ev("SessionStart"), ev("Stop", transcript_path=path)])
    assert r.status_code == 200 and r.json()["accepted"] == 2  # the event itself is still recorded
    assert unc_guard == []  # but its path was never handed to the filesystem


def test_transcripts_outside_approved_folders_are_not_read(tmp_path, unc_guard):
    approved = tmp_path / "projects"
    approved.mkdir()
    row = json.dumps({"type": "assistant", "message": {"id": "m", "model": "m1", "usage": {"input_tokens": 3}}})
    inside = approved / "t.jsonl"
    outside = tmp_path / "other.jsonl"
    inside.write_text(row, encoding="utf-8")
    outside.write_text(row, encoding="utf-8")
    assert usage_from_transcript(str(inside), roots=[approved])["input_tokens"] == 3
    assert usage_from_transcript(str(outside), roots=[approved]) is None
    assert usage_from_transcript(str(approved / ".." / "other.jsonl"), roots=[approved]) is None
    assert unc_guard == []


# ---------------------------------------------------------------------- pathsafe (text checks)

@pytest.mark.skipif(sys.platform != "win32", reason="Windows path forms")
@pytest.mark.parametrize("path,ok", [
    (r"C:\Users\me\.claude\projects\p\t.jsonl", True),
    ("C:/Users/me/.claude/projects/p/t.jsonl", True),
    (r"\\attacker.invalid\share\t.jsonl", False),        # UNC
    ("//attacker.invalid/share/t.jsonl", False),         # UNC, forward slashes
    (r"\\?\C:\Users\me\t.jsonl", False),                  # long-path prefix
    (r"\\?\UNC\host\share\t.jsonl", False),
    (r"\\.\PhysicalDrive0", False),                       # device namespace
    (r"C:t.jsonl", False),                                # drive-relative
    (r"\Users\me\t.jsonl", False),                        # root-relative, no drive
    (r"relative\t.jsonl", False),
    (r"C:\Users\me\t.jsonl:secret", False),               # alternate data stream
    (r"C:\Users\me\..\other\t.jsonl", False),             # traversal
    (r"C:\Users\me\CON", False),                          # reserved device names
    (r"C:\Users\me\nul.txt", False),
    (r"C:\Users\me\COM1.jsonl", False),
    ("C:\\Users\\me\\t\x00.jsonl", False),                # NUL
    ("", False),
])
def test_plain_local_absolute(path, ok):
    assert plain_local_absolute(path) is ok


def test_safe_file_under_follows_links_and_refuses_escapes(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    outside = tmp_path / "secret.txt"
    outside.write_text("x", encoding="utf-8")
    good = root / "a.jsonl"
    good.write_text("x", encoding="utf-8")
    assert safe_file_under(str(good), [root]) == good.resolve()
    assert safe_file_under(str(outside), [root]) is None
    assert safe_file_under(str(root) + "x\\a.jsonl", [root]) is None  # a sibling folder sharing the prefix
    link = root / "link.jsonl"
    try:
        link.symlink_to(outside)
    except (OSError, NotImplementedError):
        pytest.skip("creating symlinks needs Developer Mode or admin rights on Windows")
    assert safe_file_under(str(link), [root]) is None  # the link resolves outside the approved folder


# ====================================================================== H3: catch-all route

@pytest.fixture()
def spa(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>INDEX</title>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log('APP')", encoding="utf-8")
    (dist / "robots.txt").write_text("ROBOTS", encoding="utf-8")
    (dist / "models").mkdir()
    (dist / "models" / "ship.glb").write_bytes(b"glTF-MODEL")
    (tmp_path / "secret.txt").write_text("SECRET", encoding="utf-8")
    monkeypatch.setattr(config, "FRONTEND_DIST", dist)
    app = create_app(db_path=str(tmp_path / "t.db"), spool_path=str(tmp_path / "s.jsonl"), start_tailer=False)
    with local_client(app) as c:
        c.dist = dist
        c.tmp = tmp_path
        yield c


def test_frontend_navigation_still_works(spa):
    assert "INDEX" in spa.get("/").text
    assert "INDEX" in spa.get("/some/client/route").text  # SPA routing falls back to the app page
    assert spa.get("/assets/app.js").text == "console.log('APP')"
    assert spa.get("/robots.txt").text == "ROBOTS"
    assert spa.get("/models/ship.glb").content == b"glTF-MODEL"


@pytest.mark.parametrize("url", [
    "/%5C%5Cattacker.invalid%5Cshare%5Cx.txt",     # encoded \\host\share
    "/%2F%2Fattacker.invalid%2Fshare%2Fx.txt",     # encoded //host/share
    "/%5C%5C%3F%5CUNC%5Cattacker.invalid%5Cs",      # encoded \\?\UNC\host
])
def test_catch_all_never_touches_network_paths(spa, unc_guard, url):
    r = spa.get(url)
    assert r.status_code == 200 and "INDEX" in r.text
    assert unc_guard == []


@pytest.mark.parametrize("url", [
    "/..%2Fsecret.txt", "/..%5Csecret.txt", "/%2e%2e/secret.txt", "/%2e%2e%2fsecret.txt",
    "/assets/..%2F..%2Fsecret.txt", "/models/%2e%2e/%2e%2e/secret.txt",
    "/C:/Windows/win.ini", "/C:%5CWindows%5Cwin.ini", "/robots.txt%00.png", "/robots.txt:stream",
    "/CON", "/nul.txt",
])
def test_catch_all_refuses_traversal_drive_paths_and_odd_separators(spa, url):
    r = spa.get(url)
    assert "SECRET" not in r.text and "[fonts]" not in r.text.lower()
    assert r.status_code in (200, 404) and ("INDEX" in r.text or r.status_code == 404)


def test_safe_relative_under_rejects_bad_forms_as_text(tmp_path):
    root = tmp_path / "dist"
    root.mkdir()
    (root / "ok.txt").write_text("x", encoding="utf-8")
    assert safe_relative_under("ok.txt", root) == (root / "ok.txt").resolve()
    for bad in ("", "/ok.txt", "..", "../x", "a/../ok.txt", "a//ok.txt", "./ok.txt", "a\\b", "C:/x", "x:y",
                "ok.txt\x00", "con", "aux.js", "a/./b"):
        assert safe_relative_under(bad, root) is None, bad


def test_catch_all_refuses_a_link_inside_dist_that_points_outside(spa):
    link = spa.dist / "leak.txt"
    try:
        link.symlink_to(spa.tmp / "secret.txt")
    except (OSError, NotImplementedError):
        pytest.skip("creating symlinks needs Developer Mode or admin rights on Windows")
    r = spa.get("/leak.txt")
    assert "SECRET" not in r.text and "INDEX" in r.text


# ====================================================================== H1: order isolation

def test_orders_are_off_unless_explicitly_enabled():
    code = "import sys; sys.path.insert(0, r'%s'); from app import config; print(config.ORDERS_ENABLED)" % (ROOT / "backend")
    env = {k: v for k, v in os.environ.items() if k != "IMPERIAL_ORDERS"}
    py = sys.executable
    assert subprocess.run([py, "-c", code], env=env, capture_output=True, text=True).stdout.strip() == "False"
    for value, expected in (("1", "True"), ("0", "False"), ("true", "False"), ("yes", "False"), ("", "False")):
        out = subprocess.run([py, "-c", code], env={**env, "IMPERIAL_ORDERS": value}, capture_output=True, text=True)
        assert out.stdout.strip() == expected, value


def test_default_orders_folder_is_outside_the_application():
    cwd = config.ORDERS_CWD.resolve()
    for p in config.protected_paths():
        p = p.resolve()
        assert cwd != p and p not in cwd.parents and cwd not in p.parents


class Recorder:
    """A runner that records calls; any call is a failure in the 'disabled' tests."""

    def __init__(self):
        self.calls = []

    def __call__(self, prompt, session_id, resume, cwd):
        self.calls.append((prompt, cwd))
        raise AssertionError("no agent may be started here")


def test_disabled_orders_cannot_start_anything(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "ORDERS_ENABLED", False)
    rec = Recorder()
    app = create_app(db_path=str(tmp_path / "t.db"), spool_path=str(tmp_path / "s.jsonl"), start_tailer=False,
                     order_runner=rec, orders_cwd=str(tmp_path / "ws"))
    with local_client(app) as c:
        st = c.get("/api/orders").json()
        assert st["enabled"] is False and "IMPERIAL_ORDERS=1" in st["reason"]
        assert c.post("/api/orders", json={"text": "do it"}).status_code == 503
        assert c.post("/api/orders/abc/messages", json={"text": "do it"}).status_code in (404, 503)
        assert c.post("/api/orders/abc/stop", json={}).status_code == 404
        assert c.get("/api/commands").json()["available"] == []
        # the socket offers no way to start one either
        with c.websocket_connect("/ws") as ws:
            ws.receive_json(); ws.receive_json(); ws.receive_json()
            for msg in ({"type": "order", "text": "x"}, {"type": "orders"}, {"type": "start", "text": "x"}):
                ws.send_json(msg)
            ws.send_json({"type": "ping"})
            assert ws.receive_json()["type"] == "pong"
    assert rec.calls == []
    assert not (tmp_path / "ws").exists()


@pytest.mark.parametrize("where", ["app_root", "inside_app", "contains_app", "hook_dir", "db"])
def test_orders_refuse_a_folder_that_overlaps_the_application(tmp_path, monkeypatch, where):
    monkeypatch.setattr(config, "ORDERS_ENABLED", True)
    cwd = {"app_root": config.APP_ROOT, "inside_app": config.APP_ROOT / "frontend",
           "contains_app": config.APP_ROOT.parent, "hook_dir": config.HOOK_DIR,
           "db": config.DB_PATH.parent}[where]
    rec = Recorder()
    app = create_app(db_path=str(tmp_path / "t.db"), spool_path=str(tmp_path / "s.jsonl"), start_tailer=False,
                     order_runner=rec, orders_cwd=str(cwd))
    with local_client(app) as c:
        st = c.get("/api/orders").json()
        assert st["enabled"] is False and "overlaps" in st["reason"]
        assert c.post("/api/orders", json={"text": "edit the base"}).status_code == 503
    assert rec.calls == []


class _KeptStdin(io.StringIO):
    """stdin that remembers what was written after CliRun closes it."""

    def close(self):
        self.kept = self.getvalue()
        super().close()


class FakePopen:
    instances: list["FakePopen"] = []

    def __init__(self, args, cwd=None, **kw):
        self.args, self.cwd, self.kw = args, cwd, kw
        self.stdin = _KeptStdin()
        self.stdout = io.StringIO(json.dumps({"type": "result", "subtype": "success", "result": "done"}) + "\n")
        self.stderr = io.StringIO("")
        self.pid = 4242
        FakePopen.instances.append(self)

    def wait(self, timeout=None):
        return 0

    def poll(self):
        return 0

    def terminate(self):
        pass


@pytest.fixture()
def fake_process(monkeypatch, tmp_path):
    FakePopen.instances = []
    monkeypatch.setattr(orders_mod.subprocess, "Popen", FakePopen)
    monkeypatch.setattr(orders_mod, "find_claude", lambda work_dir=None: str(tmp_path / "bin" / "claude.exe"))
    return FakePopen.instances


def test_cli_run_starts_the_agent_isolated(tmp_path, fake_process):
    ws = tmp_path / "ws"
    ws.mkdir()
    settings = tmp_path / "base" / "orders-settings.json"
    protected = [config.APP_ROOT, tmp_path / "base" / "hooks", tmp_path / "base" / "spool", settings]
    orders_mod.CliRun("hello", "sid-1", False, ws, protected=protected, settings_file=settings)
    (p,) = fake_process
    args = p.args
    assert Path(p.cwd) == ws
    assert args[1] == "-p" and args[args.index("--permission-mode") + 1] == "acceptEdits"
    assert args[args.index("--disallowedTools") + 1] == "Bash,PowerShell"
    assert "--strict-mcp-config" in args
    assert Path(args[args.index("--settings") + 1]) == settings
    assert args[args.index("--session-id") + 1] == "sid-1"
    assert "shell" not in p.kw or p.kw["shell"] is False
    deny = json.loads(settings.read_text(encoding="utf-8"))["permissions"]["deny"]
    app_rule = orders_mod._rule_path(config.APP_ROOT)
    assert f"Edit({app_rule}/**)" in deny
    assert any(r.startswith("Edit(") and "hooks" in r for r in deny)
    assert any(r.startswith("Read(") and "hooks" in r for r in deny)
    assert any(r.startswith("Read(") and "spool" in r for r in deny)
    assert p.stdin.kept == "hello"  # the prompt went in on stdin, never on the command line
    assert "hello" not in " ".join(args)


def test_cli_run_resumes_with_the_same_restrictions(tmp_path, fake_process):
    ws = tmp_path / "ws"
    ws.mkdir()
    orders_mod.CliRun("again", "sid-2", True, ws, protected=[config.APP_ROOT], settings_file=tmp_path / "s.json")
    args = fake_process[0].args
    assert args[args.index("--resume") + 1] == "sid-2" and "--session-id" not in args
    assert "--disallowedTools" in args and "--strict-mcp-config" in args


def test_cli_run_refuses_an_overlapping_folder_before_starting_anything(tmp_path, fake_process):
    with pytest.raises(orders_mod.OrderError):
        orders_mod.CliRun("x", "sid-3", False, config.APP_ROOT, protected=[config.APP_ROOT])
    assert fake_process == []


def test_enabled_orders_still_run_through_the_real_runner_path_with_a_mocked_process(tmp_path, monkeypatch, fake_process):
    """End to end with the production runner wiring (CliRun via OrderManager), the process mocked."""
    import time
    monkeypatch.setattr(config, "ORDERS_ENABLED", True)
    monkeypatch.setattr(config, "ORDERS_SETTINGS", tmp_path / "base" / "orders-settings.json")
    ws = tmp_path / "workspace"
    app = create_app(db_path=str(tmp_path / "t.db"), spool_path=str(tmp_path / "s.jsonl"), start_tailer=False,
                     orders_cwd=str(ws))
    with local_client(app) as c:
        assert c.get("/api/orders").json()["enabled"] is True
        o = c.post("/api/orders", json={"text": "write a haiku"}).json()
        for _ in range(100):
            if c.get("/api/orders").json()["orders"][0]["status"] != "running":
                break
            time.sleep(0.02)
        final = c.get("/api/orders").json()["orders"][0]
    assert final["id"] == o["id"] and final["status"] == "idle"
    assert ws.is_dir() and Path(fake_process[0].cwd) == ws  # the folder was created and used
    assert "--disallowedTools" in fake_process[0].args


# ---------------------------------------------------------------------- hook installer

def run_installer(tmp_path, *args):
    env = {k: v for k, v in os.environ.items() if k not in ("IMPERIAL_BASE_DIR",)}
    env.update(USERPROFILE=str(tmp_path), HOME=str(tmp_path), HOMEDRIVE="", HOMEPATH="")
    return subprocess.run([sys.executable, str(ROOT / "scripts" / "install_hooks.py"), *args], env=env,
                          capture_output=True, text=True)


def test_installer_uses_a_copy_outside_the_checkout(tmp_path):
    st = run_installer(tmp_path, "--status")
    assert str(tmp_path) in st.stdout, "safety: the installer must be pointed at the temporary home"
    settings = tmp_path / ".claude" / "settings.json"
    settings.parent.mkdir()
    old = f'node "{(ROOT / "hooks" / "imperial-hook.js").as_posix()}"'  # an install from before this change
    settings.write_text(json.dumps({"hooks": {"Stop": [{"hooks": [{"type": "command", "command": old}]}],
                                              "PreToolUse": [{"hooks": [{"type": "command", "command": "other-tool"}]}]}}),
                        encoding="utf-8")
    r = run_installer(tmp_path)
    assert r.returncode == 0, r.stderr
    copy = tmp_path / ".imperial-base" / "hooks" / "imperial-hook.js"
    assert copy.read_bytes() == (ROOT / "hooks" / "imperial-hook.js").read_bytes()
    data = json.loads(settings.read_text(encoding="utf-8"))
    cmds = [h["command"] for groups in data["hooks"].values() for g in groups for h in g["hooks"]]
    ours = [c for c in cmds if "imperial-hook.js" in c]
    assert ours and all(copy.as_posix() in c for c in ours)          # every entry runs the copy
    assert not any(str(ROOT.as_posix()) in c for c in ours)           # none runs the checkout any more
    assert "other-tool" in cmds                                       # other tools' hooks untouched
    assert len(ours) == 11                                            # one per hook event


@pytest.mark.parametrize("arg", ["--bogus", "--instal", "-x", "--HELP"])
def test_installer_refuses_unknown_options_without_changing_anything(tmp_path, arg):
    assert str(tmp_path) in run_installer(tmp_path, "--status").stdout
    r = run_installer(tmp_path, arg)
    assert r.returncode == 2 and "nothing was changed" in r.stderr
    assert not (tmp_path / ".claude" / "settings.json").exists()
    assert not (tmp_path / ".imperial-base").exists()


def test_installer_help_changes_nothing(tmp_path):
    r = run_installer(tmp_path, "--help")
    assert r.returncode == 0 and "--uninstall" in r.stdout
    assert not (tmp_path / ".claude").exists() and not (tmp_path / ".imperial-base").exists()


def _junction(link: Path, target: Path) -> None:
    """A directory junction (needs no special rights on Windows, unlike a symlink)."""
    if sys.platform != "win32":
        pytest.skip("junctions are a Windows feature")
    r = subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], capture_output=True, text=True)
    if r.returncode != 0:
        pytest.skip(f"could not create a junction: {r.stderr.strip()}")


def test_transcript_through_a_junction_that_leaves_the_approved_folder_is_refused(tmp_path):
    root = tmp_path / "projects"
    outside = tmp_path / "outside"
    root.mkdir()
    outside.mkdir()
    row = json.dumps({"type": "assistant", "message": {"id": "m", "model": "m1", "usage": {"input_tokens": 3}}})
    (outside / "t.jsonl").write_text(row, encoding="utf-8")
    _junction(root / "escape", outside)
    assert usage_from_transcript(str(root / "escape" / "t.jsonl"), roots=[root]) is None


def test_catch_all_through_a_junction_that_leaves_dist_is_refused(spa):
    outside = spa.tmp / "outside"
    outside.mkdir()
    (outside / "leak.txt").write_text("SECRET", encoding="utf-8")
    _junction(spa.dist / "escape", outside)
    r = spa.get("/escape/leak.txt")
    assert "SECRET" not in r.text and "INDEX" in r.text

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
    """This machine talking to itself on port 8742. websocket_connect would otherwise connect to ws://testserver
    (port 80), which the server now refuses because the Host port must be the port it listens on."""

    def websocket_connect(self, url, *args, headers=None, **kwargs):
        from urllib.parse import urljoin
        return super().websocket_connect(urljoin("ws://127.0.0.1:8742", url), *args,
                                         headers={"host": "127.0.0.1:8742", **(headers or {})}, **kwargs)


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
    # the base's own page (exact origin) is fine too; a dev-server origin is not trusted by name (see M3 tests)
    assert client.post("/api/ingest", json=ev("SessionStart", "S2"),
                       headers={"origin": "http://127.0.0.1:8742"}).status_code == 200
    assert client.post("/api/ingest", json=ev("SessionStart", "S3"),
                       headers={"origin": "http://localhost:5273"}).status_code == 403


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
    # never read the real user's Claude Code settings in tests: an empty, isolated configuration instead
    monkeypatch.setattr(config, "user_settings_file", lambda: tmp_path / "isolated-claude" / "settings.json")
    monkeypatch.setattr(config, "managed_settings_files", lambda: [])
    return FakePopen.instances


def settings_of(p: "FakePopen") -> dict:
    """The --settings file a (fake) launch was given."""
    return json.loads(Path(p.args[p.args.index("--settings") + 1]).read_text(encoding="utf-8"))


def test_cli_run_starts_the_agent_isolated(tmp_path, fake_process):
    ws = tmp_path / "ws"
    ws.mkdir()
    sdir = tmp_path / "base" / "orders-settings"
    protected = [config.APP_ROOT, tmp_path / "base" / "hooks", tmp_path / "base" / "spool", sdir]
    orders_mod.CliRun("hello", "sid-1", False, ws, protected=protected, settings_dir=sdir)
    (p,) = fake_process
    args = p.args
    assert Path(p.cwd) == ws
    assert args[1] == "-p" and args[args.index("--permission-mode") + 1] == "acceptEdits"
    assert args[args.index("--tools") + 1] == "Edit,Write"
    assert args[args.index("--disallowedTools") + 1] == "mcp__*"
    assert "--strict-mcp-config" in args
    assert Path(args[args.index("--settings") + 1]).parent == sdir
    assert args[args.index("--session-id") + 1] == "sid-1"
    assert "shell" not in p.kw or p.kw["shell"] is False
    deny = settings_of(p)["permissions"]["deny"]
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
    orders_mod.CliRun("again", "sid-2", True, ws, protected=[config.APP_ROOT], settings_dir=tmp_path / "sd")
    args = fake_process[0].args
    assert args[args.index("--resume") + 1] == "sid-2" and "--session-id" not in args
    assert args[args.index("--tools") + 1] == "Edit,Write"
    assert "--disallowedTools" in args and "--strict-mcp-config" in args


def test_cli_run_refuses_an_overlapping_folder_before_starting_anything(tmp_path, fake_process):
    with pytest.raises(orders_mod.OrderError):
        orders_mod.CliRun("x", "sid-3", False, config.APP_ROOT, protected=[config.APP_ROOT])
    assert fake_process == []


def test_enabled_orders_still_run_through_the_real_runner_path_with_a_mocked_process(tmp_path, monkeypatch, fake_process):
    """End to end with the production runner wiring (CliRun via OrderManager), the process mocked."""
    import time
    monkeypatch.setattr(config, "ORDERS_ENABLED", True)
    sdir = tmp_path / "base" / "orders-settings"
    monkeypatch.setattr(config, "ORDERS_SETTINGS_DIR", sdir)
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
    args = fake_process[0].args
    assert args[args.index("--tools") + 1] == "Edit,Write"
    assert Path(args[args.index("--settings") + 1]).parent == sdir
    assert list(sdir.iterdir()) == []  # the launch's settings file was removed once the agent had ended


# ---------------------------------------------------------------------- hook installer

def run_installer(tmp_path, *args, extra_env=None):
    # CLAUDE_CONFIG_DIR is removed as well: the installer honours it, and a real one must never be touched here
    env = {k: v for k, v in os.environ.items() if k not in ("IMPERIAL_BASE_DIR", "CLAUDE_CONFIG_DIR")}
    env.update(USERPROFILE=str(tmp_path), HOME=str(tmp_path), HOMEDRIVE="", HOMEPATH="", **(extra_env or {}))
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


# ---------------------------------------------------------------------- workspace configuration (follow-up)

def test_agents_never_load_or_write_workspace_settings(tmp_path, fake_process):
    ws = tmp_path / "ws"
    ws.mkdir()
    orders_mod.CliRun("hi", "sid-4", False, ws, protected=[config.APP_ROOT], settings_dir=tmp_path / "sd")
    args = fake_process[0].args
    assert args[args.index("--setting-sources") + 1] == "user"  # project/local settings in the workspace ignored
    deny = settings_of(fake_process[0])["permissions"]["deny"]
    ws_rule = orders_mod._rule_path(ws)
    for name in (".claude/**", ".mcp.json", "CLAUDE.md", "CLAUDE.local.md"):
        assert f"Edit({ws_rule}/{name})" in deny


PLANTED_CONFIGURATION = [
    # settings files (hooks run commands outside every tool permission)
    ".claude/settings.json", ".claude/settings.local.json",
    # agents, commands, skills, hooks, rules under .claude
    ".claude/agents/evil.md", ".claude/commands/evil.md", ".claude/skills/evil/SKILL.md", ".claude/hooks/evil.js",
    ".claude/rules/evil.md",
    # instructions
    "CLAUDE.md", "CLAUDE.local.md",
    # MCP servers
    ".mcp.json",
    # other letter cases: the same files on Windows
    "claude.md", "Claude.Local.MD", ".MCP.JSON", ".Claude/agents/evil.md", ".CLAUDE/settings.json",
]


@pytest.mark.parametrize("planted", PLANTED_CONFIGURATION)
def test_a_workspace_with_planted_configuration_is_refused(tmp_path, monkeypatch, fake_process, planted):
    monkeypatch.setattr(config, "ORDERS_ENABLED", True)
    monkeypatch.setattr(config, "ORDERS_SETTINGS_DIR", tmp_path / "base" / "orders-settings")
    ws = tmp_path / "ws"
    target = ws / planted
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text('{"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "evil"}]}]}}', encoding="utf-8")
    app = create_app(db_path=str(tmp_path / "t.db"), spool_path=str(tmp_path / "s.jsonl"), start_tailer=False,
                     orders_cwd=str(ws))
    with local_client(app) as c:
        st = c.get("/api/orders").json()
        assert st["enabled"] is False and "configuration" in st["reason"]
        assert planted.split("/")[0] in st["reason"]  # the entry is named, in the case it was found
        assert c.post("/api/orders", json={"text": "x"}).status_code == 503
    with pytest.raises(orders_mod.OrderError, match="configuration"):  # the check right before launch
        orders_mod.CliRun("x", "sid-5", True, ws, protected=[config.APP_ROOT])
    assert fake_process == []


def test_a_file_named_dot_claude_is_refused(tmp_path):
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / ".claude").write_text("x", encoding="utf-8")
    assert "configuration" in (orders_mod.workspace_problem(ws, []) or "")


def test_an_ordinary_workspace_is_accepted(tmp_path):
    ws = tmp_path / "ws"
    assert orders_mod.workspace_problem(ws, []) is None  # not created yet
    (ws / "src").mkdir(parents=True)
    (ws / ".claude").mkdir()  # an empty .claude folder configures nothing
    for name in ("README.md", "claude_notes.md", "CLAUDE.md.txt", "mcp.json", "src/app.py"):
        (ws / name).write_text("x", encoding="utf-8")
    assert orders_mod.workspace_problem(ws, []) is None


def test_configuration_planted_between_turns_stops_the_next_turn(tmp_path, monkeypatch, fake_process):
    """Status was fine and a turn ran; configuration appearing afterwards blocks the follow-up before any launch."""
    import time
    monkeypatch.setattr(config, "ORDERS_ENABLED", True)
    monkeypatch.setattr(config, "ORDERS_SETTINGS_DIR", tmp_path / "base" / "orders-settings")
    ws = tmp_path / "ws"
    app = create_app(db_path=str(tmp_path / "t.db"), spool_path=str(tmp_path / "s.jsonl"), start_tailer=False,
                     orders_cwd=str(ws))
    with local_client(app) as c:
        o = c.post("/api/orders", json={"text": "first"}).json()
        for _ in range(100):
            if c.get("/api/orders").json()["orders"][0]["status"] != "running":
                break
            time.sleep(0.02)
        (ws / ".claude" / "agents").mkdir(parents=True)
        (ws / ".claude" / "agents" / "evil.md").write_text("x", encoding="utf-8")
        assert c.post(f"/api/orders/{o['id']}/messages", json={"text": "again"}).status_code == 503
    assert len(fake_process) == 1


# ====================================================================== follow-up review: tool allowlist

EXPECTED_TOOLS = "Edit,Write"  # default: no reading or searching (N1)
EXPECTED_TOOLS_WITH_READ = "Read,Edit,Write,Glob,Grep"  # IMPERIAL_ORDERS_READ=1
# Built-in tools (names from the Claude Code tools reference) that run commands or code, reach the network,
# delegate, schedule, message or load other tools. None may be in the allowlist.
DANGEROUS_TOOLS = {
    "Bash", "PowerShell", "Monitor", "Workflow", "LSP", "TaskOutput", "TaskStop",
    "WebFetch", "WebSearch", "Artifact", "PushNotification", "RemoteTrigger", "SendMessage", "SendUserFile",
    "ShareOnboardingGuide", "Agent", "Task", "Skill", "ToolSearch", "CronCreate", "CronDelete", "CronList",
    "ScheduleWakeup", "EnterWorktree", "ExitWorktree", "ListMcpResourcesTool", "ReadMcpResourceTool",
    "WaitForMcpServers", "AskUserQuestion", "NotebookEdit", "TodoWrite",
}


@pytest.mark.parametrize("read_access", [False, True], ids=["default", "read"])
@pytest.mark.parametrize("resume", [False, True])
def test_order_agents_get_only_an_explicit_tool_allowlist(tmp_path, fake_process, resume, read_access):
    ws = tmp_path / "ws"
    ws.mkdir()
    orders_mod.CliRun("hi", "sid-10", resume, ws, protected=[config.APP_ROOT], settings_dir=tmp_path / "sd",
                      read_access=read_access)
    args = fake_process[0].args
    assert args.count("--tools") == 1
    i = args.index("--tools")
    assert args[i + 1] == (EXPECTED_TOOLS_WITH_READ if read_access else EXPECTED_TOOLS)
    assert args[i + 2].startswith("--")  # the variadic option cannot swallow a following value
    tools = args[i + 1].split(",")
    assert tools == (["Read", "Edit", "Write", "Glob", "Grep"] if read_access else ["Edit", "Write"])
    assert not set(tools) & DANGEROUS_TOOLS
    assert not any(t.startswith("mcp__") for t in tools)
    # MCP: no servers, and any MCP tool removed by name
    assert "--strict-mcp-config" in args and args[args.index("--disallowedTools") + 1] == "mcp__*"
    # nothing widens the set again or bypasses permissions
    for flag in ("--allowedTools", "--allowed-tools", "--dangerously-skip-permissions",
                 "--allow-dangerously-skip-permissions", "--mcp-config", "--add-dir", "--agents", "--agent",
                 "--plugin-dir", "--plugin-url", "--chrome", "--bg"):
        assert flag not in args, flag
    assert args[args.index("--permission-mode") + 1] == "acceptEdits"
    # second layer: the dangerous tools are denied by name in --settings as well (and the read tools by default)
    deny = settings_of(fake_process[0])["permissions"]["deny"]
    for name in ("Bash", "PowerShell", "Monitor", "WebFetch", "WebSearch", "Agent", "Skill", "Workflow"):
        assert name in deny, name
    for name in ("Read", "Glob", "Grep"):
        assert (name in deny) is (not read_access), name


def test_tool_constants_match_the_command_line():
    assert ",".join(orders_mod.ORDER_TOOLS) == EXPECTED_TOOLS
    assert ",".join(orders_mod.ORDER_TOOLS_WITH_READ) == EXPECTED_TOOLS_WITH_READ
    assert orders_mod.DISALLOWED_TOOLS == "mcp__*"
    args = orders_mod.cli_args("claude", "sid", False, None)
    assert args[args.index("--tools") + 1] == EXPECTED_TOOLS
    assert "Bash" not in " ".join(args) and "PowerShell" not in " ".join(args)


# ====================================================================== follow-up review: Claude configuration

@pytest.fixture()
def fake_home(monkeypatch, tmp_path):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setattr(config, "HOME", home)
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)
    return home


def test_protected_paths_include_the_default_claude_config_dir(fake_home):
    prot = config.protected_paths()
    assert config.claude_config_dir() == fake_home / ".claude"
    assert fake_home / ".claude" in prot
    assert fake_home / ".claude.json" in prot


def test_protected_paths_follow_claude_config_dir(fake_home, monkeypatch, tmp_path):
    alt = tmp_path / "alt-config"
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(alt))
    prot = config.protected_paths()
    assert config.claude_config_dir() == alt
    assert alt in prot
    assert fake_home / ".claude" not in prot  # the folder actually in use is protected, not the default one
    assert fake_home / ".claude.json" in prot  # protected either way


def test_protected_paths_cover_sqlite_sidecars(monkeypatch, tmp_path):
    db = tmp_path / "data" / "imperial.db"
    monkeypatch.setattr(config, "DB_PATH", db)
    prot = config.protected_paths()
    for name in ("imperial.db", "imperial.db-wal", "imperial.db-shm", "imperial.db-journal"):
        assert tmp_path / "data" / name in prot, name


@pytest.mark.parametrize("override", [False, True], ids=["default", "CLAUDE_CONFIG_DIR"])
@pytest.mark.parametrize("where", ["equal", "inside", "deep_inside", "contains", "contains_far"])
def test_a_workspace_overlapping_the_claude_config_dir_is_refused(fake_home, monkeypatch, tmp_path, override, where):
    if override:
        cfg = tmp_path / "elsewhere" / "cfg"
        monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(cfg))
    else:
        cfg = fake_home / ".claude"
    cfg.mkdir(parents=True)
    ws = {"equal": cfg, "inside": cfg / "projects", "deep_inside": cfg / "projects" / "p" / "x",
          "contains": cfg.parent, "contains_far": cfg.parent.parent}[where]
    problem = orders_mod.workspace_problem(ws, config.protected_paths())
    assert problem is not None and "overlaps" in problem


def test_a_workspace_containing_the_global_state_file_is_refused(fake_home, monkeypatch, tmp_path):
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_path / "elsewhere" / "cfg"))  # .claude no longer under home
    problem = orders_mod.workspace_problem(fake_home, config.protected_paths())
    assert problem is not None and ".claude.json" in problem


@pytest.mark.parametrize("override", [False, True], ids=["default", "CLAUDE_CONFIG_DIR"])
def test_the_normal_workspace_is_not_blocked_by_config_protection(fake_home, monkeypatch, tmp_path, override):
    if override:
        monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_path / "elsewhere" / "cfg"))
    (fake_home / ".claude").mkdir()
    (fake_home / ".claude.json").write_text("{}", encoding="utf-8")
    prot = config.protected_paths()
    for ws in (fake_home / ".imperial-base" / "orders-workspace", tmp_path / "ws",
               fake_home / ".claude-work",  # shares a name prefix with .claude but is a different folder
               fake_home / ".claude.json-notes"):
        assert orders_mod.workspace_problem(ws, prot) is None, ws


def test_a_relative_claude_config_dir_is_refused(fake_home, monkeypatch, tmp_path):
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", "relative-claude")
    problem = orders_mod.workspace_problem(tmp_path / "ws", config.protected_paths())
    assert problem is not None and "absolute" in problem


def test_orders_refuse_a_workspace_inside_an_overridden_config_dir_end_to_end(fake_home, monkeypatch, tmp_path):
    cfg = tmp_path / "cfg"
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(cfg))
    monkeypatch.setattr(config, "ORDERS_ENABLED", True)
    rec = Recorder()
    app = create_app(db_path=str(tmp_path / "t.db"), spool_path=str(tmp_path / "s.jsonl"), start_tailer=False,
                     order_runner=rec, orders_cwd=str(cfg / "work"))
    with local_client(app) as c:
        st = c.get("/api/orders").json()
        assert st["enabled"] is False and "overlaps" in st["reason"]
        assert c.post("/api/orders", json={"text": "edit my settings"}).status_code == 503
    assert rec.calls == []


# ====================================================================== follow-up review: deny-rule format

# Fixed paths that do not exist, so Path.resolve() leaves them as written. Expected rule strings below are typed
# out by hand, never produced by the production helper.
WIN = sys.platform == "win32"
FAKE = Path(r"C:\ib-nonexistent-7f3a") if WIN else Path("/ib-nonexistent-7f3a")
R = "//c/ib-nonexistent-7f3a" if WIN else "//ib-nonexistent-7f3a"


@pytest.mark.parametrize("path,expected", [
    (pathlib.PureWindowsPath(r"C:\Projects\Imperial-Base"), "//c/Projects/Imperial-Base"),
    (pathlib.PureWindowsPath(r"c:\Projects\Imperial-Base"), "//c/Projects/Imperial-Base"),  # drive letter case
    (pathlib.PureWindowsPath("C:/Projects/Imperial-Base"), "//c/Projects/Imperial-Base"),   # forward slashes
    (pathlib.PureWindowsPath(r"D:\Data\IMPERIAL.db"), "//d/Data/IMPERIAL.db"),              # other drive, case kept
    (pathlib.PureWindowsPath(r"D:\Data\imperial.db-wal"), "//d/Data/imperial.db-wal"),
    (pathlib.PureWindowsPath(r"C:\Users\Alice\.claude"), "//c/Users/Alice/.claude"),
    (pathlib.PureWindowsPath(r"C:\Users\Alice\.claude.json"), "//c/Users/Alice/.claude.json"),
    (pathlib.PureWindowsPath(r"C:\Users\Alice\.claude\settings.json"), "//c/Users/Alice/.claude/settings.json"),
    (pathlib.PurePosixPath("/home/alice/.claude"), "//home/alice/.claude"),
    (pathlib.PurePosixPath("/home/alice/.claude.json"), "//home/alice/.claude.json"),
    (pathlib.PurePosixPath("/srv/data/imperial.db-shm"), "//srv/data/imperial.db-shm"),
])
def test_rule_path_text_literal(path, expected):
    assert orders_mod.rule_path_text(path) == expected


def test_agent_settings_literal_deny_list():
    protected = [FAKE / "app", FAKE / "base" / "hooks", FAKE / "data" / "imperial.db",
                 FAKE / "data" / "imperial.db-wal", FAKE / "Home" / ".claude", FAKE / "Home" / ".claude.json"]
    deny = orders_mod.agent_settings(protected, FAKE / "ws")["permissions"]["deny"]
    assert deny == [
        "Bash", "PowerShell", "Monitor", "WebFetch", "WebSearch", "Agent", "Skill", "Workflow",
        "Read", "Glob", "Grep",
        f"Read({R}/app)", f"Read({R}/app/**)", f"Edit({R}/app)", f"Edit({R}/app/**)",
        f"Read({R}/base/hooks)", f"Read({R}/base/hooks/**)", f"Edit({R}/base/hooks)", f"Edit({R}/base/hooks/**)",
        f"Read({R}/data/imperial.db)", f"Read({R}/data/imperial.db/**)",
        f"Edit({R}/data/imperial.db)", f"Edit({R}/data/imperial.db/**)",
        f"Read({R}/data/imperial.db-wal)", f"Read({R}/data/imperial.db-wal/**)",
        f"Edit({R}/data/imperial.db-wal)", f"Edit({R}/data/imperial.db-wal/**)",
        f"Read({R}/Home/.claude)", f"Read({R}/Home/.claude/**)",
        f"Edit({R}/Home/.claude)", f"Edit({R}/Home/.claude/**)",
        f"Read({R}/Home/.claude.json)", f"Read({R}/Home/.claude.json/**)",
        f"Edit({R}/Home/.claude.json)", f"Edit({R}/Home/.claude.json/**)",
        f"Edit({R}/ws/CLAUDE.md)", f"Edit({R}/ws/**/CLAUDE.md)",
        f"Edit({R}/ws/CLAUDE.local.md)", f"Edit({R}/ws/**/CLAUDE.local.md)",
        f"Edit({R}/ws/.claude)", f"Edit({R}/ws/.claude/**)", f"Edit({R}/ws/**/.claude)", f"Edit({R}/ws/**/.claude/**)",
        f"Edit({R}/ws/.mcp.json)", f"Edit({R}/ws/**/.mcp.json)",
    ]


@pytest.mark.skipif(not WIN, reason="Windows drive letters")
def test_drive_letter_case_does_not_change_the_rule():
    upper = orders_mod.agent_settings([Path(r"C:\ib-nonexistent-7f3a\Home\.claude")])["permissions"]["deny"]
    lower = orders_mod.agent_settings([Path(r"c:\ib-nonexistent-7f3a\Home\.claude")])["permissions"]["deny"]
    assert upper == lower
    assert "Edit(//c/ib-nonexistent-7f3a/Home/.claude/**)" in lower


@pytest.mark.skipif(not WIN, reason="case-insensitive Windows file names")
def test_existing_folders_are_written_in_their_on_disk_case(tmp_path):
    real = tmp_path / "Config"
    real.mkdir()
    variant = Path(str(real)[:-len("Config")] + "cONFIG")
    assert orders_mod._rule_path(variant).endswith("/Config")


def test_config_protection_reaches_the_agent_settings_file(fake_home, monkeypatch, tmp_path, fake_process):
    """The full production path: config.protected_paths() -> CliRun -> the --settings file on disk."""
    home = FAKE / "Home"
    monkeypatch.setattr(config, "HOME", home)
    ws = tmp_path / "ws"
    ws.mkdir()
    sdir = tmp_path / "base" / "orders-settings"
    orders_mod.CliRun("hi", "sid-11", False, ws, protected=config.protected_paths(), settings_dir=sdir)
    deny = settings_of(fake_process[-1])["permissions"]["deny"]
    for rule in (f"Edit({R}/Home/.claude)", f"Edit({R}/Home/.claude/**)", f"Read({R}/Home/.claude/**)",
                 f"Edit({R}/Home/.claude.json)", f"Read({R}/Home/.claude.json)"):
        assert rule in deny, rule
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(FAKE / "AltConfig"))
    orders_mod.CliRun("hi", "sid-12", False, ws, protected=config.protected_paths(), settings_dir=sdir)
    deny = settings_of(fake_process[-1])["permissions"]["deny"]
    assert f"Edit({R}/AltConfig/**)" in deny and f"Read({R}/AltConfig/**)" in deny
    assert f"Edit({R}/Home/.claude/**)" not in deny
    assert f"Edit({R}/Home/.claude.json)" in deny


# ---------------------------------------------------------------------- matching semantics (reference matcher)

def _documented_match(rule: str, target: str) -> bool:
    """A deliberately strict reading of the documented rule semantics, written independently of production code:
    a rule path starting with ``//`` is absolute; a Windows target ``C:\\a\\b`` is compared as ``/c/a/b``; ``*``
    matches within one path segment and ``**`` across segments. Stricter than Claude Code on two points, so rules
    that pass here should pass there too: matching is case-sensitive, and ``/**`` needs at least one more segment
    (``x/**`` does not match ``x`` itself) and ``/**/`` at least one folder."""
    import re
    if re.match(r"^[A-Za-z]:[\\/]", target):
        target = "/" + target[0].lower() + target[2:].replace("\\", "/")
    assert rule.startswith("//")
    pattern = rule[1:]
    out = ""
    i = 0
    while i < len(pattern):
        if pattern.startswith("**", i):
            out += ".+"
            i += 2
        elif pattern[i] == "*":
            out += "[^/]*"
            i += 1
        else:
            out += re.escape(pattern[i])
            i += 1
    return re.fullmatch(out, target) is not None


def _denied(deny: list[str], tool: str, target: str) -> bool:
    prefix = f"{tool}("
    return any(_documented_match(r[len(prefix):-1], target) for r in deny if r.startswith(prefix))


def _native(*parts: str) -> str:
    return str(FAKE.joinpath(*parts))


@pytest.fixture()
def literal_deny():
    protected = [FAKE / "app", FAKE / "base" / "hooks", FAKE / "data" / "imperial.db",
                 *[FAKE / "data" / f"imperial.db{s}" for s in ("-wal", "-shm", "-journal")],
                 FAKE / "Home" / ".claude", FAKE / "Home" / ".claude.json"]
    return orders_mod.agent_settings(protected, FAKE / "ws")["permissions"]["deny"]


@pytest.mark.parametrize("parts", [
    ("Home", ".claude"), ("Home", ".claude", "settings.json"), ("Home", ".claude", "settings.local.json"),
    ("Home", ".claude", ".credentials.json"), ("Home", ".claude", "hooks", "h.js"),
    ("Home", ".claude", "agents", "a.md"), ("Home", ".claude", "skills", "s", "SKILL.md"),
    ("Home", ".claude", "projects", "p", "t.jsonl"), ("Home", ".claude.json"),
    ("data", "imperial.db"), ("data", "imperial.db-wal"), ("data", "imperial.db-shm"), ("data", "imperial.db-journal"),
    ("app", "backend", "app", "orders.py"), ("base", "hooks", "imperial-hook.js"),
])
def test_protected_targets_are_denied_for_read_and_edit(literal_deny, parts):
    target = _native(*parts)
    assert _denied(literal_deny, "Edit", target), target
    assert _denied(literal_deny, "Read", target), target


@pytest.mark.parametrize("parts", [
    ("ws", "src", "app.py"), ("ws", "notes.md"), ("ws", "claude_notes.md"), ("Home", ".claude-backup", "x"),
    ("Home", ".claude.json.notes"), ("data", "other.db"), ("app-other", "x.py"), ("base", "hooks-old", "h.js"),
])
def test_ordinary_targets_are_not_denied(literal_deny, parts):
    target = _native(*parts)
    assert not _denied(literal_deny, "Edit", target), target
    assert not _denied(literal_deny, "Read", target), target


@pytest.mark.parametrize("parts", [
    ("ws", "CLAUDE.md"), ("ws", "CLAUDE.local.md"), ("ws", ".mcp.json"), ("ws", ".claude"),
    ("ws", ".claude", "settings.json"), ("ws", ".claude", "agents", "a.md"), ("ws", "sub", "CLAUDE.md"),
    ("ws", "a", "b", "CLAUDE.local.md"), ("ws", "sub", ".claude", "skills", "s", "SKILL.md"), ("ws", "sub", ".mcp.json"),
])
def test_workspace_configuration_cannot_be_written(literal_deny, parts):
    target = _native(*parts)
    assert _denied(literal_deny, "Edit", target), target
    assert not _denied(literal_deny, "Read", target), target  # reading the workspace is fine


def test_reference_matcher_sanity():
    assert _documented_match("//c/x/**", r"C:\x\y") and not _documented_match("//c/x/**", r"C:\x")
    assert _documented_match("//c/x/*", r"C:\x\y") and not _documented_match("//c/x/*", r"C:\x\y\z")
    assert not _documented_match("//c/x/**/a", r"C:\x\a") and _documented_match("//c/x/**/a", r"C:\x\y\a")
    assert not _documented_match("//c/X", r"C:\x")  # case-sensitive on purpose
    assert _documented_match("//home/a/**", "/home/a/b")

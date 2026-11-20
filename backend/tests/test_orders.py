"""Orders (the Commander's chat). A scripted runner stands in for the claude CLI: no agent is started."""
import os
import sys
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient as _TestClient


class _Local(_TestClient):
    """This machine talking to itself, like the browser on the base. websocket_connect ignores base_url and
    would send Host: testserver, so the real local host is set there too."""

    def websocket_connect(self, url, *args, headers=None, **kwargs):
        return super().websocket_connect(url, *args, headers={"host": "127.0.0.1:8742", **(headers or {})}, **kwargs)


def TestClient(app):  # noqa: N802
    return _Local(app, base_url="http://127.0.0.1:8742", client=("127.0.0.1", 50000))

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.main import create_app  # noqa: E402
from app.orders import MAX_RUNNING, MAX_TEXT, describe_tool, messages_from  # noqa: E402

JSON = {"content-type": "application/json"}


class FakeRun:
    """Plays back a list of stream-json records; ``hold`` keeps the turn open until released or stopped."""

    def __init__(self, records, hold=False):
        self._records = records
        self._release = threading.Event()
        if not hold:
            self._release.set()
        self.stopped = False

    def records(self):
        for r in self._records[:-1]:
            yield r
        self._release.wait(5)
        if not self.stopped:
            yield self._records[-1]

    def stop(self):
        self.stopped = True
        self._release.set()

    def release(self):
        self._release.set()


def reply(text, **result):
    return [
        {"type": "system", "subtype": "init"},
        {"type": "assistant", "message": {"content": [
            {"type": "tool_use", "name": "Read", "input": {"file_path": "C:\\secret\\dir\\layout.ts"}},
            {"type": "text", "text": text},
        ]}},
        {"type": "result", "subtype": "success", "is_error": False, "result": text, **result},
    ]


class Script:
    """Runner factory handed to the app; records every launch."""

    def __init__(self):
        self.calls = []
        self.runs = []
        self.next = lambda prompt: FakeRun(reply(f"done: {prompt}"))

    def __call__(self, prompt, session_id, resume, cwd):
        self.calls.append({"prompt": prompt, "session_id": session_id, "resume": resume, "cwd": cwd})
        run = self.next(prompt)
        self.runs.append(run)
        return run


@pytest.fixture()
def rig(tmp_path):
    script = Script()
    app = create_app(db_path=str(tmp_path / "t.db"), spool_path=str(tmp_path / "spool.jsonl"), start_tailer=False,
                     order_runner=script, orders_cwd=str(tmp_path))
    with TestClient(app) as c:
        yield c, script


def wait_for(client, order_id, status, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        o = next(o for o in client.get("/api/orders").json()["orders"] if o["id"] == order_id)
        if o["status"] == status:
            return o
        time.sleep(0.02)
    raise AssertionError(f"order never reached {status}: {o}")


# ---------------------------------------------------------------- conversation

def test_an_order_runs_in_the_fixed_folder_and_its_reply_reaches_the_chat(rig, tmp_path):
    client, script = rig
    o = client.post("/api/orders", json={"text": "  Tidy the README  "}).json()
    assert o["status"] == "running" and o["agent_id"] == f"session:{o['session_id']}"
    done = wait_for(client, o["id"], "idle")
    assert [m["role"] for m in done["messages"]] == ["commander", "tool", "agent"]
    assert done["messages"][0]["text"] == "Tidy the README"
    assert done["messages"][1]["text"] == "Read layout.ts"  # file name only, never the path
    assert done["messages"][2]["text"] == "done: Tidy the README"
    call = script.calls[0]
    assert call["cwd"] == tmp_path and call["resume"] is False and call["session_id"] == o["session_id"]


def test_a_follow_up_resumes_the_same_conversation(rig):
    client, script = rig
    o = client.post("/api/orders", json={"text": "first"}).json()
    wait_for(client, o["id"], "idle")
    r = client.post(f"/api/orders/{o['id']}/messages", json={"text": "second"})
    assert r.status_code == 200
    done = wait_for(client, o["id"], "idle")
    assert script.calls[1]["resume"] is True and script.calls[1]["session_id"] == o["session_id"]
    assert [m["text"] for m in done["messages"] if m["role"] == "commander"] == ["first", "second"]
    assert done["turns"] == 2


def test_a_busy_agent_refuses_a_second_message_and_can_be_stopped(rig):
    client, script = rig
    script.next = lambda prompt: FakeRun(reply("late"), hold=True)
    o = client.post("/api/orders", json={"text": "long job"}).json()
    assert client.post(f"/api/orders/{o['id']}/messages", json={"text": "hurry"}).status_code == 409
    stopped = client.post(f"/api/orders/{o['id']}/stop", json={}).json()
    assert stopped["status"] == "stopped" and script.runs[0].stopped
    assert stopped["messages"][-1] == {**stopped["messages"][-1], "role": "notice", "text": "Stopped by the Commander."}
    time.sleep(0.2)  # the held reply must not arrive after the stop
    after = next(x for x in client.get("/api/orders").json()["orders"] if x["id"] == o["id"])
    assert after["status"] == "stopped" and after["messages"][-1]["text"] == "Stopped by the Commander."


def test_refused_commands_and_failures_are_reported_in_the_chat(rig):
    client, script = rig
    denial = {"tool_name": "Bash", "tool_input": {"command": "rm -rf /", "description": "Delete build output"}}
    script.next = lambda prompt: FakeRun(reply("I could not run that.", permission_denials=[denial, denial]))
    o = client.post("/api/orders", json={"text": "clean up"}).json()
    done = wait_for(client, o["id"], "idle")
    notices = [m["text"] for m in done["messages"] if m["role"] == "notice"]
    assert notices == ["Not allowed without your approval: Bash: Delete build output"]
    assert "rm -rf" not in str(done)  # the command text itself is never shown or kept

    script.next = lambda prompt: FakeRun([{"type": "result", "subtype": "error_during_execution", "is_error": True}])
    bad = client.post("/api/orders", json={"text": "break"}).json()
    failed = wait_for(client, bad["id"], "failed")
    assert failed["messages"][-1]["role"] == "notice" and "error" in failed["messages"][-1]["text"]
    # a conversation that never finished a turn starts afresh instead of resuming nothing
    script.next = lambda prompt: FakeRun(reply("ok now"))
    client.post(f"/api/orders/{bad['id']}/messages", json={"text": "try again"})
    again = wait_for(client, bad["id"], "idle")
    assert script.calls[-1]["resume"] is False and again["session_id"] != bad["session_id"]


def test_a_run_that_dies_without_a_result_is_marked_failed(rig):
    client, script = rig
    script.next = lambda prompt: FakeRun([{"type": "exit", "code": 1, "stderr": "boom"}])
    o = client.post("/api/orders", json={"text": "x"}).json()
    failed = wait_for(client, o["id"], "failed")
    assert "ended unexpectedly" in failed["messages"][-1]["text"]


def test_live_updates_reach_the_websocket(rig):
    client, script = rig
    with client.websocket_connect("/ws") as ws:
        assert ws.receive_json()["type"] == "snapshot"
        assert ws.receive_json()["type"] == "system"
        first = ws.receive_json()
        assert first["type"] == "orders" and first["enabled"] is True and first["orders"] == []
        client.post("/api/orders", json={"text": "report in"})
        seen = []
        while not seen or seen[-1]["status"] != "idle":
            msg = ws.receive_json()
            assert msg["type"] == "order"
            seen.append(msg["order"])
        assert seen[0]["status"] == "running" and seen[-1]["messages"][-1]["text"] == "done: report in"


# ---------------------------------------------------------------- limits and safety

def test_input_limits(rig):
    client, _ = rig
    assert client.post("/api/orders", json={"text": "   "}).status_code == 400
    assert client.post("/api/orders", json={"nope": 1}).status_code == 400
    assert client.post("/api/orders", json={"text": "x" * (MAX_TEXT + 1)}).status_code == 413
    assert client.post("/api/orders/unknown/messages", json={"text": "hi"}).status_code == 404
    assert client.get("/api/orders").json()["orders"] == []


def test_only_so_many_agents_work_at_once(rig):
    client, script = rig
    script.next = lambda prompt: FakeRun(reply("x"), hold=True)
    ids = [client.post("/api/orders", json={"text": f"job {i}"}).json()["id"] for i in range(MAX_RUNNING)]
    assert client.post("/api/orders", json={"text": "one too many"}).status_code == 429
    for i in ids:
        client.post(f"/api/orders/{i}/stop", json={})


def test_requests_from_other_sites_are_refused(rig):
    client, script = rig
    # a page on another site: the browser sends that site as the Origin
    r = client.post("/api/orders", json={"text": "x"}, headers={"origin": "https://evil.example"})
    assert r.status_code == 403
    # a foreign name pointed at 127.0.0.1 (DNS rebinding): the Host header gives it away
    r = client.post("/api/orders", json={"text": "x"}, headers={"host": "evil.example:8742"})
    assert r.status_code == 403
    assert client.get("/api/orders", headers={"host": "evil.example"}).status_code == 403
    # a cross-site form cannot declare JSON; a JSON body sent as text is refused too
    r = client.post("/api/orders", content='{"text": "x"}', headers={"content-type": "text/plain"})
    assert r.status_code == 415
    assert script.calls == []
    # the base's own pages are welcome: the built app and the Vite dev server
    for origin in ("http://127.0.0.1:8742", "http://localhost:5273"):
        assert client.post("/api/orders", json={"text": "x"}, headers={"origin": origin}).status_code == 200


def test_the_live_socket_refuses_other_sites_and_keeps_conversations_local(rig):
    from starlette.websockets import WebSocketDisconnect

    client, _ = rig
    client.post("/api/orders", json={"text": "private order"})
    # a page on another site opening the socket (browsers allow this, so the server must refuse)
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws", headers={"origin": "https://evil.example"}):
            pass
    # a foreign name pointed at this machine: its page matches its own Host, but gets no conversations
    with client.websocket_connect("/ws", headers={"host": "evil.example:8742", "origin": "http://evil.example:8742"}) as ws:
        assert ws.receive_json()["type"] == "snapshot"
        assert ws.receive_json()["type"] == "system"
        client.post("/api/orders", json={"text": "second private order"})
        client.post("/api/ingest", json={"v": 1, "event": "SessionStart", "session_id": "S9"})
        msg = ws.receive_json()
        assert msg["type"] == "event"  # no "orders" list before it, and no "order" update either
        assert "private order" not in str(msg)
    # the base's own page still gets them
    with client.websocket_connect("/ws", headers={"origin": "http://127.0.0.1:8742"}) as ws:
        ws.receive_json(); ws.receive_json()
        assert ws.receive_json()["type"] == "orders"


def test_orders_can_be_switched_off(tmp_path, monkeypatch):
    from app import config
    monkeypatch.setattr(config, "ORDERS_ENABLED", False)
    script = Script()
    app = create_app(db_path=str(tmp_path / "t.db"), spool_path=str(tmp_path / "s.jsonl"), start_tailer=False,
                     order_runner=script, orders_cwd=str(tmp_path))
    with TestClient(app) as c:
        assert c.get("/api/orders").json()["enabled"] is False
        assert c.post("/api/orders", json={"text": "x"}).status_code == 503
        assert c.get("/api/commands").json() == {**c.get("/api/commands").json(), "enabled": False, "available": []}
    assert script.calls == []


# ---------------------------------------------------------------- pure helpers

def test_tool_descriptions_keep_detail_low():
    assert describe_tool("Edit", {"file_path": "/home/me/private/main.py", "old_string": "PASSWORD"}) == "Edit main.py"
    assert describe_tool("Bash", {"command": "curl -H 'Authorization: Bearer abc'", "description": "Check the API"}) == "Bash: Check the API"
    assert describe_tool("Bash", {"command": "secret"}) == "Bash: command"
    assert describe_tool("Agent", {"description": "Audit auth", "prompt": "long private prompt"}) == "Delegate: Audit auth"
    assert describe_tool("mcp__x__y", {"anything": 1}) == "mcp__x__y"


def test_unknown_records_are_ignored():
    assert messages_from({"type": "system", "subtype": "init"}) == ([], None)
    assert messages_from({"type": "user", "message": {"content": [{"type": "tool_result", "content": "private output"}]}}) == ([], None)
    assert messages_from({"type": "assistant", "message": {"content": "not a list"}}) == ([], None)


def test_pages_from_other_local_ports_are_refused(rig):
    """Another program serving a page on this machine (same host name, different port) is not the base."""
    from starlette.websockets import WebSocketDisconnect

    client, script = rig
    for origin in ("http://127.0.0.1:3000", "http://localhost:8080", "https://127.0.0.1:8742"):
        r = client.post("/api/orders", json={"text": "x"}, headers={"origin": origin})
        assert r.status_code == 403, origin
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/ws", headers={"origin": origin}):
                pass
    assert script.calls == []


def test_test_host_names_are_not_trusted(tmp_path):
    from fastapi.testclient import TestClient as Plain

    app = create_app(db_path=str(tmp_path / "t.db"), spool_path=str(tmp_path / "s.jsonl"), start_tailer=False,
                     order_runner=Script(), orders_cwd=str(tmp_path))
    with Plain(app) as c:  # Host "testserver", caller "testclient"
        assert c.get("/api/orders").status_code == 403
        assert c.post("/api/ingest", json={"v": 1, "event": "SessionStart", "session_id": "S1"}).status_code == 403


def test_a_claude_planted_in_the_work_folder_is_never_run(tmp_path, monkeypatch):
    from app import orders as orders_mod

    work = tmp_path / "work"
    bin_dir = tmp_path / "bin"
    work.mkdir()
    bin_dir.mkdir()
    name = "claude.cmd" if sys.platform == "win32" else "claude"
    planted = work / name
    real = bin_dir / name
    for p in (planted, real):
        p.write_text("@echo off\n" if sys.platform == "win32" else "#!/bin/sh\n")
        p.chmod(0o755)
    monkeypatch.chdir(work)
    # the work folder is on PATH first, and also given as a relative entry: neither may be used
    monkeypatch.setenv("PATH", os.pathsep.join([str(work), ".", str(bin_dir)]))
    assert orders_mod.find_claude(work) == str(real.resolve())
    monkeypatch.setenv("PATH", os.pathsep.join([str(work), "."]))
    assert orders_mod.find_claude(work) is None

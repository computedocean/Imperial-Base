import json
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient as _TestClient


class _Local(_TestClient):
    """This machine talking to itself, like the browser on the base. websocket_connect ignores base_url and would
    connect to ws://testserver (port 80), so the real local address and Host are given there too."""

    def websocket_connect(self, url, *args, headers=None, **kwargs):
        from urllib.parse import urljoin
        return super().websocket_connect(urljoin("ws://127.0.0.1:8742", url), *args,
                                         headers={"host": "127.0.0.1:8742", **(headers or {})}, **kwargs)


def TestClient(app):  # noqa: N802
    return _Local(app, base_url="http://127.0.0.1:8742", client=("127.0.0.1", 50000))

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.engine import sanitise  # noqa: E402
from app.main import create_app  # noqa: E402
from app.state import Registry  # noqa: E402
from app.transcripts import usage_from_transcript  # noqa: E402

HOOK = ROOT / "hooks" / "imperial-hook.js"


def ev(event, **kw):
    base = {"v": 1, "ts": "2026-11-05T04:00:00.000Z", "event": event, "session_id": "S1", "project": "demo"}
    base.update(kw)
    return base


def run_hook(payload: dict, tmp_path: Path) -> list[dict]:
    env = {"IMPERIAL_BASE_DIR": str(tmp_path), "PATH": __import__("os").environ["PATH"],
           "SYSTEMROOT": __import__("os").environ.get("SYSTEMROOT", "")}
    r = subprocess.run(["node", str(HOOK)], input=json.dumps(payload), text=True, capture_output=True, env=env, timeout=10)
    assert r.returncode == 0
    assert r.stdout == ""  # hooks must never print (stdout can be injected into context)
    spool = tmp_path / "spool" / "events.jsonl"
    return [json.loads(l) for l in spool.read_text(encoding="utf-8").splitlines()]


# ---------------------------------------------------------------- hook

def test_hook_redacts_and_never_stores_commands(tmp_path):
    recs = run_hook({
        "hook_event_name": "PreToolUse", "session_id": "S1", "cwd": "C:\\work\\proj",
        "transcript_path": "C:\\t.jsonl", "tool_name": "Bash", "tool_use_id": "tu1",
        "tool_input": {"command": "curl -H 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz' https://x", "description": "Check token=hunter2 for ops@example.com"},
    }, tmp_path)
    r = recs[-1]
    blob = json.dumps(r)
    assert r["event"] == "PreToolUse" and r["tool_name"] == "Bash" and r["project"] == "proj"
    assert "curl" not in blob and "abcdefghijkl" not in blob and "hunter2" not in blob and "example.com" not in blob
    assert "tool_input" in r["raw_keys"] and "tool_input" not in r


def test_hook_file_tools_keep_basename_only(tmp_path):
    r = run_hook({"hook_event_name": "PreToolUse", "session_id": "S1", "tool_name": "Edit", "tool_use_id": "t",
                  "tool_input": {"file_path": "C:\\secret\\dir\\main.py", "old_string": "PASSWORD", "new_string": "x"}}, tmp_path)[-1]
    assert r["tool_target"] == "main.py"
    assert "PASSWORD" not in json.dumps(r) and "secret" not in json.dumps(r)


def test_hook_agent_delegation_and_prompt_truncation(tmp_path):
    r = run_hook({"hook_event_name": "PreToolUse", "session_id": "S1", "tool_name": "Agent", "tool_use_id": "t9",
                  "tool_input": {"description": "Audit auth module", "subagent_type": "Explore", "prompt": "very long private prompt"}}, tmp_path)[-1]
    assert r["subagent_type"] == "Explore" and r["delegation"] == "Audit auth module"
    assert "private prompt" not in json.dumps(r)
    r = run_hook({"hook_event_name": "UserPromptSubmit", "session_id": "S1", "prompt": "x" * 1000}, tmp_path)[-1]
    assert len(r["prompt_excerpt"]) <= 160


def test_hook_survives_garbage(tmp_path):
    env = {"IMPERIAL_BASE_DIR": str(tmp_path), "PATH": __import__("os").environ["PATH"],
           "SYSTEMROOT": __import__("os").environ.get("SYSTEMROOT", "")}
    r = subprocess.run(["node", str(HOOK)], input="not json{", text=True, capture_output=True, env=env, timeout=10)
    assert r.returncode == 0 and r.stdout == ""


# ---------------------------------------------------------------- reducer

def test_lifecycle_with_delegation():
    reg = Registry()
    reg.apply(ev("SessionStart", source="startup"))
    main = reg.agents["session:S1"]
    assert main.status == "active" and main.department == "engineering"
    reg.apply(ev("UserPromptSubmit", prompt_excerpt="Build the hangar"))
    assert main.status == "working" and main.assignment == "Build the hangar"
    reg.apply(ev("PreToolUse", tool_name="Read", tool_use_id="a", tool_target="x.py"))
    assert main.active_tool == "Read"
    reg.apply(ev("PostToolUse", tool_name="Read", tool_use_id="a"))
    assert main.active_tool is None
    reg.apply(ev("PreToolUse", tool_name="Agent", tool_use_id="d1", subagent_type="Explore", delegation="Map the repo"))
    assert main.status == "delegating"
    reg.apply(ev("SubagentStart", agent_id="A1", agent_type="Explore"))
    child = reg.agents["agent:A1"]
    assert child.parent_id == "session:S1" and child.assignment == "Map the repo"
    assert child.department == "intelligence" and child.role == "Research Specialist"
    assert "agent:A1" in main.children
    reg.apply(ev("PreToolUse", agent_id="A1", agent_type="Explore", tool_name="Grep", tool_use_id="g"))
    assert child.active_tool == "Grep" and main.active_tool == "Agent"  # attributed to the subagent
    reg.apply(ev("SubagentStop", agent_id="A1", agent_type="Explore", summary="Found 3 modules"))
    assert child.status == "completed" and child.completion_summary == "Found 3 modules"
    reg.apply(ev("PostToolUse", tool_name="Agent", tool_use_id="d1"))
    assert main.status == "working"
    reg.apply(ev("Stop", summary="Done"))
    assert main.status == "idle"
    turn = [t for t in reg.tasks.values() if t.kind == "turn"][0]
    assert turn.status == "completed" and turn.tool_calls == 2
    deleg = [t for t in reg.tasks.values() if t.kind == "delegation"][0]
    assert deleg.status == "completed" and deleg.parent_agent_id == "session:S1"


def test_failures_waiting_and_disconnect():
    reg = Registry()
    reg.apply(ev("UserPromptSubmit", prompt_excerpt="x"))
    reg.apply(ev("PostToolUseFailure", tool_name="Bash", error="exit 1"))
    m = reg.agents["session:S1"]
    assert m.errors == 1 and m.last_error == "exit 1"
    reg.apply(ev("Notification", notification_type="permission_prompt"))
    assert m.status == "waiting"
    reg.apply(ev("SubagentStart", agent_id="B", agent_type="Plan"))
    assert reg.agents["agent:B"].department == "operations"
    reg.apply(ev("SessionEnd", reason="exit"))
    assert m.status == "disconnected" and reg.agents["agent:B"].status == "disconnected"


def test_stale_agents_report_unknown_activity():
    reg = Registry()
    reg.apply(ev("PreToolUse", tool_name="Bash", tool_use_id="x"))
    pub = reg.agents["session:S1"].public(now=reg.agents["session:S1"].last_event_at + 3600, stale_after=900)
    assert pub["stale"] and not pub["activity_known"] and "Unknown" in pub["activity"]


def test_sanitise_rejects_unknown_fields():
    assert sanitise({"event": "Stop"}) is None
    out = sanitise({"event": "Stop", "session_id": "S", "tool_input": {"x": 1}, "secret": "y", "summary": "ok"})
    assert "tool_input" not in out and "secret" not in out and out["summary"] == "ok"


def test_transcript_usage(tmp_path):
    p = tmp_path / "t.jsonl"
    rows = [
        {"type": "user", "message": {"content": "secret prompt"}},
        {"type": "assistant", "message": {"id": "m1", "model": "claude-opus-5-5", "usage": {"input_tokens": 10, "output_tokens": 5}}},
        {"type": "assistant", "message": {"id": "m1", "model": "claude-opus-5-5", "usage": {"input_tokens": 10, "output_tokens": 5}}},
        {"type": "assistant", "message": {"id": "m2", "model": "claude-opus-5-5", "usage": {"input_tokens": 1, "output_tokens": 2, "cache_read_input_tokens": 100}}},
    ]
    p.write_text("\n".join(json.dumps(r) for r in rows), encoding="utf-8")
    u = usage_from_transcript(str(p), roots=[tmp_path])
    assert u["input_tokens"] == 11 and u["output_tokens"] == 7 and u["cache_read_input_tokens"] == 100
    assert u["model"] == "claude-opus-5-5" and u["messages"] == 2
    assert usage_from_transcript(str(tmp_path / "missing.jsonl"), roots=[tmp_path]) is None
    # outside the approved folders the same file is not read at all
    assert usage_from_transcript(str(p), roots=[tmp_path / "elsewhere"]) is None


# ---------------------------------------------------------------- API + spool

@pytest.fixture()
def client(tmp_path):
    app = create_app(db_path=str(tmp_path / "t.db"), spool_path=str(tmp_path / "spool.jsonl"), start_tailer=False)
    with TestClient(app) as c:
        c.tmp = tmp_path
        yield c


def test_api_ingest_and_snapshot(client):
    r = client.post("/api/ingest", json=[ev("SessionStart"), ev("UserPromptSubmit", prompt_excerpt="hi"), {"bad": 1}])
    assert r.json()["accepted"] == 2
    snap = client.get("/api/snapshot").json()
    assert snap["agents"][0]["status"] == "working"
    assert len(snap["events"]) == 2
    a = client.get("/api/agents/session:S1").json()
    assert a["agent"]["assignment"] == "hi" and len(a["events"]) == 2
    cmds = client.get("/api/commands").json()
    assert cmds["available"] == (["orders"] if cmds["enabled"] else [])  # orders are the only command


def test_websocket_receives_live_events(client):
    with client.websocket_connect("/ws") as ws:
        assert ws.receive_json()["type"] == "snapshot"
        assert ws.receive_json()["type"] == "system"
        assert ws.receive_json()["type"] == "orders"  # the Commander's chat state (see test_orders.py)
        client.post("/api/ingest", json=ev("SessionStart"))
        msg = ws.receive_json()
        assert msg["type"] == "event" and msg["agents"][0]["id"] == "session:S1"


def test_spool_tailing_is_incremental_and_handles_partial_lines(client):
    eng = client.app.state.engine
    spool = client.tmp / "spool.jsonl"
    import asyncio

    spool.write_text(json.dumps(ev("SessionStart")) + "\n" + '{"event":"Sto', encoding="utf-8")
    assert asyncio.run(eng.poll_spool()) == 1
    with spool.open("a", encoding="utf-8") as fh:
        fh.write('p","session_id":"S1"}\n')
    assert asyncio.run(eng.poll_spool()) == 1
    assert asyncio.run(eng.poll_spool()) == 0
    assert eng.registry.agents["session:S1"].status == "idle"
    # truncation / rotation restarts from 0
    spool.write_text(json.dumps(ev("SessionEnd")) + "\n", encoding="utf-8")
    assert asyncio.run(eng.poll_spool()) == 1


def test_state_rebuilds_from_db_after_restart(tmp_path):
    db, sp = str(tmp_path / "r.db"), str(tmp_path / "s.jsonl")
    with TestClient(create_app(db_path=db, spool_path=sp, start_tailer=False)) as c:
        c.post("/api/ingest", json=[ev("SessionStart"), ev("SubagentStart", agent_id="Z", agent_type="Explore")])
    with TestClient(create_app(db_path=db, spool_path=sp, start_tailer=False)) as c:
        ids = {a["id"] for a in c.get("/api/agents").json()}
        assert ids == {"session:S1", "agent:Z"}


def test_injected_agent_report_does_not_overwrite_orders():
    reg = Registry()
    reg.apply(ev("UserPromptSubmit", prompt_excerpt="Refactor the hangar"))
    reg.apply(ev("Stop"))
    reg.apply(ev("UserPromptSubmit", prompt_excerpt='<agent-message from="abc"> [Subagent hand-back] ...'))
    m = reg.agents["session:S1"]
    assert m.assignment == "Refactor the hangar"
    kinds = sorted(t.kind for t in reg.tasks.values())
    assert kinds == ["report", "turn"]


# ---------------------------------------------------------------- other clients, permissions, backlog

def test_hook_records_cursor_events_under_claude_names(tmp_path):
    r = run_hook({"hook_event_name": "beforeSubmitPrompt", "conversation_id": "C1", "session_id": "C1", "cursor_version": "3.1",
                  "workspace_roots": ["c:/Projects/TradingAgents"], "model": "gpt-x", "prompt": "fix the bug",
                  "user_email": "ops@example.com"}, tmp_path)[-1]
    assert r["event"] == "UserPromptSubmit" and r["client"] == "cursor" and r["project"] == "TradingAgents"
    assert r["prompt_excerpt"] == "fix the bug" and r["model"] == "gpt-x"
    assert "example.com" not in json.dumps(r)
    r = run_hook({"hook_event_name": "preToolUse", "session_id": "C1", "cursor_version": "3.1", "tool_name": "Read",
                  "tool_use_id": "t", "tool_input": {"file_path": "c:/x/secret/a.py"}}, tmp_path)[-1]
    assert r["event"] == "PreToolUse" and r["tool_target"] == "a.py"


def test_cursor_event_names_drive_the_same_lifecycle():
    reg = Registry()
    cur = {"transcript_path": r"c:\Users\me\.cursor\projects\p\agent-transcripts\x.jsonl"}
    reg.apply(ev("sessionStart", **cur))
    m = reg.agents["session:S1"]
    assert m.client == "cursor" and m.public()["client_label"] == "Cursor" and not m.public()["engaged"]
    reg.apply(ev("beforeSubmitPrompt", prompt_excerpt="go", **cur))
    assert m.status == "working" and m.public()["engaged"]
    reg.apply(ev("preToolUse", tool_name="Read", tool_use_id="a", **cur))
    assert m.active_tool == "Read"
    reg.apply(ev("postToolUse", tool_name="Read", tool_use_id="a", **cur))
    reg.apply(ev("stop", **cur))
    assert m.status == "idle" and [t.status for t in reg.tasks.values()] == ["completed"]
    assert sanitise({"event": "stop", "session_id": "S"})["event"] == "Stop"


def test_permission_request_marks_agent_waiting():
    reg = Registry()
    reg.apply(ev("UserPromptSubmit", prompt_excerpt="x"))
    reg.apply(ev("PermissionRequest", tool_name="Bash"))
    m = reg.agents["session:S1"]
    assert m.status == "waiting" and "Bash" in m.activity
    reg.apply(ev("PostToolUse", tool_name="Bash"))
    assert m.status == "working"


def _poll_all(eng):
    import asyncio

    async def run():
        n = await eng.poll_spool()
        while eng.more_pending:
            n += await eng.poll_spool()
        return n
    return asyncio.run(run())


def test_backlog_is_ingested_quietly_then_one_snapshot(client):
    eng = client.app.state.engine
    spool = client.tmp / "spool.jsonl"
    lines = [json.dumps(ev("SessionStart"))] + [json.dumps(ev("PreToolUse", tool_name="Read", tool_use_id=f"t{i}")) for i in range(120)]
    spool.write_text("\n".join(lines) + "\n", encoding="utf-8")
    got = []

    async def listener(msg):
        got.append(msg["type"])
    eng.listeners.add(listener)
    assert _poll_all(eng) == 121
    assert got == ["snapshot"]  # no per-event flood
    assert eng.registry.agents["session:S1"].tool_calls == 120
    # a restart reads nothing twice
    with TestClient(create_app(db_path=str(client.tmp / "t.db"), spool_path=str(spool), start_tailer=False)) as c2:
        assert _poll_all(c2.app.state.engine) == 0
        assert c2.app.state.engine.registry.agents["session:S1"].tool_calls == 120


def test_large_backlog_spans_several_chunks(client, monkeypatch):
    from app import engine as engine_mod
    monkeypatch.setattr(engine_mod, "CHUNK_BYTES", 2000)
    eng = client.app.state.engine
    spool = client.tmp / "spool.jsonl"
    spool.write_text("".join(json.dumps(ev("PreToolUse", tool_name="Read", tool_use_id=f"t{i}")) + "\n" for i in range(300)), encoding="utf-8")
    assert _poll_all(eng) == 300
    assert eng.store.count() == 300 and int(eng.store.get_meta("spool_offset")) == spool.stat().st_size


def test_rotated_spool_tail_is_not_lost(client):
    eng = client.app.state.engine
    spool = client.tmp / "spool.jsonl"
    spool.write_text(json.dumps(ev("SessionStart")) + "\n", encoding="utf-8")
    assert _poll_all(eng) == 1
    # two more events land, then the hook rotates the file before the backend reads them
    with spool.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(ev("UserPromptSubmit", prompt_excerpt="late orders")) + "\n")
        fh.write(json.dumps(ev("PreToolUse", tool_name="Bash", tool_use_id="b")) + "\n")
    spool.rename(client.tmp / "spool.jsonl.1794000000000.old")
    spool.write_text(json.dumps(ev("Stop")) + "\n", encoding="utf-8")
    assert _poll_all(eng) == 3
    m = eng.registry.agents["session:S1"]
    assert m.assignment == "late orders" and m.tool_calls == 1 and m.status == "idle"
    assert _poll_all(eng) == 0

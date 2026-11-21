"""Ingestion engine: spool tailing -> validation -> SQLite -> registry -> subscribers."""
from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path
from typing import Any, Awaitable, Callable

from . import config
from .redact import IDENTITY_FIELDS, redact_text
from .state import Registry, Task, canonical_event
from .store import Store
from .transcripts import usage_from_transcript

KNOWN_EVENTS = {
    "SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure",
    "SubagentStart", "SubagentStop", "Stop", "StopFailure", "Notification", "PermissionRequest", "PreCompact",
    "PostCompact",
}
ALLOWED_KEYS = {
    "v", "ts", "event", "session_id", "cwd", "project", "transcript_path", "permission_mode", "agent_id",
    "agent_type", "raw_keys", "source", "model", "reason", "prompt_excerpt", "tool_name", "tool_use_id",
    "tool_target", "subagent_type", "delegation", "error", "agent_transcript_path", "summary",
    "notification_type", "message", "client",
}
BULK_LINES = 40  # a poll with more complete lines than this is a backlog: ingest quietly, then send one snapshot
CHUNK_BYTES = 1024 * 1024  # spool bytes read (and committed) per poll


def sanitise(rec: Any) -> dict[str, Any] | None:
    """Accept only the reduced hook schema (defence in depth if something else writes the spool), and redact
    recognisable secrets from every free-text field again (see redact.py)."""
    if not isinstance(rec, dict) or not isinstance(rec.get("event"), str) or not rec.get("session_id"):
        return None
    out: dict[str, Any] = {}
    for k, v in rec.items():
        if k not in ALLOWED_KEYS:
            continue
        if isinstance(v, str):
            v = v[:600] if k in IDENTITY_FIELDS else redact_text(v[:600])[:600]
        elif k == "raw_keys" and isinstance(v, list):
            v = [redact_text(str(x)[:64])[:64] for x in v[:64]]
        elif k == "model" and isinstance(v, dict):
            v = redact_text(str(v.get("id") or v.get("display_name") or "")[:80])[:80]
        elif not isinstance(v, (int, float, bool)) and v is not None:
            continue
        out[k] = v
    if not isinstance(out.get("session_id"), (str, int)) or not out.get("session_id"):
        return None
    out["event"] = canonical_event(out["event"])
    out.setdefault("ts", time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()))
    return out


Listener = Callable[[dict[str, Any]], Awaitable[None]]


class Engine:
    def __init__(self, store: Store, spool: Path):
        self.store = store
        self.spool = spool
        self.registry = Registry()
        self.listeners: set[Listener] = set()
        self.ingested = 0
        self.started = time.time()
        self.schema_keys: dict[str, set[str]] = {}
        self.more_pending = False  # the last poll stopped at the chunk limit; poll again without sleeping
        self._snapshot_due = False  # a backlog was ingested quietly; subscribers still need one snapshot
        self._replay()

    # ------------------------------------------------------------------ bootstrap
    def _replay(self) -> None:
        for _, ev in self.store.iter_events():
            self.registry.apply(ev)
            self._note_schema(ev)
        for key, usage in self.store.all_usage().items():
            self.registry.set_tokens(key, usage)

    def _note_schema(self, ev: dict[str, Any]) -> None:
        # known event names only: arbitrary names from /api/ingest would otherwise grow this map without limit
        if isinstance(ev.get("raw_keys"), list) and ev.get("event") in KNOWN_EVENTS:
            self.schema_keys.setdefault(ev["event"], set()).update(ev["raw_keys"])

    # ------------------------------------------------------------------ ingestion
    async def ingest(self, rec: Any, *, live: bool = True, commit: bool = True,
                     usage_todo: dict[str, str | None] | None = None) -> dict[str, Any] | None:
        """Validate, store and apply one record.

        ``live`` events are broadcast to subscribers one by one. Backlog events (``live=False``) are
        applied quietly; the caller sends a single snapshot afterwards and reads each transcript once
        (``usage_todo`` collects agent key -> transcript path).
        """
        ev = sanitise(rec)
        if ev is None:
            return None
        ev["id"] = self.store.add_event(ev, commit=commit)
        self.ingested += 1
        self._note_schema(ev)
        agents, tasks = self.registry.apply(ev)
        if config.READ_TRANSCRIPT_USAGE and ev["event"] in ("Stop", "SubagentStop", "SessionEnd"):
            path = ev.get("agent_transcript_path") if ev["event"] == "SubagentStop" else ev.get("transcript_path")
            key = f"agent:{ev['agent_id']}" if ev["event"] == "SubagentStop" and ev.get("agent_id") else f"session:{ev['session_id']}"
            if usage_todo is not None:
                usage_todo[key] = path
            else:
                usage_agent = await self._read_usage(key, path, commit=commit)
                if usage_agent and usage_agent not in agents:
                    agents.append(usage_agent)
        if live:
            await self.broadcast({
                "type": "event",
                "event": ev,
                "agents": [a.public(stale_after=config.STALE_AFTER_SECONDS) for a in {a.id: a for a in agents}.values()],
                "tasks": [t.__dict__ for t in tasks],
            })
        if self.ingested % 1000 == 0:
            self.store.prune(config.MAX_EVENTS_KEPT, commit=commit)
        return ev

    async def _read_usage(self, key: str, path: str | None, commit: bool = True):
        usage = await asyncio.to_thread(usage_from_transcript, path)
        if not usage:
            return None
        self.store.save_usage(key, usage, commit=commit)
        return self.registry.set_tokens(key, usage)

    async def broadcast(self, msg: dict[str, Any]) -> None:
        for fn in list(self.listeners):
            try:
                await fn(msg)
            except Exception:
                self.listeners.discard(fn)

    def snapshot(self) -> dict[str, Any]:
        now = time.time()
        return {
            "type": "snapshot",
            "agents": [a.public(now, config.STALE_AFTER_SECONDS) for a in self.registry.agents.values()],
            "tasks": [t.__dict__ for t in sorted(self.registry.tasks.values(), key=lambda t: t.started_at)][-300:],
            "events": self.store.recent_events(250),
            "delegations": self.registry.delegations(),
            "ingest": self.status(),
        }

    def status(self) -> dict[str, Any]:
        spool_exists = self.spool.exists()
        return {
            "spool": str(self.spool),
            "spool_exists": spool_exists,
            "spool_bytes": self.spool.stat().st_size if spool_exists else 0,
            "offset": int(self.store.get_meta("spool_offset", "0") or 0),
            "events_stored": self.store.count(),
            "ingested_this_run": self.ingested,
            "uptime_s": round(time.time() - self.started),
            "hook_installed": hook_installed(),
        }

    # ------------------------------------------------------------------ spool tail
    async def tail_spool_forever(self) -> None:
        while True:
            try:
                await self.poll_spool()
            except Exception as e:  # keep tailing no matter what
                self.more_pending = False
                # the error type only: an exception's text can quote the spool line it failed on
                print(f"[imperial] spool poll error: {type(e).__name__}")
            if not self.more_pending:
                await asyncio.sleep(config.SPOOL_POLL_SECONDS)

    def _rotated_spool(self, offset: int) -> Path | None:
        """The file the hook renamed the spool to (``events.jsonl.<ms>.old``), if it still has unread lines."""
        try:
            olds = sorted(self.spool.parent.glob(self.spool.name + ".*.old"), key=lambda p: p.stat().st_mtime)
            return olds[-1] if olds and olds[-1].stat().st_size > offset else None
        except OSError:
            return None

    async def poll_spool(self) -> int:
        """Ingest the next chunk of complete spool lines. Returns the number of events accepted.

        Events and the new read offset are committed in one transaction, so a crash or restart can
        neither lose nor duplicate events.
        """
        self.more_pending = False
        try:
            st = os.stat(self.spool)
        except FileNotFoundError:
            return 0
        offset = int(self.store.get_meta("spool_offset", "0") or 0)
        source, size, draining = self.spool, st.st_size, False
        if st.st_size < offset:  # rotated or truncated: finish the renamed file first, then start over
            old = self._rotated_spool(offset)
            if old is None:
                offset = 0
            else:
                source, size, draining = old, old.stat().st_size, True
        if size == offset:
            return 0
        with open(source, "rb") as fh:
            fh.seek(offset)
            chunk = fh.read(min(size - offset, CHUNK_BYTES))
        end = chunk.rfind(b"\n")
        hit_limit = offset + len(chunk) < size
        if end < 0 and not draining:
            if hit_limit:  # a single line longer than a whole chunk is not ours: skip past it
                self.store.set_meta("spool_offset", str(offset + len(chunk)))
                self.more_pending = True
            return 0  # wait for a complete line
        lines = [ln for ln in chunk[: end + 1].splitlines() if ln.strip()]
        bulk = len(lines) > BULK_LINES
        usage_todo: dict[str, str | None] | None = {} if bulk else None
        n = 0
        try:
            for line in lines:
                try:
                    rec = json.loads(line.decode("utf-8", errors="replace"))
                except ValueError:
                    continue
                if await self.ingest(rec, live=not bulk, commit=False, usage_todo=usage_todo):
                    n += 1
            if draining and not hit_limit:
                new_offset = 0  # renamed file finished (a torn last line is dropped); the live spool is next
                self.more_pending = True
            else:
                new_offset = offset + (end + 1 if end >= 0 else len(chunk))
                self.more_pending = hit_limit
            self.store.set_meta("spool_offset", str(new_offset), commit=False)
            self.store.commit()
        except BaseException:
            self.store.rollback()
            raise
        if usage_todo:
            for key, path in usage_todo.items():
                await self._read_usage(key, path)
        self._snapshot_due = self._snapshot_due or bulk
        if self._snapshot_due and not self.more_pending:
            self._snapshot_due = False
            await self.broadcast(self.snapshot())
        return n


def hook_installed() -> bool:
    """Whether the user settings Claude Code actually reads (in CLAUDE_CONFIG_DIR when set) mention the hook."""
    try:
        return "imperial-hook.js" in config.user_settings_file().read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return False


def task_dict(t: Task) -> dict[str, Any]:
    return dict(t.__dict__)

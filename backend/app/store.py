"""SQLite persistence. The events table is the source of truth; agent state is rebuilt by replay."""
from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any, Iterable

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  event TEXT NOT NULL,
  session_id TEXT,
  agent_id TEXT,
  agent_type TEXT,
  tool_name TEXT,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS ix_events_agent ON events(agent_id);
CREATE TABLE IF NOT EXISTS usage (
  agent_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT
);
"""


class Store:
    def __init__(self, path: Path | str):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript(SCHEMA)
        self.db.commit()

    def commit(self) -> None:
        with self._lock:
            self.db.commit()

    def rollback(self) -> None:
        with self._lock:
            self.db.rollback()

    def add_event(self, ev: dict[str, Any], commit: bool = True) -> int:
        with self._lock:
            cur = self.db.execute(
                "INSERT INTO events(ts,event,session_id,agent_id,agent_type,tool_name,payload) VALUES(?,?,?,?,?,?,?)",
                (ev.get("ts", ""), ev.get("event", "Unknown"), ev.get("session_id"), ev.get("agent_id"),
                 ev.get("agent_type"), ev.get("tool_name"), json.dumps(ev, separators=(",", ":"))),
            )
            if commit:
                self.db.commit()
            return int(cur.lastrowid)

    def iter_events(self) -> Iterable[tuple[int, dict[str, Any]]]:
        with self._lock:
            rows = self.db.execute("SELECT id,payload FROM events ORDER BY id").fetchall()
        for rid, payload in rows:
            yield rid, json.loads(payload)

    def recent_events(self, limit: int = 200, agent_key: str | None = None, session_id: str | None = None) -> list[dict]:
        q = "SELECT id,payload FROM events"
        args: list[Any] = []
        if agent_key and agent_key.startswith("agent:"):
            q += " WHERE agent_id=?"
            args.append(agent_key[6:])
        elif agent_key and agent_key.startswith("session:"):
            q += " WHERE session_id=? AND agent_id IS NULL"
            args.append(agent_key[8:])
        elif session_id:
            q += " WHERE session_id=?"
            args.append(session_id)
        q += " ORDER BY id DESC LIMIT ?"
        args.append(int(limit))
        with self._lock:
            rows = self.db.execute(q, args).fetchall()
        return [dict(json.loads(p), id=i) for i, p in rows][::-1]

    def prune(self, keep: int, commit: bool = True) -> None:
        with self._lock:
            self.db.execute("DELETE FROM events WHERE id <= (SELECT MAX(id) FROM events) - ?", (keep,))
            if commit:
                self.db.commit()

    def get_meta(self, k: str, default: str | None = None) -> str | None:
        with self._lock:
            r = self.db.execute("SELECT v FROM meta WHERE k=?", (k,)).fetchone()
        return r[0] if r else default

    def set_meta(self, k: str, v: str, commit: bool = True) -> None:
        with self._lock:
            self.db.execute("INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, v))
            if commit:
                self.db.commit()

    def save_usage(self, agent_key: str, usage: dict[str, Any], commit: bool = True) -> None:
        with self._lock:
            self.db.execute("INSERT INTO usage(agent_key,payload) VALUES(?,?) ON CONFLICT(agent_key) DO UPDATE SET payload=excluded.payload",
                            (agent_key, json.dumps(usage)))
            if commit:
                self.db.commit()

    def all_usage(self) -> dict[str, dict[str, Any]]:
        with self._lock:
            rows = self.db.execute("SELECT agent_key,payload FROM usage").fetchall()
        return {k: json.loads(p) for k, p in rows}

    def count(self) -> int:
        with self._lock:
            return int(self.db.execute("SELECT COUNT(*) FROM events").fetchone()[0])

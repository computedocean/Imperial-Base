"""Imperial Base backend configuration (env-overridable, local-first)."""
from __future__ import annotations

import os
from pathlib import Path

HOME = Path.home()
BASE_DIR = Path(os.environ.get("IMPERIAL_BASE_DIR", HOME / ".imperial-base"))
SPOOL_PATH = Path(os.environ.get("IMPERIAL_SPOOL", BASE_DIR / "spool" / "events.jsonl"))
DB_PATH = Path(os.environ.get("IMPERIAL_DB", Path(__file__).resolve().parents[1] / "data" / "imperial.db"))
FRONTEND_DIST = Path(os.environ.get("IMPERIAL_FRONTEND_DIST", Path(__file__).resolve().parents[2] / "frontend" / "dist"))

HOST = os.environ.get("IMPERIAL_HOST", "127.0.0.1")  # loopback only by default
PORT = int(os.environ.get("IMPERIAL_PORT", "8742"))

SPOOL_POLL_SECONDS = float(os.environ.get("IMPERIAL_SPOOL_POLL", "0.5"))  # a single os.stat per tick when idle
SYSTEM_SAMPLE_SECONDS = float(os.environ.get("IMPERIAL_SYSTEM_SAMPLE", "5"))  # only while a client is connected
STALE_AFTER_SECONDS = int(os.environ.get("IMPERIAL_STALE_AFTER", str(15 * 60)))
MAX_EVENTS_KEPT = int(os.environ.get("IMPERIAL_MAX_EVENTS", "50000"))
READ_TRANSCRIPT_USAGE = os.environ.get("IMPERIAL_READ_USAGE", "1") != "0"  # numbers + model name only

APP_ROOT = Path(__file__).resolve().parents[2]  # the Imperial Base checkout (code, hooks, start scripts)

# Transcript files are read (token counters and model id only) from these folders and nowhere else.
_claude_dir = Path(os.environ["CLAUDE_CONFIG_DIR"]) if os.environ.get("CLAUDE_CONFIG_DIR") else HOME / ".claude"
TRANSCRIPT_ROOTS = [Path(p) for p in os.environ.get("IMPERIAL_TRANSCRIPT_ROOTS", "").split(os.pathsep) if p] or [
    _claude_dir / "projects", HOME / ".cursor"]

MAX_INGEST_BYTES = int(os.environ.get("IMPERIAL_MAX_INGEST_BYTES", str(2 * 1024 * 1024)))

# Orders: agents started from the base's chat. Off unless IMPERIAL_ORDERS=1. They work in a folder of their own,
# outside the Imperial Base checkout, so they can never edit the base's code, hooks or start scripts.
ORDERS_ENABLED = os.environ.get("IMPERIAL_ORDERS", "0") == "1"
ORDERS_CWD = Path(os.environ.get("IMPERIAL_ORDERS_CWD", BASE_DIR / "orders-workspace"))
HOOK_DIR = BASE_DIR / "hooks"  # where scripts/install_hooks.py puts the copy of the hook that Claude Code runs
ORDERS_SETTINGS = BASE_DIR / "orders-settings.json"  # the deny rules handed to order agents (--settings)


def protected_paths() -> list[Path]:
    """Folders and files an order agent must never edit: the base's code, the hook copy, the spool, the DB and
    the agents' own settings file."""
    return [APP_ROOT, HOOK_DIR, SPOOL_PATH.parent, DB_PATH, ORDERS_SETTINGS]

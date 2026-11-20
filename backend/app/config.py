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

# Orders: agents started from the base's chat. They work in this one folder and nowhere else.
ORDERS_ENABLED = os.environ.get("IMPERIAL_ORDERS", "1") != "0"
ORDERS_CWD = Path(os.environ.get("IMPERIAL_ORDERS_CWD", Path(__file__).resolve().parents[2]))

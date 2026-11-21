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
# outside the Imperial Base checkout; deny rules and the folder boundary keep them away from the base's code, hooks
# and start scripts (see orders.py for what is and is not enforced).
ORDERS_ENABLED = os.environ.get("IMPERIAL_ORDERS", "0") == "1"
ORDERS_CWD = Path(os.environ.get("IMPERIAL_ORDERS_CWD", BASE_DIR / "orders-workspace"))
# Read, Glob and Grep for order agents. Off unless IMPERIAL_ORDERS_READ=1: their containment to the workspace rests
# on a PreToolUse hook, and Claude Code lets a tool call through if a hook cannot be run at all (see orders.py).
ORDERS_READ = os.environ.get("IMPERIAL_ORDERS_READ", "0") == "1"
HOOK_DIR = BASE_DIR / "hooks"  # where scripts/install_hooks.py puts the copy of the hook that Claude Code runs
# One settings file per agent launch (--settings), created here with a unique name and removed when the agent ends.
ORDERS_SETTINGS_DIR = BASE_DIR / "orders-settings"
RUN_DIR = BASE_DIR / "run"  # process records the stop script uses to recognise the base's own servers

# The Vite dev servers (dev.cmd on 5273, the QA preview on 5274) proxy /api and /ws to the backend and pass the
# browser's Host through. A request whose Host names one of these ports is accepted only with the per-launch token
# the running Vite server wrote to DEV_PROXY_DIR (see main.py); the port number alone proves nothing.
DEV_PROXY_PORTS = (5273, 5274)
DEV_PROXY_DIR = BASE_DIR / "dev-proxy"

# SQLite keeps a write-ahead log and shared-memory file (and, in rollback mode, a journal) next to the database.
DB_SIDECAR_SUFFIXES = ("-wal", "-shm", "-journal")


def claude_config_dir() -> Path:
    """The Claude Code configuration folder an order agent will use: CLAUDE_CONFIG_DIR when set (agents inherit
    the backend's environment), otherwise ~/.claude. It holds the user settings and their hooks, credentials,
    agents, commands, skills, plugins and transcripts. Read at call time so tests and restarts see changes."""
    value = os.environ.get("CLAUDE_CONFIG_DIR")
    return Path(value) if value else HOME / ".claude"


def claude_state_files() -> list[Path]:
    """Claude Code's global state file. It lives at ~/.claude.json, or inside CLAUDE_CONFIG_DIR when that is set
    (already covered by claude_config_dir()). ~/.claude.json is protected either way: it is cheap, and a stale
    copy should not become writable just because the variable is set."""
    return [HOME / ".claude.json"]


def user_settings_file() -> Path:
    """The Claude Code user settings file order agents load (--setting-sources user), in the effective config dir."""
    return claude_config_dir() / "settings.json"


def managed_settings_files() -> list[Path]:
    """Places Claude Code reads managed (policy) settings from. They apply to every session, whatever
    --setting-sources says, so the base inspects them too."""
    if os.name == "nt":
        roots = [Path(os.environ.get("ProgramFiles") or r"C:\Program Files"),
                 Path(os.environ.get("ProgramData") or r"C:\ProgramData")]
        return [r / "ClaudeCode" / "managed-settings.json" for r in roots]
    return [Path("/Library/Application Support/ClaudeCode/managed-settings.json"),
            Path("/etc/claude-code/managed-settings.json")]


# Common places for credentials in a user profile. Order agents work in their own folder and a guard refuses every
# path outside it; these also get deny rules as a second layer, and a workspace may not overlap them.
USER_SECRET_NAMES = (".ssh", ".aws", ".azure", ".kube", ".docker", ".gnupg", ".config", ".netrc", ".npmrc", ".pypirc",
                     ".git-credentials", ".gitconfig")


def protected_paths() -> list[Path]:
    """Folders and files an order agent may not read or edit, and that its workspace may not overlap: the base's
    code, the hook copy, the spool, the database (with its SQLite sidecar files), the agents' settings folder, the
    base's process records and dev-proxy tokens, the effective Claude Code configuration folder, Claude Code's
    global state file and the usual credential files in the user profile."""
    db_sidecars = [DB_PATH.with_name(DB_PATH.name + s) for s in DB_SIDECAR_SUFFIXES]
    return [APP_ROOT, HOOK_DIR, SPOOL_PATH.parent, DB_PATH, *db_sidecars, ORDERS_SETTINGS_DIR, RUN_DIR,
            DEV_PROXY_DIR, claude_config_dir(), *claude_state_files(), *(HOME / n for n in USER_SECRET_NAMES)]

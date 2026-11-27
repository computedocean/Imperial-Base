"""PreToolUse guard for order agents: every file path must stay inside the orders workspace.

Claude Code runs this before each tool call of an order agent (it is installed as a PreToolUse hook in the
per-launch --settings file, see orders.py). It reads the hook payload on stdin and either exits 0 (no objection;
Claude Code's own permission rules still apply) or exits 2, which blocks the call, with a short reason on stderr.
It never allows anything by itself and never prints the payload.

Rules (fail closed: anything unexpected is refused):
  * only the tools the base names on the command line (``Edit+Write``, or ``Read+Edit+Write+Glob+Grep``), and only
    those among Read, Edit, Write, Glob and Grep, may run at all;
  * Read, Edit and Write: ``file_path`` must name a plain local path inside the workspace, after resolving
    symbolic links, junctions and other reparse points; compared case-insensitively on Windows;
  * Glob and Grep: ``path`` (if given) likewise; ``pattern`` (Glob) and ``glob`` (Grep) must be relative patterns
    with no ``..``, no drive, no leading slash and no home folder;
  * Edit and Write may not create or change Claude Code project configuration anywhere in the workspace
    (CLAUDE.md, CLAUDE.local.md, .claude, .mcp.json - any letter case);
  * refused as text, before any filesystem call: UNC and device paths (``\\\\server\\share``, ``\\\\?\\``,
    ``\\\\.\\``), alternate data streams, reserved device names, ``..`` components, NUL and control characters.

Standalone on purpose (standard library only, run with ``python -I``) so that nothing in the workspace or the
environment can change what it imports.
"""
from __future__ import annotations

import json
import ntpath
import os
import re
import sys

WIN = sys.platform == "win32"
MAX_STDIN = 2 * 1024 * 1024
KNOWN_TOOLS = ("Read", "Edit", "Write", "Glob", "Grep")
WRITE_TOOLS = ("Edit", "Write")
CONFIG_NAMES = {"claude.md", "claude.local.md", ".claude", ".mcp.json"}
_RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(10)), *(f"lpt{i}" for i in range(10))}
_DRIVE_ABS = re.compile(r"^[A-Za-z]:[\\/]")


def _plain_absolute(path: str) -> bool:
    """An ordinary absolute local path (same rules as app.pathsafe.plain_local_absolute, kept here so the guard
    imports nothing from the application)."""
    if not isinstance(path, str) or not path or len(path) > 1024 or "\x00" in path:
        return False
    if any(ord(c) < 32 for c in path):
        return False
    if WIN:
        if path.startswith(("\\\\", "//", "\\/", "/\\")):
            return False
        if not _DRIVE_ABS.match(path) or ":" in path[2:]:
            return False
        parts = re.split(r"[\\/]+", path[3:])
    else:
        if not path.startswith("/") or path.startswith("//"):
            return False
        parts = path[1:].split("/")
    for part in parts:
        if part in ("..", "."):
            return False
        if WIN and part.split(".")[0].rstrip(" ").lower() in _RESERVED:
            return False
    return True


def _key(path: str) -> str:
    """Comparison key: separators unified, letter case folded on Windows (NTFS names are case-insensitive)."""
    if WIN:
        return ntpath.normcase(ntpath.normpath(path))
    return os.path.normpath(path)


def _within(child: str, root: str) -> bool:
    c, r = _key(child), _key(root).rstrip("\\/")
    sep = "\\" if WIN else "/"
    return c == r or c.startswith(r + sep)


def _relative_ok(text: str) -> bool:
    """A relative path or pattern that cannot leave the folder as text: no drive or stream colon, no leading
    separator, no home folder, no ``..`` anywhere, no NUL or control characters."""
    if not isinstance(text, str) or not text or len(text) > 1024:
        return False
    if any(ord(c) < 32 for c in text) or ":" in text or ".." in text:
        return False
    if text.startswith(("/", "\\", "~")):
        return False
    for part in re.split(r"[\\/]+", text):
        if WIN and part.split(".")[0].rstrip(" ").lower() in _RESERVED:
            return False
    return True


def resolve_inside(raw: object, workspace: str) -> str | None:
    """The real path ``raw`` names if it lies inside ``workspace`` (after following links), else None. The text is
    checked first; the filesystem is touched only for a plain local path that already lies inside as text."""
    if not isinstance(raw, str) or not raw:
        return None
    if _plain_absolute(raw):
        candidate = raw
    elif _relative_ok(raw):
        candidate = os.path.normpath(os.path.join(workspace, raw))
        if not _plain_absolute(candidate):
            return None
    else:
        return None
    real_ws = os.path.realpath(workspace)
    if not (_within(candidate, workspace) or _within(candidate, real_ws)):
        return None
    real = os.path.realpath(candidate)
    if not _plain_absolute(real) or not _within(real, real_ws):
        return None  # a link, junction or short name inside the workspace that leads somewhere else
    return real


def _touches_config(real: str, workspace: str) -> bool:
    real_ws = os.path.realpath(workspace)
    rest = _key(real)[len(_key(real_ws).rstrip("\\/")):]
    return any(part.casefold() in CONFIG_NAMES for part in re.split(r"[\\/]+", rest) if part)


def decide(tool: object, tool_input: object, workspace: str, allowed: tuple[str, ...]) -> tuple[bool, str]:
    """(allowed, reason). The reason never contains the path or other input."""
    if not _plain_absolute(workspace):
        return False, "The orders folder is not a plain local folder."
    if not isinstance(tool, str) or tool not in allowed or tool not in KNOWN_TOOLS:
        return False, "This tool is not available to order agents."
    inp = tool_input if isinstance(tool_input, dict) else None
    if inp is None:
        return False, "The tool call could not be checked."
    if tool in ("Read", "Edit", "Write"):
        real = resolve_inside(inp.get("file_path"), workspace)
        if real is None:
            return False, "Order agents may only use files inside their orders folder."
        if tool in WRITE_TOOLS and _touches_config(real, workspace):
            return False, "Order agents may not create or change Claude Code configuration."
        return True, ""
    # Glob and Grep
    if inp.get("path") not in (None, ""):
        if resolve_inside(inp.get("path"), workspace) is None:
            return False, "Order agents may only search inside their orders folder."
    pattern_key = "pattern" if tool == "Glob" else "glob"
    pattern = inp.get(pattern_key)
    if tool == "Glob" and not _relative_ok(pattern):
        return False, "Search patterns must be relative to the orders folder."
    if tool == "Grep" and pattern not in (None, "") and not _relative_ok(pattern):
        return False, "Search patterns must be relative to the orders folder."
    return True, ""


def main(argv: list[str]) -> int:
    try:
        workspace = argv[1]
        allowed = tuple(t for t in argv[2].split("+") if t) if len(argv) > 2 else ()
        data = sys.stdin.buffer.read(MAX_STDIN + 1).decode("utf-8")  # Claude Code sends UTF-8 whatever the locale
        if len(data) > MAX_STDIN:
            ok, reason = False, "The tool call was too large to check."
        else:
            payload = json.loads(data)
            if not isinstance(payload, dict):
                ok, reason = False, "The tool call could not be checked."
            else:
                ok, reason = decide(payload.get("tool_name"), payload.get("tool_input"), workspace, allowed)
    except BaseException:  # noqa: BLE001 - any failure refuses the call; nothing about the input is printed
        ok, reason = False, "The order guard could not check this tool call."
    if ok:
        return 0
    try:
        sys.stderr.write(reason + "\n")
    except Exception:
        pass
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))

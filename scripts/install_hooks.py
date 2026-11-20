"""Install / uninstall the Imperial Base Claude Code hook in ~/.claude/settings.json (or, when CLAUDE_CONFIG_DIR is
set, in settings.json inside that folder, which is where Claude Code then reads its user settings).

* The hook script is copied to ``~/.imperial-base/hooks/imperial-hook.js`` and that copy is what Claude Code runs.
  The copy lives outside the Imperial Base checkout, so nothing that can edit the checkout (an order agent, for
  instance) can change the code every Claude Code session runs. Re-run the installer after updating the base.
* Earlier installs that pointed at the checkout are moved to the copy.
* Additive: hooks from other tools are left untouched.
* Idempotent: running twice does not duplicate entries.
* Always writes a timestamped backup before changing settings.json.

    python scripts/install_hooks.py              # install, or refresh the copy
    python scripts/install_hooks.py --status
    python scripts/install_hooks.py --uninstall
    python scripts/install_hooks.py --help
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import time
from pathlib import Path

EVENTS = [
    "SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure",
    "SubagentStart", "SubagentStop", "Stop", "StopFailure", "Notification",
]
SOURCE = Path(__file__).resolve().parents[1] / "hooks" / "imperial-hook.js"
MARK = "imperial-hook.js"


def settings_path() -> Path:
    """The user settings file Claude Code reads: in CLAUDE_CONFIG_DIR when that is set, else ~/.claude."""
    value = os.environ.get("CLAUDE_CONFIG_DIR")
    if value:
        p = Path(value)
        if not p.is_absolute():
            print("CLAUDE_CONFIG_DIR is not an absolute path; nothing was changed.", file=sys.stderr)
            sys.exit(2)
        return p / "settings.json"
    return Path.home() / ".claude" / "settings.json"


def installed_hook() -> Path:
    base = Path(os.environ["IMPERIAL_BASE_DIR"]) if os.environ.get("IMPERIAL_BASE_DIR") else Path.home() / ".imperial-base"
    return base / "hooks" / "imperial-hook.js"


def command() -> str:
    return f'node "{installed_hook().as_posix()}"'


def load() -> dict:
    s = settings_path()
    if not s.exists():
        return {}
    return json.loads(s.read_text(encoding="utf-8"))


def save(data: dict) -> None:
    s = settings_path()
    s.parent.mkdir(parents=True, exist_ok=True)
    if s.exists():
        bak = s.with_name(f"settings.json.bak-imperial-{time.strftime('%Y%m%d-%H%M%S')}")
        shutil.copy2(s, bak)
        print(f"backup: {bak}")
    tmp = s.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    json.loads(tmp.read_text(encoding="utf-8"))  # validate before replacing
    tmp.replace(s)


def _digest(p: Path) -> str | None:
    return hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None


def copy_hook() -> bool:
    """Copy the hook out of the checkout. Returns True if the copy changed."""
    dest = installed_hook()
    if _digest(dest) == _digest(SOURCE):
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".js.tmp")
    shutil.copyfile(SOURCE, tmp)
    tmp.replace(dest)
    return True


def _entries(data: dict):
    for ev, groups in (data.get("hooks") or {}).items():
        for g in groups or []:
            for h in g.get("hooks", []):
                if MARK in (h.get("command") or ""):
                    yield ev, h


def installed_events(data: dict) -> list[str]:
    return sorted({ev for ev, _ in _entries(data)})


def install() -> None:
    changed_copy = copy_hook()
    print(f"hook copy: {installed_hook()}" + (" (updated)" if changed_copy else " (up to date)"))
    data = load()
    hooks = data.setdefault("hooks", {})
    cmd = command()
    moved = 0
    for _, h in _entries(data):
        if h.get("command") != cmd:  # an older install pointing into the checkout
            h["command"] = cmd
            moved += 1
    have = set(installed_events(data))
    added = []
    for ev in EVENTS:
        if ev in have:
            continue
        hooks.setdefault(ev, []).append({"hooks": [{"type": "command", "command": cmd, "timeout": 5}]})
        added.append(ev)
    if not added and not moved:
        print("Imperial Base hook already installed for all events.")
        return
    save(data)
    if moved:
        print(f"moved {moved} existing entries to the hook copy")
    if added:
        print(f"installed for: {', '.join(added)}")
    print("New Claude Code sessions will report to Imperial Base (running sessions pick it up on restart).")


def uninstall() -> None:
    data = load()
    hooks = data.get("hooks") or {}
    removed = 0
    for ev in list(hooks):
        keep = []
        for g in hooks[ev] or []:
            if any(MARK in (h.get("command") or "") for h in g.get("hooks", [])):
                removed += 1
                continue
            keep.append(g)
        if keep:
            hooks[ev] = keep
        else:
            del hooks[ev]
    if removed:
        save(data)
    print(f"removed {removed} Imperial Base hook entries.")


def status() -> None:
    data = load()
    ev = installed_events(data)
    cmds = {h.get("command") for _, h in _entries(data)}
    print(f"settings: {settings_path()}")
    print("installed for: " + (", ".join(ev) if ev else "(none)"))
    if ev:
        if cmds == {command()}:
            fresh = _digest(installed_hook()) == _digest(SOURCE)
            print(f"runs: {installed_hook()}" + ("" if fresh else "  (older than the checkout: re-run the installer)"))
        else:
            print("runs: an older location - re-run the installer to move it to the hook copy")


USAGE = __doc__.strip().splitlines()[-4:]

if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) > 1:
        print("one option at a time; nothing was changed.\n" + "\n".join(USAGE), file=sys.stderr)
        sys.exit(2)
    arg = args[0] if args else ""
    if arg not in ("--help", "-h", "--status", "--uninstall", ""):
        print(f"unknown option {arg!r}; nothing was changed.\n" + "\n".join(USAGE), file=sys.stderr)
        sys.exit(2)
    if arg not in ("--help", "-h"):
        settings_path()  # a relative CLAUDE_CONFIG_DIR stops here, before the hook copy or anything else is written
    if arg in ("--help", "-h"):
        print(__doc__.strip())
    elif arg == "--status":
        status()
    elif arg == "--uninstall":
        uninstall()
    elif arg == "":
        install()
    else:
        print(f"unknown option {arg!r}; nothing was changed.\n" + "\n".join(USAGE), file=sys.stderr)
        sys.exit(2)

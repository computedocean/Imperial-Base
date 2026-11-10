"""Install / uninstall the Imperial Base Claude Code hook in ~/.claude/settings.json.

* Additive: existing hooks (Agent HQ, Orca, OpenLIT, ...) are left untouched.
* Idempotent: running twice does not duplicate entries.
* Always writes a timestamped backup before changing anything.

    python scripts/install_hooks.py            # install
    python scripts/install_hooks.py --uninstall
    python scripts/install_hooks.py --status
"""
from __future__ import annotations

import json
import shutil
import sys
import time
from pathlib import Path

EVENTS = [
    "SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure",
    "SubagentStart", "SubagentStop", "Stop", "StopFailure", "Notification",
]
HOOK = (Path(__file__).resolve().parents[1] / "hooks" / "imperial-hook.js").as_posix()
COMMAND = f'node "{HOOK}"'
MARK = "imperial-hook.js"
SETTINGS = Path.home() / ".claude" / "settings.json"


def load() -> dict:
    if not SETTINGS.exists():
        return {}
    return json.loads(SETTINGS.read_text(encoding="utf-8"))


def save(data: dict) -> None:
    if SETTINGS.exists():
        bak = SETTINGS.with_name(f"settings.json.bak-imperial-{time.strftime('%Y%m%d-%H%M%S')}")
        shutil.copy2(SETTINGS, bak)
        print(f"backup: {bak}")
    tmp = SETTINGS.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    json.loads(tmp.read_text(encoding="utf-8"))  # validate before replacing
    tmp.replace(SETTINGS)


def installed_events(data: dict) -> list[str]:
    out = []
    for ev, groups in (data.get("hooks") or {}).items():
        for g in groups or []:
            if any(MARK in (h.get("command") or "") for h in g.get("hooks", [])):
                out.append(ev)
    return out


def install() -> None:
    data = load()
    hooks = data.setdefault("hooks", {})
    have = set(installed_events(data))
    added = []
    for ev in EVENTS:
        if ev in have:
            continue
        hooks.setdefault(ev, []).append({"hooks": [{"type": "command", "command": COMMAND, "timeout": 5}]})
        added.append(ev)
    if not added:
        print("Imperial Base hook already installed for all events.")
        return
    save(data)
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


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    if arg == "--uninstall":
        uninstall()
    elif arg == "--status":
        ev = installed_events(load())
        print("installed for: " + (", ".join(ev) if ev else "(none)"))
    else:
        install()

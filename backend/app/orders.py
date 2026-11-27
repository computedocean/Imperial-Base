"""Orders: the Commander gives work to agents from a chat in the base.

Each order is one Claude Code conversation, run headless with the installed ``claude`` CLI in a single
fixed workspace folder. The base's own hooks report what the agent does, so it appears in the
world like any other agent; this module only carries the conversation itself.

Safety layers, all deliberate (acceptEdits is not a sandbox, so it is not the only one). Each layer depends on
Claude Code enforcing it; none is an operating-system sandbox:
  * off unless IMPERIAL_ORDERS=1;
  * one working folder, fixed in config - the chat cannot choose another - and it may not overlap the base's
    checkout, the hook copy, the spool, the database, the Claude Code configuration folder or ~/.claude.json;
    a folder holding Claude Code project configuration (CLAUDE.md, CLAUDE.local.md, .claude, .mcp.json, in any
    letter case) is refused too. Both checks run when status is asked for and again right before a process starts;
  * ``--tools`` names the only built-in tools the agent gets: Edit and Write (ORDER_TOOLS), plus Read, Glob and
    Grep only when IMPERIAL_ORDERS_READ=1 (ORDER_TOOLS_WITH_READ). No shell, no background commands, no web access,
    no subagents, no skills. ``--strict-mcp-config`` loads no MCP servers and ``--disallowedTools mcp__*`` removes
    any MCP tool that still appears;
  * permission mode ``acceptEdits``: file edits inside the working folder go through without asking;
  * --settings (a new file per launch, removed when the agent ends) installs the workspace guard (orders_guard.py)
    as a PreToolUse hook: every path must resolve inside the working folder, compared case-insensitively on
    Windows after following links and junctions; anything else is refused. It also adds deny rules: no reading or
    editing the protected paths above, no editing Claude Code configuration inside the working folder, and the
    dangerous tools denied by name as a second layer behind ``--tools``;
  * ``--setting-sources user``: the working folder's own project and local settings are not loaded. The
    Commander's user settings and any managed settings still are, so the base reads them first and keeps orders
    off if one could widen file access or switch the guard off (allow rules for file tools, additionalDirectories,
    disableAllHooks, allowManagedHooksOnly, bypassPermissions, an unreadable file or an unrecognised setting);
  * the conversation (order text, replies) lives in memory only - it is not written to the database,
    in keeping with the rest of the backend, which stores no prompts or commands.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path, PurePath
from typing import Any, Awaitable, Callable, Iterator, Protocol

from .pathsafe import plain_local_absolute

MAX_TEXT = 8000  # characters accepted per order or follow-up
MAX_MESSAGES = 400  # per conversation, oldest dropped first
MAX_ORDERS = 30  # conversations kept, oldest finished ones dropped first
MAX_RUNNING = 4  # agents at work at once


class OrderError(Exception):
    """A request the manager refuses (bad input, busy, unknown order). ``status`` is the HTTP code."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


@dataclass
class Order:
    id: str
    session_id: str
    title: str
    status: str = "running"  # running | idle | failed | stopped
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    messages: list[dict[str, Any]] = field(default_factory=list)
    turns: int = 0

    @property
    def agent_key(self) -> str:
        return f"session:{self.session_id}"

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id, "session_id": self.session_id, "agent_id": self.agent_key, "title": self.title,
            "status": self.status, "created_at": self.created_at, "updated_at": self.updated_at,
            "turns": self.turns, "messages": self.messages,
        }


class Run(Protocol):
    """One turn of an agent: yields the CLI's stream-json records, and can be stopped."""

    def records(self) -> Iterator[dict[str, Any]]: ...
    def stop(self) -> None: ...


Runner = Callable[[str, str, bool, Path], Run]


# ---------------------------------------------------------------------------- the real runner

def _inside(path: Path, folder: Path) -> bool:
    return path == folder or folder in path.parents


def find_claude(work_dir: Path | None = None) -> str | None:
    """Absolute path of the ``claude`` CLI, or None.

    Only absolute folders on PATH are searched. The server's current folder and the order agents' working
    folder are never searched, and a match inside either is refused: an order agent may create files there,
    and Windows would otherwise run a planted ``claude.cmd`` from the current folder before the real one.
    """
    blocked = [Path.cwd().resolve()] + ([Path(work_dir).resolve()] if work_dir else [])
    if sys.platform == "win32":
        exts = [e for e in os.environ.get("PATHEXT", ".COM;.EXE;.BAT;.CMD").lower().split(";") if e]
    else:
        exts = [""]
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        if not entry or not os.path.isabs(entry):
            continue
        folder = Path(entry).resolve()
        if any(_inside(folder, b) for b in blocked):
            continue
        for ext in exts:
            candidate = folder / f"claude{ext}"
            if candidate.is_file() and (sys.platform == "win32" or os.access(candidate, os.X_OK)):
                real = candidate.resolve()
                if not any(_inside(real, b) for b in blocked):
                    return str(real)
    return None


def workspace_problem(cwd: Path, protected: list[Path]) -> str | None:
    """Why ``cwd`` may not be the agents' working folder, or None. It must be a plain local folder that neither
    sits inside nor contains anything protected (the base's checkout, the hook copy, the spool, the database, the
    Claude Code configuration folder, ~/.claude.json): acceptEdits approves every edit inside the working folder,
    so the folder itself is the boundary. It may not hold Claude Code project configuration either."""
    s = str(cwd)
    if not plain_local_absolute(s):
        return "The orders folder must be a plain local folder (IMPERIAL_ORDERS_CWD)."
    for p in protected:
        if not p.is_absolute():
            # e.g. a relative CLAUDE_CONFIG_DIR: the agent would resolve it against its own working folder, so
            # the folder it protects and the folder it uses could differ
            return (f"{p} is not an absolute path, so the base cannot tell what order agents would use. "
                    "Set it (for example CLAUDE_CONFIG_DIR) to an absolute path.")
    real = cwd.resolve()
    for p in protected:
        pr = p.resolve()
        if _inside(real, pr) or _inside(pr, real):
            return (f"The orders folder ({cwd}) overlaps {p}. Agents must work outside the Imperial Base code, "
                    "hooks and data and outside the Claude Code configuration; set IMPERIAL_ORDERS_CWD to a "
                    "separate folder.")
    found = workspace_config_found(real)
    if found:
        return (f"The orders folder contains Claude Code project configuration ({', '.join(found)}). It could "
                "change what an order agent does (instructions, agents, commands, skills, settings, hooks, MCP "
                "servers). Check and remove it before turning orders back on.")
    return None


# Project configuration Claude Code may pick up from its working folder: instructions (CLAUDE.md,
# CLAUDE.local.md), the .claude folder (settings and their hooks, agents, commands, skills, rules) and MCP servers
# (.mcp.json). Names are compared case-insensitively: Windows file names are, so "claude.md" is the same file.
WORKSPACE_CONFIG_NAMES = ("CLAUDE.md", "CLAUDE.local.md", ".claude", ".mcp.json")
_WORKSPACE_CONFIG_KEYS = {n.casefold() for n in WORKSPACE_CONFIG_NAMES}


def workspace_config_found(folder: Path) -> list[str]:
    """Names of Claude Code project configuration entries directly inside ``folder`` (any letter case). An empty
    .claude folder is ignored; anything else, including a file or link with one of these names, counts. A folder
    that does not exist yet has none. Only the top level is checked: Claude Code loads these at start-up, while
    CLAUDE.md files in subfolders are read only when the agent works there (deny rules stop agents writing them)."""
    found: list[str] = []
    try:
        entries = sorted(os.scandir(folder), key=lambda e: e.name)
    except FileNotFoundError:
        return found
    except OSError:
        return ["(the folder could not be listed)"]
    for entry in entries:
        if entry.name.casefold() not in _WORKSPACE_CONFIG_KEYS:
            continue
        if entry.name.casefold() == ".claude" and entry.is_dir(follow_symlinks=False):
            try:
                inside = sorted(os.listdir(entry.path))
            except OSError:
                inside = ["?"]
            if not inside:
                continue
            found.append(f"{entry.name}/ ({', '.join(inside[:5])}{', ...' if len(inside) > 5 else ''})")
        else:
            found.append(entry.name)
    return found


# Edit rules for the working folder: no planting instructions, settings, hooks, agents, commands, skills or MCP
# servers, at the top level or in subfolders. Both the top-level and the "**/" forms are written so that coverage
# does not depend on whether "**/" also matches zero folders.
WORKSPACE_CONFIG_DENY = (
    "CLAUDE.md", "**/CLAUDE.md", "CLAUDE.local.md", "**/CLAUDE.local.md",
    ".claude", ".claude/**", "**/.claude", "**/.claude/**", ".mcp.json", "**/.mcp.json",
)


def rule_path_text(p: PurePath) -> str:
    """A Claude Code permission-rule path for an absolute path that is already resolved. Claude Code compares
    Windows paths in POSIX form (``C:\\Users\\a`` is matched as ``/c/Users/a``) and ``//`` anchors a rule at the
    filesystem root, so ``C:\\Projects\\X`` -> ``//c/Projects/X`` and ``/home/a`` -> ``//home/a``. The drive letter
    is lower-cased; the rest keeps its case. Pure text: touches no filesystem."""
    s = p.as_posix()
    if len(s) > 1 and s[1] == ":":
        s = s[0].lower() + s[2:]
    return "//" + s.lstrip("/")


def _rule_path(p: Path) -> str:
    return rule_path_text(p.resolve())


# The built-in tools an order agent gets (--tools). By default only Edit and Write: Claude Code's acceptEdits
# mode approves edits inside the working folder only, and refuses the rest in a headless run, so writing is held to
# the folder by the CLI itself as well as by the guard below. Read, Glob and Grep come only with IMPERIAL_ORDERS_READ=1:
# whether Claude Code asks before reading outside the working folder is not something the base can rely on, so
# their containment rests on the PreToolUse guard, and Claude Code lets a call through when a hook cannot be run
# at all (a missing interpreter, say). The base does not claim a guarantee it cannot make, so reading is opt-in.
# Left out always: every tool that runs commands or code (Bash, PowerShell, Monitor, Workflow, LSP), reaches the
# network (WebFetch, WebSearch and the messaging/notification tools), delegates (Agent, Skill), schedules work
# (Cron*, RemoteTrigger) or loads further tools (ToolSearch); also NotebookEdit and TodoWrite.
ORDER_TOOLS = ("Edit", "Write")
ORDER_TOOLS_WITH_READ = ("Read", "Edit", "Write", "Glob", "Grep")
READ_TOOLS = ("Read", "Glob", "Grep")

# Denied by name in --settings as a second layer behind --tools, so that a shell or web tool stays refused even
# if a future CLI version or a user setting made one available again. Deny rules beat allow rules everywhere.
DENIED_TOOL_NAMES = ("Bash", "PowerShell", "Monitor", "WebFetch", "WebSearch", "Agent", "Skill", "Workflow")

# Removes every MCP tool from the agent's context (documented form of --disallowedTools), behind
# --strict-mcp-config, which already loads no MCP servers.
DISALLOWED_TOOLS = "mcp__*"

GUARD_SCRIPT = Path(__file__).resolve().with_name("orders_guard.py")
# The guard's hook command is an absolute interpreter path (never a bare "python", which a shell could look up in the
# agent's own folder) followed by plain arguments. It is written with forward slashes and no quotes, which a POSIX
# shell such as Git Bash (what Claude Code uses for shell commands on Windows) and PowerShell both run as written.
# A path with spaces or shell characters would need quoting, so it makes orders unavailable instead. If Claude Code
# ever ran hooks through a shell that cannot run this command, the guard would not run: see the residual risks.
_SAFE_COMMAND_PATH = re.compile(r"[A-Za-z0-9_.:/\-]+")


def guard_command(workspace: Path, tools: tuple[str, ...], python: str | None = None) -> str | None:
    """The PreToolUse hook command that runs orders_guard.py for ``workspace``, or None if it cannot be written
    safely (an interpreter or path that would need quoting, or a file that is missing)."""
    exe = Path(python or sys.executable)
    if not exe.is_absolute() or not exe.is_file() or not GUARD_SCRIPT.is_file():
        return None
    texts = [exe.as_posix(), GUARD_SCRIPT.as_posix(), workspace.resolve().as_posix()]
    if not all(_SAFE_COMMAND_PATH.fullmatch(t) for t in texts) or not all(t.isalpha() for t in tools):
        return None
    texts.append("+".join(tools))  # "+" needs no quoting in bash, cmd or PowerShell (a comma does in PowerShell)
    if not tools:
        return None
    return f"{texts[0]} -I -B {texts[1]} {texts[2]} {texts[3]}"


def agent_settings(protected: list[Path], workspace: Path | None = None, guard: str | None = None,
                   read_access: bool = False) -> dict[str, Any]:
    """Settings handed to every order agent with --settings.

    * ``hooks``: the workspace guard (orders_guard.py) runs before every tool call and refuses any path outside the
      workspace, case-insensitively and after following links. Hook refusals and deny rules both win over allow
      rules from any settings file. ``disableAllHooks`` is set false so the guard cannot be switched off by
      precedence; settings that could still switch it off make orders unavailable (see settings_problem).
    * ``permissions.deny``: every protected path gets Read and Edit rules in two forms, the exact path and ``/**``
      beneath it; the dangerous tools are denied by name; without read access Read, Glob and Grep are too. Claude
      Code matches these rules as text and may not fold letter case, so they are a second layer behind the guard,
      which does. (Edit rules also cover Write and NotebookEdit.)"""
    deny: list[str] = list(DENIED_TOOL_NAMES)
    if not read_access:
        deny += list(READ_TOOLS)
    for p in protected:
        rule = _rule_path(p)
        for tool in ("Read", "Edit"):
            deny += [f"{tool}({rule})", f"{tool}({rule}/**)"]
    if workspace is not None:
        ws = _rule_path(workspace)
        deny += [f"Edit({ws}/{name})" for name in WORKSPACE_CONFIG_DENY]
    out: dict[str, Any] = {"permissions": {"deny": deny}}
    if guard is not None:
        out["disableAllHooks"] = False
        out["hooks"] = {"PreToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": guard,
                                                                     "timeout": 30}]}]}
    return out


def cli_args(exe: str, session_id: str, resume: bool, settings_file: Path | None,
             tools: tuple[str, ...] = ORDER_TOOLS) -> list[str]:
    args = [exe, "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits",
            "--tools", ",".join(tools),  # the complete set of built-in tools; nothing else exists for it
            "--disallowedTools", DISALLOWED_TOOLS,  # no MCP tools
            "--strict-mcp-config",  # no MCP servers: their tools are not bound by the working folder either
            "--setting-sources", "user"]  # the Commander's settings (and hooks) only; not the workspace's own
    if settings_file is not None:
        args += ["--settings", str(settings_file)]
    args += ["--resume", session_id] if resume else ["--session-id", session_id]
    return args


# ---------------------------------------------------------------------------- the Commander's settings (H1)
#
# Order agents load the Commander's user settings (--setting-sources user), and managed (policy) settings apply to
# every session. Some settings would widen what an agent can touch or switch the guard off, so the base reads them
# first and keeps orders off if any could. Only these reason codes leave this module; settings contents never do.

FILE_TOOL_NAMES = {"read", "edit", "write", "glob", "grep", "multiedit", "notebookedit", "notebookread", "ls"}
_KNOWN_PERMISSION_KEYS = {"allow", "deny", "ask", "defaultMode", "additionalDirectories", "disableBypassPermissionsMode"}
# Top-level settings that cannot widen file access for an order agent (or are checked below). Anything not listed
# here makes orders unavailable: the base cannot tell what an unknown setting does, so it does not guess.
_KNOWN_SETTINGS = {
    "$schema", "permissions", "hooks", "disableAllHooks", "allowManagedHooksOnly", "enabledPlugins",
    "extraKnownMarketplaces", "model", "theme", "statusLine", "outputStyle", "env", "includeCoAuthoredBy",
    "attribution", "cleanupPeriodDays", "alwaysThinkingEnabled", "spinnerTipsEnabled", "spinnerVerbs",
    "feedbackSurveyState", "autoUpdates", "autoUpdatesChannel", "verbose", "apiKeyHelper", "awsAuthRefresh",
    "awsCredentialExport", "otelHeadersHelper", "forceLoginMethod", "forceLoginOrgUUID", "language", "effortLevel",
    "companyAnnouncements", "respectGitignore", "enableAllProjectMcpServers", "enabledMcpjsonServers",
    "disabledMcpjsonServers", "allowedMcpServers", "deniedMcpServers", "sandbox", "skipWebFetchPreflight",
    "voiceEnabled", "showTurnDuration", "terminalProgressBarEnabled", "promptSuggestionEnabled", "plansDirectory",
    "fileSuggestion", "skipDangerousModePermissionPrompt", "editorMode", "preferredNotifChannel", "autoCompactEnabled",
}

SETTINGS_REASONS = {
    "settings_unreadable": "Your Claude Code settings could not be read, so the base cannot check them.",
    "settings_invalid": "Your Claude Code settings are not valid JSON settings, so the base cannot check them.",
    "allow_rule_file_tool": "Your Claude Code settings allow file tools by rule (Read, Edit, Write, Glob or Grep), "
                            "which could let an order agent work outside its folder.",
    "additional_directories": "Your Claude Code settings add working directories (additionalDirectories), where "
                              "order agents' edits would be approved too.",
    "bypass_default_mode": "Your Claude Code settings make bypassPermissions the default mode.",
    "hooks_disabled": "Your Claude Code settings switch hooks off (disableAllHooks), which would switch off the "
                      "orders guard.",
    "managed_hooks_only": "Managed settings allow only managed hooks (allowManagedHooksOnly), which would switch "
                          "off the orders guard.",
    "unknown_permission_key": "Your Claude Code settings contain a permissions entry the base does not recognise.",
    "unknown_setting": "Your Claude Code settings contain a setting the base does not recognise, so it cannot "
                       "tell whether order agents would stay inside their folder.",
}


def _rule_tool(rule: str) -> str:
    return rule.split("(", 1)[0].strip()


def inspect_settings(data: Any) -> str | None:
    """A reason code if these settings could widen an order agent's file access or switch the guard off, else None.
    Deny and ask rules only narrow access and are accepted; so are hooks (the Commander's own, which already run in
    every session, and which an agent cannot change: the config folder is protected)."""
    if not isinstance(data, dict):
        return "settings_invalid"
    for key in data:
        if key not in _KNOWN_SETTINGS:
            return "unknown_setting"
    if data.get("disableAllHooks") not in (None, False):
        return "hooks_disabled"
    if data.get("allowManagedHooksOnly") not in (None, False):
        return "managed_hooks_only"
    perms = data.get("permissions", {})
    if not isinstance(perms, dict):
        return "settings_invalid"
    for key in perms:
        if key not in _KNOWN_PERMISSION_KEYS:
            return "unknown_permission_key"
    for key in ("allow", "deny", "ask", "additionalDirectories"):
        value = perms.get(key, [])
        if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
            return "settings_invalid"
    for rule in perms.get("allow", []):
        tool = _rule_tool(rule)
        if tool.startswith("mcp__"):
            continue  # no MCP servers are loaded, MCP tools are removed, and the guard refuses any other tool
        if tool.casefold() in FILE_TOOL_NAMES or "*" in tool or not tool:
            return "allow_rule_file_tool"
    if perms.get("additionalDirectories"):
        return "additional_directories"
    if perms.get("defaultMode") == "bypassPermissions":
        return "bypass_default_mode"
    return None


def settings_problem(user_file: Path, managed_files: list[Path]) -> str | None:
    """Inspect the user settings file and any managed settings files; a reason code, or None when all are safe.
    A missing file is fine; one that exists but cannot be read or parsed is not."""
    for path in [user_file, *managed_files]:
        try:
            text = path.read_text(encoding="utf-8-sig")
        except FileNotFoundError:
            continue
        except (OSError, UnicodeDecodeError):
            return "settings_unreadable"
        try:
            data = json.loads(text)
        except ValueError:
            return "settings_invalid"
        code = inspect_settings(data)
        if code is not None:
            return code
    return None


def _current_settings_problem() -> str | None:
    from . import config  # read at call time: CLAUDE_CONFIG_DIR may change between checks

    return settings_problem(config.user_settings_file(), config.managed_settings_files())


def write_launch_settings(directory: Path, settings: dict[str, Any]) -> Path:
    """Create a new settings file with a unique name for one agent launch: created exclusively (O_EXCL), readable
    by this user only where the system supports it, never shared with another launch."""
    directory.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(directory, 0o700)
    except OSError:
        pass
    fd, name = tempfile.mkstemp(prefix="orders-", suffix=".json", dir=str(directory))
    path = Path(name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(settings, fh, indent=2)
    except BaseException:
        _remove_quietly(path)
        raise
    return path


def _remove_quietly(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        pass
    except OSError:
        pass


class CliRun:
    """``claude -p`` as a child process. The prompt goes in on stdin, so no shell quoting is involved.

    Each launch gets its own settings file, removed once the process has ended (normally, by failure or after
    stop()) and never before: Claude Code may read its settings again while it runs."""

    def __init__(self, prompt: str, session_id: str, resume: bool, cwd: Path,
                 protected: list[Path] | None = None, settings_dir: Path | None = None,
                 read_access: bool = False):
        exe = find_claude(cwd)
        if not exe:
            raise OrderError("The claude command was not found on this machine.", 503)
        problem = workspace_problem(cwd, protected or [])
        if problem is not None:  # checked again here, right before anything is started
            raise OrderError(problem, 503)
        code = _current_settings_problem()
        if code is not None:
            raise OrderError(SETTINGS_REASONS[code], 503)
        tools = ORDER_TOOLS_WITH_READ if read_access else ORDER_TOOLS
        guard = guard_command(cwd, tools)
        if guard is None:
            raise OrderError(GUARD_UNAVAILABLE, 503)
        if settings_dir is None:
            raise OrderError("Orders have no settings folder configured.", 503)
        self.settings_path: Path | None = write_launch_settings(
            settings_dir, agent_settings(protected or [], cwd, guard=guard, read_access=read_access))
        self._cleanup_lock = threading.Lock()
        args = cli_args(exe, session_id, resume, self.settings_path, tools)
        flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0  # type: ignore[attr-defined]
        try:
            self.proc = subprocess.Popen(
                args, cwd=str(cwd), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True, encoding="utf-8", errors="replace", creationflags=flags,
            )
        except BaseException:
            self._cleanup(force=True)
            raise
        self._stderr: list[str] = []
        threading.Thread(target=self._drain_stderr, daemon=True).start()
        assert self.proc.stdin is not None
        try:
            self.proc.stdin.write(prompt)
            self.proc.stdin.close()
        except OSError:
            pass

    def _cleanup(self, force: bool = False) -> None:
        """Remove this launch's settings file once its process has ended (``force``: it never started)."""
        with self._cleanup_lock:
            if self.settings_path is None:
                return
            if not force and self.proc.poll() is None:
                return
            _remove_quietly(self.settings_path)
            self.settings_path = None

    def _drain_stderr(self) -> None:
        assert self.proc.stderr is not None
        for line in self.proc.stderr:
            if len(self._stderr) < 40:
                self._stderr.append(line.rstrip())

    def records(self) -> Iterator[dict[str, Any]]:
        assert self.proc.stdout is not None
        try:
            for line in self.proc.stdout:
                line = line.strip()
                if not line.startswith("{"):
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                if isinstance(rec, dict):
                    yield rec
            code = self.proc.wait()
            if code != 0:
                tail = " ".join(self._stderr[-3:])[:400]
                yield {"type": "exit", "code": code, "stderr": tail}
        finally:
            self._cleanup()

    def stop(self) -> None:
        if self.proc.poll() is None:
            if sys.platform == "win32":
                # the CLI runs its work in child processes; end the whole tree
                subprocess.run(["taskkill", "/PID", str(self.proc.pid), "/T", "/F"], capture_output=True)
            else:
                self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                return  # still running: records() removes the file once it has ended
        self._cleanup()


GUARD_UNAVAILABLE = ("The orders guard cannot be installed: the Python interpreter, the guard script or the orders "
                     "folder has a path with spaces or special characters (or is missing). Orders stay off.")


# ---------------------------------------------------------------------------- record -> chat messages

def _short(text: Any, n: int = 160) -> str:
    s = " ".join(str(text or "").split())
    return s if len(s) <= n else s[: n - 1] + "…"


def describe_tool(name: str, tool_input: Any) -> str:
    """A one-line, low-detail description of a tool call for the chat (file name or stated purpose only)."""
    inp = tool_input if isinstance(tool_input, dict) else {}
    if name in ("Read", "Edit", "Write", "MultiEdit", "NotebookEdit"):
        target = os.path.basename(str(inp.get("file_path") or inp.get("notebook_path") or ""))
        return f"{name} {target}".strip()
    if name in ("Bash", "PowerShell"):
        return f"{name}: {_short(inp.get('description') or 'command', 100)}"
    if name in ("Grep", "Glob"):
        return f"{name} {_short(inp.get('pattern'), 60)}".strip()
    if name in ("Agent", "Task"):
        return f"Delegate: {_short(inp.get('description'), 100)}"
    if name in ("WebFetch", "WebSearch"):
        return f"{name} {_short(inp.get('url') or inp.get('query'), 80)}".strip()
    return name


def messages_from(rec: dict[str, Any]) -> tuple[list[dict[str, str]], str | None]:
    """Turn one stream-json record into chat messages and, when the turn is over, the new status."""
    out: list[dict[str, str]] = []
    kind = rec.get("type")
    if kind == "assistant":
        content = (rec.get("message") or {}).get("content")
        for block in content if isinstance(content, list) else []:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text" and str(block.get("text") or "").strip():
                out.append({"role": "agent", "text": str(block["text"]).strip()[:12000]})
            elif block.get("type") == "tool_use":
                out.append({"role": "tool", "text": describe_tool(str(block.get("name") or "tool"), block.get("input"))})
        return out, None
    if kind == "result":
        denials = rec.get("permission_denials")
        seen: set[str] = set()
        for d in denials if isinstance(denials, list) else []:
            if not isinstance(d, dict):
                continue
            what = describe_tool(str(d.get("tool_name") or "tool"), d.get("tool_input"))
            if what not in seen:
                seen.add(what)
                out.append({"role": "notice", "text": f"Not allowed without your approval: {what}"})
        if rec.get("is_error"):
            reason = _short(rec.get("result") or str(rec.get("subtype") or "the run failed").replace("_", " "), 300)
            out.append({"role": "notice", "text": f"The agent stopped with an error: {reason}"})
            return out, "failed"
        return out, "idle"
    if kind == "exit":
        detail = f" {rec['stderr']}" if rec.get("stderr") else ""
        out.append({"role": "notice", "text": f"The agent process ended unexpectedly (code {rec.get('code')}).{detail}"})
        return out, "failed"
    return out, None


# ---------------------------------------------------------------------------- manager

Broadcast = Callable[[dict[str, Any]], Awaitable[None]]


class OrderManager:
    def __init__(self, cwd: Path, broadcast: Broadcast, runner: Runner | None = None, enabled: bool = False,
                 protected: list[Path] | None = None, settings_dir: Path | None = None, read_access: bool = False):
        self.cwd = cwd
        self.broadcast = broadcast
        self.protected = list(protected or [])
        self._real = runner is None
        self.settings_dir = settings_dir
        self.read_access = read_access
        self.runner: Runner = runner or (
            lambda p, s, r, c: CliRun(p, s, r, c, protected=self.protected, settings_dir=self.settings_dir,
                                      read_access=self.read_access))
        self.enabled = enabled
        self.orders: dict[str, Order] = {}
        self._runs: dict[str, Run] = {}
        self._tasks: set[asyncio.Task[None]] = set()

    @property
    def tools(self) -> tuple[str, ...]:
        return ORDER_TOOLS_WITH_READ if self.read_access else ORDER_TOOLS

    # -- queries
    def status(self) -> dict[str, Any]:
        reason = None
        if not self.enabled:
            reason = "Orders are switched off. Set IMPERIAL_ORDERS=1 before starting the base to turn them on."
        elif (problem := workspace_problem(self.cwd, self.protected)) is not None:
            reason = problem
        elif self._real:
            # the checks that concern the real CLI launch (a scripted runner in tests starts nothing)
            if find_claude(self.cwd) is None:
                reason = "The claude command was not found."
            elif (code := _current_settings_problem()) is not None:
                reason = SETTINGS_REASONS[code]
            elif guard_command(self.cwd, self.tools) is None:
                reason = GUARD_UNAVAILABLE
        ready = reason is None
        return {"enabled": ready, "reason": reason, "folder": self.cwd.name, "max_running": MAX_RUNNING,
                "permission_mode": "acceptEdits", "tools": list(self.tools), "read_access": self.read_access}

    def list(self) -> list[dict[str, Any]]:
        return [o.public() for o in sorted(self.orders.values(), key=lambda o: o.created_at)]

    # -- commands
    def _clean(self, text: Any) -> str:
        if not isinstance(text, str) or not text.strip():
            raise OrderError("An order needs some text.")
        if len(text) > MAX_TEXT:
            raise OrderError(f"That is too long ({len(text)} characters; the limit is {MAX_TEXT}).", 413)
        return text.strip()

    def _check_capacity(self) -> None:
        if not self.status()["enabled"]:
            raise OrderError(self.status()["reason"] or "Orders are unavailable.", 503)
        if sum(1 for o in self.orders.values() if o.status == "running") >= MAX_RUNNING:
            raise OrderError(f"{MAX_RUNNING} agents are already at work. Wait for one to finish or stop one.", 429)

    async def start(self, text: Any) -> Order:
        prompt = self._clean(text)
        self._check_capacity()
        order = Order(id=uuid.uuid4().hex[:12], session_id=str(uuid.uuid4()), title=_short(prompt, 70))
        self.orders[order.id] = order
        self._prune()
        await self._begin(order, prompt, resume=False)
        return order

    async def send(self, order_id: str, text: Any) -> Order:
        order = self._get(order_id)
        prompt = self._clean(text)
        if order.status == "running":
            raise OrderError("This agent is still working. Wait for it to finish, or stop it first.", 409)
        self._check_capacity()
        # a conversation that never completed a turn has nothing to resume: start a new one in its place
        if order.turns == 0:
            order.session_id = str(uuid.uuid4())
        await self._begin(order, prompt, resume=order.turns > 0)
        return order

    async def stop(self, order_id: str) -> Order:
        order = self._get(order_id)
        run = self._runs.get(order.id)
        if run is not None and order.status == "running":
            order.status = "stopped"
            await asyncio.to_thread(run.stop)
            self._add(order, "notice", "Stopped by the Commander.")
            await self._publish(order)
        return order

    async def shutdown(self) -> None:
        for run in list(self._runs.values()):
            await asyncio.to_thread(run.stop)

    # -- internals
    def _get(self, order_id: str) -> Order:
        order = self.orders.get(order_id)
        if order is None:
            raise OrderError("Unknown order.", 404)
        return order

    def _add(self, order: Order, role: str, text: str) -> None:
        order.messages.append({"role": role, "text": text, "ts": time.time()})
        del order.messages[:-MAX_MESSAGES]
        order.updated_at = time.time()

    def _prune(self) -> None:
        extra = len(self.orders) - MAX_ORDERS
        for o in sorted(self.orders.values(), key=lambda o: o.updated_at):
            if extra <= 0:
                break
            if o.status != "running":
                del self.orders[o.id]
                extra -= 1

    async def _publish(self, order: Order) -> None:
        await self.broadcast({"type": "order", "order": order.public()})

    async def _begin(self, order: Order, prompt: str, resume: bool) -> None:
        self._add(order, "commander", prompt)
        try:
            await asyncio.to_thread(self.cwd.mkdir, parents=True, exist_ok=True)
            run = await asyncio.to_thread(self.runner, prompt, order.session_id, resume, self.cwd)
        except OrderError as e:
            order.status = "failed"
            self._add(order, "notice", str(e))
            await self._publish(order)
            raise
        except OSError as e:
            order.status = "failed"
            self._add(order, "notice", f"Could not start the agent: {e}")
            await self._publish(order)
            raise OrderError(f"Could not start the agent: {e}", 500) from e
        order.status = "running"
        self._runs[order.id] = run
        await self._publish(order)
        task = asyncio.create_task(self._pump(order, run))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _pump(self, order: Order, run: Run) -> None:
        """Read the run's records on a worker thread and apply them on the event loop."""
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

        def reader() -> None:
            try:
                for rec in run.records():
                    loop.call_soon_threadsafe(queue.put_nowait, rec)
            except Exception as e:  # never leave the conversation hanging in "running"
                loop.call_soon_threadsafe(queue.put_nowait, {"type": "exit", "code": "reader", "stderr": type(e).__name__})
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)

        threading.Thread(target=reader, daemon=True).start()
        final: str | None = None
        while True:
            rec = await queue.get()
            if rec is None:
                break
            msgs, status = messages_from(rec)
            if order.status == "stopped":
                continue  # drain quietly: the Commander already ended this turn
            for m in msgs:
                self._add(order, m["role"], m["text"])
            if status and final is None:
                final = status  # the first verdict stands: a clean result is not undone by a later exit code
            if msgs:
                await self._publish(order)
        if self._runs.get(order.id) is run:
            del self._runs[order.id]
        if order.status == "running":
            order.status = final or "failed"
            if final is None:
                self._add(order, "notice", "The agent ended without a result.")
            if order.status == "idle":
                order.turns += 1
            order.updated_at = time.time()
            await self._publish(order)

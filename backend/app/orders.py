"""Orders: the Commander gives work to agents from a chat in the base.

Each order is one Claude Code conversation, run headless with the installed ``claude`` CLI in a single
fixed workspace folder. The base's own hooks report what the agent does, so it appears in the
world like any other agent; this module only carries the conversation itself.

Safety rules, all deliberate (acceptEdits is not a sandbox, so it is never the only one):
  * off unless IMPERIAL_ORDERS=1;
  * one working folder, fixed in config - the chat cannot choose another - and it may not overlap the base's
    checkout, the hook copy, the spool or the database (checked when asked for status and again right before
    a process starts);
  * permission mode ``acceptEdits``: file edits inside that folder go through; Bash and PowerShell are removed
    (on native Windows nothing confines what a shell writes), no MCP servers are loaded, and --settings adds deny
    rules for the base's files; anything else that is not already allowed in the Commander's Claude Code
    settings is refused by the CLI and reported back in the chat;
  * the conversation (order text, replies) lives in memory only - it is never written to the database,
    in keeping with the rest of the backend, which stores no prompts or commands.
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
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
    sits inside nor contains anything protected (the base's checkout, the hook copy, the spool, the database):
    acceptEdits approves every edit inside the working folder, so the folder itself is the boundary."""
    s = str(cwd)
    if not plain_local_absolute(s):
        return "The orders folder must be a plain local folder (IMPERIAL_ORDERS_CWD)."
    real = cwd.resolve()
    for p in protected:
        pr = p.resolve()
        if _inside(real, pr) or _inside(pr, real):
            return (f"The orders folder ({cwd}) overlaps {p}. Agents must work outside the Imperial Base code, "
                    "hooks and data; set IMPERIAL_ORDERS_CWD to a separate folder.")
    return None


def _rule_path(p: Path) -> str:
    """A Claude Code permission-rule path for an absolute local path: ``//`` + the path with forward slashes
    (``C:\\Projects\\X`` -> ``//c/Projects/X``)."""
    s = p.resolve().as_posix()
    if len(s) > 1 and s[1] == ":":
        s = s[0].lower() + s[2:]
    return "//" + s.lstrip("/")


def agent_settings(protected: list[Path]) -> dict[str, Any]:
    """Settings handed to every order agent with --settings. Deny rules win over allow rules from any settings
    file, so these hold even if the Commander's own settings allow more. They back up the working-folder
    boundary; they are not the only line of defence."""
    deny: list[str] = []
    for p in protected:
        rule = _rule_path(p)
        tail = "/**" if not p.suffix else ""
        deny.append(f"Edit({rule}{tail})")  # covers Write, MultiEdit and NotebookEdit too
        if p.suffix or p.name in ("spool", "hooks"):
            deny.append(f"Read({rule}{tail})")  # the event history and the hook copy are not for agents to read
    return {"permissions": {"deny": deny}}


# Tools removed from every order agent. On native Windows Claude Code cannot confine what a shell command
# writes (permission rules cover only its own file tools), so the shells go entirely.
DISALLOWED_TOOLS = "Bash,PowerShell"


def cli_args(exe: str, session_id: str, resume: bool, settings_file: Path | None) -> list[str]:
    args = [exe, "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits",
            "--disallowedTools", DISALLOWED_TOOLS,
            "--strict-mcp-config"]  # no MCP servers: their tools are not bound by the working folder either
    if settings_file is not None:
        args += ["--settings", str(settings_file)]
    args += ["--resume", session_id] if resume else ["--session-id", session_id]
    return args


class CliRun:
    """``claude -p`` as a child process. The prompt goes in on stdin, so no shell quoting is involved."""

    def __init__(self, prompt: str, session_id: str, resume: bool, cwd: Path,
                 protected: list[Path] | None = None, settings_file: Path | None = None):
        exe = find_claude(cwd)
        if not exe:
            raise OrderError("The claude command was not found on this machine.", 503)
        problem = workspace_problem(cwd, protected or [])
        if problem is not None:  # checked again here, right before anything is started
            raise OrderError(problem, 503)
        if settings_file is not None:
            settings_file.parent.mkdir(parents=True, exist_ok=True)
            tmp = settings_file.with_suffix(".tmp")
            tmp.write_text(json.dumps(agent_settings(protected or []), indent=2), encoding="utf-8")
            tmp.replace(settings_file)
        args = cli_args(exe, session_id, resume, settings_file)
        flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0  # type: ignore[attr-defined]
        self.proc = subprocess.Popen(
            args, cwd=str(cwd), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", errors="replace", creationflags=flags,
        )
        self._stderr: list[str] = []
        threading.Thread(target=self._drain_stderr, daemon=True).start()
        assert self.proc.stdin is not None
        try:
            self.proc.stdin.write(prompt)
            self.proc.stdin.close()
        except OSError:
            pass

    def _drain_stderr(self) -> None:
        assert self.proc.stderr is not None
        for line in self.proc.stderr:
            if len(self._stderr) < 40:
                self._stderr.append(line.rstrip())

    def records(self) -> Iterator[dict[str, Any]]:
        assert self.proc.stdout is not None
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

    def stop(self) -> None:
        if self.proc.poll() is not None:
            return
        if sys.platform == "win32":
            # the CLI runs its work in child processes; end the whole tree
            subprocess.run(["taskkill", "/PID", str(self.proc.pid), "/T", "/F"], capture_output=True)
        else:
            self.proc.terminate()


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
                 protected: list[Path] | None = None, settings_file: Path | None = None):
        self.cwd = cwd
        self.broadcast = broadcast
        self.protected = list(protected or [])
        self._real = runner is None
        self.settings_file = settings_file
        self.runner: Runner = runner or (
            lambda p, s, r, c: CliRun(p, s, r, c, protected=self.protected, settings_file=self.settings_file))
        self.enabled = enabled
        self.orders: dict[str, Order] = {}
        self._runs: dict[str, Run] = {}
        self._tasks: set[asyncio.Task[None]] = set()

    # -- queries
    def status(self) -> dict[str, Any]:
        reason = None
        if not self.enabled:
            reason = "Orders are switched off. Set IMPERIAL_ORDERS=1 before starting the base to turn them on."
        elif (problem := workspace_problem(self.cwd, self.protected)) is not None:
            reason = problem
        elif self._real and find_claude(self.cwd) is None:
            reason = "The claude command was not found."
        ready = reason is None
        return {"enabled": ready, "reason": reason, "folder": self.cwd.name, "max_running": MAX_RUNNING,
                "permission_mode": "acceptEdits"}

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
                loop.call_soon_threadsafe(queue.put_nowait, {"type": "exit", "code": "reader", "stderr": repr(e)[:200]})
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

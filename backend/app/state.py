"""Agent registry: a pure reducer from Claude Code hook events to agent/task state.

Every status shown in Imperial Base is derived from a recorded hook event. Nothing here
invents activity: if the last confirmed event is old, the agent is flagged ``stale`` and
its current activity is reported as unknown.
"""
from __future__ import annotations

import hashlib
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

STATUSES = ("active", "working", "delegating", "waiting", "idle", "completed", "failed", "disconnected")
TERMINAL = {"completed", "failed", "disconnected"}

# Other agent clients fire the same hook with their own event names (Cursor uses camelCase).
EVENT_ALIASES = {
    "sessionStart": "SessionStart", "sessionEnd": "SessionEnd", "beforeSubmitPrompt": "UserPromptSubmit",
    "preToolUse": "PreToolUse", "postToolUse": "PostToolUse", "postToolUseFailure": "PostToolUseFailure",
    "subagentStart": "SubagentStart", "subagentStop": "SubagentStop", "stop": "Stop",
}
CLIENT_LABEL = {"claude-code": "Claude Code", "cursor": "Cursor"}


def canonical_event(name: Any) -> Any:
    """Map a client-specific hook event name onto the Claude Code name the reducer understands."""
    return EVENT_ALIASES.get(name, name) if isinstance(name, str) else name


def client_of(ev: dict[str, Any]) -> str | None:
    """Which agent client produced an event: reported by the hook, else inferred from the transcript path."""
    c = ev.get("client")
    if isinstance(c, str) and c:
        return c
    tp = str(ev.get("transcript_path") or "").replace("\\", "/").lower()
    if "/.cursor/" in tp:
        return "cursor"
    if "/.claude/" in tp:
        return "claude-code"
    return None


CALLSIGNS = [
    "Korda", "Varrin", "Tessic", "Mavek", "Dellan", "Oruss", "Calder", "Ravik", "Senn", "Jorak",
    "Halvek", "Brask", "Ventra", "Kessra", "Orlin", "Tavik", "Merrec", "Sorn", "Daxa", "Rhyse",
    "Vaskon", "Thale", "Ivek", "Corran", "Mirax", "Pell", "Zorvan", "Krell", "Adra", "Fenn",
]


def parse_ts(ts: str | None) -> float:
    if not ts:
        return time.time()
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return time.time()


def _hash(s: str) -> int:
    return int(hashlib.sha1(s.encode()).hexdigest()[:8], 16)


def callsign(agent_key: str, rank: str) -> str:
    h = _hash(agent_key)
    return f"{rank} {CALLSIGNS[h % len(CALLSIGNS)]}-{(h >> 8) % 90 + 10}"


def classify(agent_type: str | None, is_main: bool) -> tuple[str, str, str]:
    """Return (role, department, rank) for an agent type. Department ids match the frontend layout."""
    if is_main:
        return "Lead Developer", "engineering", "Cmdr."
    t = (agent_type or "").lower()
    if any(k in t for k in ("review", "verif", "security", "audit", "lint")):
        return "Code Reviewer", "security", "Lt."
    if any(k in t for k in ("test", "qa")):
        return "Testing Specialist", "engineering", "Lt."
    if any(k in t for k in ("plan", "architect", "orchestr", "design")):
        return "Architect", "operations", "Maj."
    if any(k in t for k in ("doc", "writer")):
        return "Documentation Specialist", "intelligence", "Lt."
    if any(k in t for k in ("explore", "research", "search", "guide", "fetch", "ingest", "recon")):
        return "Research Specialist", "intelligence", "Lt."
    if any(k in t for k in ("model", "eval", "ml", "ai-")):
        return "AI Research Specialist", "research", "Lt."
    if t in ("", "general-purpose", "claude", "fork"):
        return "Engineering Specialist", "engineering", "Lt."
    return t.replace("-", " ").replace(":", " · ").title() + " Specialist", "engineering", "Lt."


@dataclass
class Agent:
    id: str
    kind: str  # "main" | "subagent"
    session_id: str
    agent_type: str | None
    role: str
    department: str
    name: str
    parent_id: str | None = None
    project: str | None = None
    cwd: str | None = None
    model: str | None = None
    status: str = "active"
    activity: str = "Unknown"
    assignment: str | None = None
    active_tool: str | None = None
    active_tool_target: str | None = None
    started_at: float = 0.0
    last_event_at: float = 0.0
    last_event: str | None = None
    ended_at: float | None = None
    tool_calls: int = 0
    errors: int = 0
    last_error: str | None = None
    completion_summary: str | None = None
    children: list[str] = field(default_factory=list)
    tokens: dict[str, int] | None = None
    current_task_id: str | None = None
    client: str = "claude-code"  # which agent client reported it (claude-code | cursor)
    prompts: int = 0  # Commander prompts received (0 = the session never did any work)

    def public(self, now: float | None = None, stale_after: int = 900) -> dict[str, Any]:
        d = asdict(self)
        now = now or time.time()
        stale = self.status not in TERMINAL and self.status != "idle" and (now - self.last_event_at) > stale_after
        d["stale"] = stale
        d["activity_known"] = not stale
        if stale:
            d["activity"] = f"Unknown — last confirmed event: {self.last_event}"
        end = self.ended_at or now
        d["duration_s"] = round(max(0.0, end - self.started_at), 1)
        d["client_label"] = CLIENT_LABEL.get(self.client, self.client)
        # a session that was opened but never prompted and never used a tool has done nothing to observe
        d["engaged"] = self.kind != "main" or self.prompts > 0 or self.tool_calls > 0
        return d


@dataclass
class Task:
    id: str
    agent_id: str
    kind: str  # "turn" (Commander prompt) | "report" (injected subagent report) | "delegation" (work handed to a subagent)
    title: str
    status: str = "in_progress"  # in_progress | completed | failed | interrupted
    started_at: float = 0.0
    ended_at: float | None = None
    summary: str | None = None
    parent_agent_id: str | None = None
    tool_calls: int = 0


MAX_AGENTS = 2000  # agents kept in memory; the oldest by last event are dropped first
MAX_TASKS = 5000  # tasks kept in memory; finished ones are dropped first, oldest first
MAX_PENDING_PER_SESSION = 200  # queued Agent-tool calls per session
MAX_PENDING_SESSIONS = 500  # sessions with queued Agent-tool calls


class Registry:
    def __init__(self) -> None:
        self.agents: dict[str, Agent] = {}
        self.tasks: dict[str, Task] = {}
        self.pending_delegations: dict[str, list[dict[str, Any]]] = {}  # session -> queued Agent-tool calls
        self._task_seq = 0

    # ------------------------------------------------------------------ helpers
    def _main(self, ev: dict[str, Any], ts: float) -> Agent:
        sid = ev.get("session_id") or "unknown"
        key = f"session:{sid}"
        a = self.agents.get(key)
        if a is None:
            role, dept, rank = classify(None, True)
            a = Agent(
                id=key, kind="main", session_id=sid, agent_type="main", role=role, department=dept,
                name=callsign(key, rank), project=ev.get("project"), cwd=ev.get("cwd"), started_at=ts,
                last_event_at=ts,
            )
            self.agents[key] = a
        if ev.get("project") and not a.project:
            a.project = ev.get("project")
        return a

    def _sub(self, ev: dict[str, Any], ts: float) -> Agent:
        aid = ev["agent_id"]
        key = f"agent:{aid}"
        a = self.agents.get(key)
        if a is None:
            main = self._main(ev, ts)
            role, dept, rank = classify(ev.get("agent_type"), False)
            a = Agent(
                id=key, kind="subagent", session_id=main.session_id, agent_type=ev.get("agent_type"),
                role=role, department=dept, name=callsign(key, rank), parent_id=main.id,
                project=main.project, cwd=ev.get("cwd") or main.cwd, started_at=ts, last_event_at=ts,
            )
            self.agents[key] = a
            if key not in main.children:
                main.children.append(key)
        elif ev.get("agent_type") and not a.agent_type:
            a.agent_type = ev.get("agent_type")
        return a

    def _actor(self, ev: dict[str, Any], ts: float) -> Agent:
        return self._sub(ev, ts) if ev.get("agent_id") else self._main(ev, ts)

    def _new_task(self, agent: Agent, kind: str, title: str, ts: float, parent: str | None = None) -> Task:
        self._task_seq += 1
        t = Task(id=f"T{self._task_seq:05d}", agent_id=agent.id, kind=kind, title=title or "(untitled)",
                 started_at=ts, parent_agent_id=parent)
        self.tasks[t.id] = t
        agent.current_task_id = t.id
        return t

    def _close_task(self, agent: Agent, status: str, ts: float, summary: str | None = None) -> Task | None:
        t = self.tasks.get(agent.current_task_id or "")
        if t and t.status == "in_progress":
            t.status = status
            t.ended_at = ts
            if summary:
                t.summary = summary
            return t
        return None

    # ------------------------------------------------------------------ reducer
    def apply(self, ev: dict[str, Any]) -> tuple[list[Agent], list[Task]]:
        """Apply one sanitised hook event. Returns (changed agents, changed tasks)."""
        name = canonical_event(ev.get("event"))
        ts = parse_ts(ev.get("ts"))
        changed_tasks: list[Task] = []
        a = self._actor(ev, ts)
        changed: list[Agent] = [a]
        client = client_of(ev)
        if client:
            a.client = client
        a.last_event_at = max(a.last_event_at, ts)
        a.last_event = name
        if ev.get("model"):
            a.model = ev["model"] if isinstance(ev["model"], str) else str(ev["model"])

        if name == "SessionStart":
            a.status = "active"
            a.ended_at = None
            a.activity = f"Session started ({ev.get('source', 'startup')})"
        elif name == "UserPromptSubmit":
            a.status = "working"
            a.prompts += 1
            excerpt = (ev.get("prompt_excerpt") or "").lstrip()
            # Claude Code injects background-agent reports / notifications as prompt turns.
            injected = excerpt.startswith(("<agent-message", "<task-notification", "<system-reminder"))
            if injected:
                a.activity = "Processing a report from a delegated agent"
                title = "Process delegated agent report"
            else:
                a.assignment = excerpt or a.assignment
                a.activity = "Received orders from the Commander"
                title = a.assignment or "Commander prompt"
            a.completion_summary = None
            prev = self._close_task(a, "interrupted", ts)
            if prev:
                changed_tasks.append(prev)
            changed_tasks.append(self._new_task(a, "report" if injected else "turn", title, ts))
        elif name == "PreToolUse":
            a.tool_calls += 1
            t = self.tasks.get(a.current_task_id or "")
            if t and t.status == "in_progress":
                t.tool_calls += 1
                changed_tasks.append(t)
            if ev.get("tool_name") in ("Agent", "Task"):
                a.status = "delegating"
                a.active_tool = ev.get("tool_name")
                a.active_tool_target = ev.get("delegation") or ev.get("tool_target")
                a.activity = f"Delegating: {a.active_tool_target or ev.get('subagent_type') or 'subagent'}"
                self.pending_delegations.setdefault(a.session_id, []).append({
                    "tool_use_id": ev.get("tool_use_id"), "subagent_type": ev.get("subagent_type"),
                    "description": ev.get("delegation") or ev.get("tool_target"), "parent": a.id,
                    "child": None,
                })
            else:
                a.status = "working"
                a.active_tool = ev.get("tool_name")
                a.active_tool_target = ev.get("tool_target")
                a.activity = f"Using {a.active_tool}" + (f" — {a.active_tool_target}" if a.active_tool_target else "")
        elif name in ("PostToolUse", "PostToolUseFailure"):
            tool = ev.get("tool_name")
            if name == "PostToolUseFailure" or ev.get("error"):
                a.errors += 1
                a.last_error = ev.get("error") or f"{tool} failed"
            if tool in ("Agent", "Task"):
                # the delegated work returned to the parent
                for d in self.pending_delegations.get(a.session_id, []):
                    if d["tool_use_id"] and d["tool_use_id"] == ev.get("tool_use_id"):
                        d["returned"] = True
                still = [d for d in self.pending_delegations.get(a.session_id, []) if not d.get("returned")]
                a.status = "delegating" if still else "working"
                a.activity = "Received report from delegated agent" if name == "PostToolUse" else "Delegated agent failed"
            else:
                a.status = "working"
                a.activity = (f"Finished {tool}" if name == "PostToolUse" else f"{tool} failed")
            if a.active_tool == tool:
                a.active_tool = None
                a.active_tool_target = None
        elif name == "SubagentStart":
            parent = self.agents.get(a.parent_id or "")
            a.status = "active"
            a.ended_at = None
            queue = self.pending_delegations.get(a.session_id, [])
            match = next((d for d in queue if d["child"] is None and d.get("subagent_type") == a.agent_type), None) \
                or next((d for d in queue if d["child"] is None), None)
            if match:
                match["child"] = a.id
                a.assignment = match.get("description")
                if match.get("parent") and match["parent"] in self.agents and match["parent"] != a.parent_id:
                    old_parent = self.agents.get(a.parent_id or "")
                    if old_parent and a.id in old_parent.children:
                        old_parent.children.remove(a.id)
                        changed.append(old_parent)
                    a.parent_id = match["parent"]
                    parent = self.agents[a.parent_id]
            a.activity = "Received assignment" if a.assignment else "Started (assignment not reported)"
            changed_tasks.append(self._new_task(a, "delegation", a.assignment or f"{a.role} task", ts,
                                                parent=a.parent_id))
            if parent:
                if a.id not in parent.children:
                    parent.children.append(a.id)
                changed.append(parent)
        elif name == "SubagentStop":
            a.status = "completed"
            a.ended_at = ts
            a.active_tool = None
            a.active_tool_target = None
            a.completion_summary = ev.get("summary")
            a.activity = "Mission complete — report delivered"
            t = self._close_task(a, "completed", ts, ev.get("summary"))
            if t:
                changed_tasks.append(t)
        elif name == "Stop":
            a.status = "idle"
            a.active_tool = None
            a.active_tool_target = None
            a.completion_summary = ev.get("summary")
            a.activity = "Turn complete — awaiting the Commander"
            t = self._close_task(a, "completed", ts, ev.get("summary"))
            if t:
                changed_tasks.append(t)
        elif name == "StopFailure":
            a.status = "failed"
            a.errors += 1
            a.last_error = ev.get("error") or "Stop failure"
            a.activity = "Turn ended with an error"
            t = self._close_task(a, "failed", ts, a.last_error)
            if t:
                changed_tasks.append(t)
        elif name == "Notification":
            nt = ev.get("notification_type") or ""
            if "permission" in nt:
                a.status = "waiting"
                a.activity = "Waiting for Commander permission"
            elif "idle" in nt:
                a.status = "idle"
                a.activity = "Awaiting the Commander's input"
            else:
                a.activity = ev.get("message") or a.activity
        elif name == "PermissionRequest":
            a.status = "waiting"
            tool = ev.get("tool_name")
            a.activity = "Waiting for Commander permission" + (f" — {tool}" if tool else "")
        elif name == "SessionEnd":
            a.status = "disconnected"
            a.ended_at = ts
            a.active_tool = None
            a.activity = f"Session ended ({ev.get('reason', 'unknown')})"
            t = self._close_task(a, "interrupted", ts)
            if t:
                changed_tasks.append(t)
            for cid in a.children:
                c = self.agents.get(cid)
                if c and c.status not in TERMINAL:
                    c.status = "disconnected"
                    c.ended_at = ts
                    c.activity = "Parent session ended before a completion event was received"
                    changed.append(c)
        # other / unknown events are recorded but do not change status
        self._trim(keep=a.id)
        return changed, changed_tasks

    def _trim(self, keep: str) -> None:
        """Hold the in-memory maps to fixed sizes. Events stay in the database; only the live view forgets."""
        if len(self.tasks) > MAX_TASKS:
            extra = len(self.tasks) - MAX_TASKS
            finished = [tid for tid, t in self.tasks.items() if t.status != "in_progress"]
            drop = finished[:extra]
            if len(drop) < extra:  # all in progress: the oldest go anyway
                chosen = set(drop)
                drop += [tid for tid in self.tasks if tid not in chosen][: extra - len(drop)]
            for tid in drop:
                del self.tasks[tid]
        if len(self.agents) > MAX_AGENTS:
            oldest = sorted((a for a in self.agents.values() if a.id != keep), key=lambda a: a.last_event_at)
            for a in oldest[: len(self.agents) - MAX_AGENTS]:
                del self.agents[a.id]
                parent = self.agents.get(a.parent_id or "")
                if parent and a.id in parent.children:
                    parent.children.remove(a.id)
        for sid, queue in self.pending_delegations.items():
            if len(queue) > MAX_PENDING_PER_SESSION:
                del queue[: len(queue) - MAX_PENDING_PER_SESSION]
        if len(self.pending_delegations) > MAX_PENDING_SESSIONS:
            for sid in list(self.pending_delegations)[: len(self.pending_delegations) - MAX_PENDING_SESSIONS]:
                del self.pending_delegations[sid]

    def set_tokens(self, agent_id: str, usage: dict[str, Any]) -> Agent | None:
        a = self.agents.get(agent_id)
        if not a:
            return None
        a.tokens = {k: int(v) for k, v in usage.items() if k != "model" and isinstance(v, (int, float))}
        if usage.get("model"):
            a.model = usage["model"]
        return a

    def delegations(self) -> list[dict[str, Any]]:
        out = []
        for a in self.agents.values():
            if a.kind == "subagent" and a.parent_id:
                out.append({"parent": a.parent_id, "child": a.id, "description": a.assignment, "status": a.status})
        return out

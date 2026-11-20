# Claude Code agent integration

Initial and only real-agent integration: **Claude Code 2.1.318** (the installed version) via its **hooks**
mechanism. No paid APIs, no extra subscriptions, no OpenTelemetry collector required.

## Why hooks

Hooks are Claude Code's supported, local, documented way to observe a session: a command receives a JSON
payload on stdin for each lifecycle event. They cover everything Imperial Base needs — sessions, prompts,
every tool call (including tool calls made *inside* subagents, which carry `agent_id`/`agent_type`),
subagent start/stop, turn completion, failures and notifications. Imperial Base neither replaces nor reads any
observability platform you already run.

## Capture: `hooks/imperial-hook.js`

Registered for: `SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure,
SubagentStart, SubagentStop, Stop, StopFailure, Notification` (timeout 5 s).

Guarantees:

* exits 0 always, hard 1.5 s ceiling, never writes stdout (stdout of some hooks is injected into context);
* **no network**; appends one JSON line to `%USERPROFILE%\.imperial-base\spool\events.jsonl`;
* never stores tool inputs or outputs, file contents, full commands or full prompts. Instead:
  * file tools → basename only (`main.py`);
  * Bash/PowerShell → the human-written `description`, else only the first word of the command;
  * WebFetch → host name only; WebSearch/Glob → short redacted query/pattern;
  * Agent/Task → `description` and `subagent_type` (never the delegated prompt);
  * prompts → first 160 characters, redacted; summaries → 240 characters, redacted;
* redacts API keys, GitHub/Slack/AWS/Google tokens, JWTs, bearer/basic credentials, `key=value` secrets,
  long opaque strings and e-mail addresses;
* records the *names* (not values) of the top-level payload keys, as runtime schema evidence (`/api/schema`).

## Install

`python scripts\install_hooks.py` — additive, idempotent, backs up `settings.json` first.
`--status`, `--uninstall` available. Hooks from other tools are preserved.

Per-session alternative without touching global settings (used for this project's validation runs):

```bat
claude -p "…" --settings C:\path\imperial-settings.json
```

where the file contains a `{"hooks": {...}}` block with the same command for each event.

## Lifecycle → state mapping (`backend/app/state.py`)

| Hook event | Effect |
|---|---|
| SessionStart | main agent `active` (identity `session:<session_id>`) |
| UserPromptSubmit | `working`, assignment = prompt excerpt, opens an **ORDERS** task. Prompts beginning `<agent-message`, `<task-notification` or `<system-reminder` are injected background-agent reports: they open a **REPORT** task and do *not* overwrite the assignment |
| PreToolUse | `working`, active tool + target; for `Agent`/`Task`: `delegating`, queues a pending delegation (type + description) |
| PostToolUse / PostToolUseFailure | clears the active tool; failures increment errors and keep the last error |
| SubagentStart | creates the subagent (`agent:<agent_id>`), links it to the parent and to the oldest pending delegation of the same `subagent_type` (SubagentStart carries no `tool_use_id`), opens a **DELEGATION** task |
| SubagentStop | subagent `completed`, completion summary, token usage from `agent_transcript_path` |
| Stop | main agent `idle` (turn complete — awaiting the Commander), closes the task, token usage from `transcript_path` |
| StopFailure | `failed` + error |
| Notification | `permission_prompt` → `waiting`; `idle_prompt` → `idle` |
| SessionEnd | `disconnected`; non-terminal subagents also `disconnected` ("parent session ended before a completion event was received") |

Tool calls fired inside a subagent carry `agent_id`, so they are attributed to the subagent, not the parent.

**Runtime finding (validated):** in this Claude Code version the `Agent` tool returns immediately and the
subagent runs in the background. The parent's `PostToolUse(Agent)` therefore arrives *before* the subagent's
work, and the parent may reach `Stop` while the child is still active; the subagent's report is later injected
as a new prompt turn. The reducer and UI reflect exactly that ordering.

**No fabrication rules:** status only changes on events. If a non-idle agent has no event for 15 minutes
(`IMPERIAL_STALE_AFTER`), the API marks it `stale`, `activity_known: false`, and the activity reads
"Unknown — last confirmed event: X". Model id is shown only once it appears in transcript usage; tokens only
after a turn completes ("available after the turn completes" before that).

## Agent identity, roles and departments

Callsigns are deterministic from the agent id (e.g. *Cmdr. Ravik-64*, *Lt. Krell-30*) so the same agent always
has the same name. Role/department by `agent_type`:

| agent_type contains | Role | Department |
|---|---|---|
| (main session) | Lead Developer | Engineering |
| review, verif, security, audit, lint | Code Reviewer | Security |
| test, qa | Testing Specialist | Engineering (test labs) |
| plan, architect, orchestr, design | Architect | Operations |
| doc, writer | Documentation Specialist | Intelligence |
| explore, research, search, guide, fetch, ingest, recon | Research Specialist | Intelligence |
| model, eval, ml, ai- | AI Research Specialist | AI Research Labs |
| general-purpose, claude, fork, (empty) | Engineering Specialist | Engineering |
| anything else | "<Type> Specialist" | Engineering |

## Physical representation (`frontend/src/agents/actors.ts`)

* New agent → body appears at its department's entry and walks to a station; agents already on duty when the
  page loads start at their post.
* Station chosen from the **real active tool**: Bash → terminals/consoles/labs; Read/Grep/Glob → records archive
  or console; Edit/Write → development consoles; WebFetch/WebSearch → terminals/archive; Agent/Task (and
  `delegating`) → holotable/briefing table, with a *talk* animation.
* `waiting` → stays at the station, idle pose; `idle`/`completed`/`stale` → lounge area;
  `completed` subagents remain visible 5 minutes, then leave; `disconnected` → walks out after the event.
* Delegation: a purple arc with a travelling data packet links parent and child (across buildings it arcs over
  the base and is visible from outside); dashed and dim once the child is done.
* Exterior: each building shows a beacon "N LIVE AGENTS" with one status pip per agent.

## Orders (the one command channel)

Sessions started elsewhere are observed only; nothing is ever sent to them. The base can command only the agents
it starts itself, from the **Orders** chat (`backend/app/orders.py`):

* each conversation runs the installed `claude` CLI headless (`claude -p`, resumed for follow-ups) in one fixed
  folder, this project (`IMPERIAL_ORDERS_CWD`); the chat cannot choose another;
* permission mode `acceptEdits`: file edits go through, anything else your Claude Code settings do not already
  allow is refused by the CLI and reported in the chat;
* up to four agents work at once; 30 conversations are kept, in memory only, never in the database;
* the agent's own hook events make it appear in the world like any other agent;
* `IMPERIAL_ORDERS=0` switches orders off, and `GET /api/commands` then lists nothing.

## Other agent systems

Only Claude Code (and Cursor, through the same hook) is integrated. A read-only adapter for another system could append records in the
same sanitised schema to the spool; the engine would ingest them unchanged.

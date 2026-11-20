# Event schema

## 1. Claude Code hook payloads — validated at runtime

Observed top-level keys from real Claude Code 2.1.318 sessions on this machine (2026-11-04), recorded by the
hook's `raw_keys` field and served live at `GET /api/schema`. Key **names** only; values are never stored.

| Event | Keys observed |
|---|---|
| SessionStart | cwd, hook_event_name, session_id, source, transcript_path |
| UserPromptSubmit | cwd, hook_event_name, permission_mode, prompt, prompt_id, session_id, transcript_path |
| PreToolUse | agent_id*, agent_type*, cwd, effort, hook_event_name, permission_mode, prompt_id, session_id, tool_input, tool_name, tool_use_id, transcript_path |
| PostToolUse | agent_id*, agent_type*, cwd, duration_ms, effort, hook_event_name, permission_mode, prompt_id, session_id, tool_input, tool_name, tool_response, tool_use_id, transcript_path |
| SubagentStart | agent_id, agent_type, cwd, hook_event_name, prompt_id, session_id, transcript_path |
| SubagentStop | agent_id, agent_transcript_path, agent_type, background_tasks, cwd, effort, hook_event_name, permission_mode, prompt_id, session_crons, session_id, stop_hook_active, transcript_path |
| Stop | background_tasks, cwd, effort, hook_event_name, last_assistant_message, permission_mode, prompt_id, session_crons, session_id, stop_hook_active, transcript_path |
| SessionEnd | cwd, hook_event_name, prompt_id, reason, session_id, transcript_path |

`*` present only when the tool call happens inside a subagent.

Not yet observed at runtime (handled from documented fields, tolerant of absence): `PostToolUseFailure`
(`error`), `StopFailure` (`error`), `Notification` (`notification_type`, `message`). `SessionStart` did **not**
include a `model` field in this version — the model id is taken from transcript usage records instead.
`SubagentStart` has no `tool_use_id`, so delegations are matched by `subagent_type` in arrival order.

## 2. Sanitised spool record (hook output, version `v: 1`)

One JSON object per line in `~/.imperial-base/spool/events.jsonl`. Undefined/empty fields are omitted.

| Field | Type | Source / notes |
|---|---|---|
| v | int | schema version (1) |
| ts | ISO-8601 string | time the hook ran |
| event | string | `hook_event_name` |
| session_id | string | required |
| cwd, project | string | project = basename of cwd |
| transcript_path | string | used only for usage counters |
| permission_mode | string | |
| agent_id, agent_type | string | subagent context |
| raw_keys | string[] | top-level key names (schema evidence) |
| source | string | SessionStart |
| model | string | if the runtime ever sends it |
| reason | string | SessionEnd |
| prompt_excerpt | string ≤160 | UserPromptSubmit, redacted |
| tool_name, tool_use_id | string | tool events |
| tool_target | string | privacy-reduced target (basename, description, host…) |
| subagent_type, delegation | string | Agent/Task tool calls |
| error | string ≤200 | failures, redacted |
| agent_transcript_path | string | SubagentStop |
| summary | string ≤240 | `last_assistant_message`, redacted |
| notification_type, message | string | Notification |

The backend (`engine.sanitise`) re-validates: requires `event` + `session_id`, keeps only the keys above,
truncates strings to 600 chars, drops nested objects.

## 3. Backend state (public JSON)

**Agent** (`GET /api/agents`, `/api/agents/{id}`): `id` (`session:<sid>` | `agent:<agent_id>`), `kind`
(`main`|`subagent`), `session_id`, `agent_type`, `role`, `department`, `name`, `parent_id`, `project`, `cwd`,
`model`, `status` (`active|working|delegating|waiting|idle|completed|failed|disconnected`), `activity`,
`assignment`, `active_tool`, `active_tool_target`, `started_at`, `last_event_at`, `last_event`, `ended_at`,
`tool_calls`, `errors`, `last_error`, `completion_summary`, `children[]`, `tokens{input_tokens, output_tokens,
cache_creation_input_tokens, cache_read_input_tokens, total_tokens, messages}`, `current_task_id`, `stale`,
`activity_known`, `duration_s`.

**Task** (`GET /api/tasks`): `id`, `agent_id`, `kind` (`turn`|`report`|`delegation`), `title`, `status`
(`in_progress|completed|failed|interrupted`), `started_at`, `ended_at`, `summary`, `parent_agent_id`, `tool_calls`.

## 4. API

| Method | Path | |
|---|---|---|
| GET | /api/health | service + ingest status (spool, offset, events stored, hook installed) |
| GET | /api/snapshot | agents, last 300 tasks, last 250 events, delegations, ingest status |
| GET | /api/agents, /api/agents/{id} | agents; one agent with its tasks and last 100 events |
| GET | /api/events?limit=&session_id= | sanitised events |
| GET | /api/tasks, /api/sessions | |
| GET | /api/schema | observed hook payload keys per event |
| GET | /api/system | CPU / memory / GPU availability / Claude process count / Docker containers |
| POST | /api/ingest | direct ingestion (same record validation and redaction); one record or a list of up to 500 → `{"accepted": n}`. `application/json` only, body ≤ `IMPERIAL_MAX_INGEST_BYTES` (413 above). Used by tests |
| GET | /api/commands | `{"enabled", "available": ["orders"], "note"}` — orders are the only command |
| GET | /api/orders | orders status (`enabled`, `reason`, `folder`, `max_running`, `permission_mode`, `tools`, `read_access`) + every conversation |
| POST | /api/orders | `{"text"}` — start a new conversation (one agent) |
| POST | /api/orders/{id}/messages | `{"text"}` — reply once the agent has finished its turn |
| POST | /api/orders/{id}/stop | stop the agent while it works |
| WS | /ws | server → client: `snapshot`, `event {event, agents[], tasks[]}`, `system`, `orders`, `order`; client → server: `ping` |

Every endpoint above, the WebSocket and the static files accept only this machine talking to itself. The caller
address must be loopback. The `Host` must be exactly `127.0.0.1`, `localhost` or `[::1]` with the port the server
listens on. The `Origin` (when sent) must be exactly `http://` plus that `Host`. On `/api` and `/ws`, a browser
that marks the request cross-site or same-site is refused. Anything else gets `403` (`{"detail", "code"}`) before
any route runs, or a WebSocket closed before it is accepted. Requests forwarded by the base's Vite dev server
(port 5273 or 5274) are accepted with that server's per-launch token only. POST bodies must be JSON. Order text is
limited to 8000 characters, WebSocket messages to 4096 characters, and 32 sockets may be open at once.
Conversations live in memory and are not stored.

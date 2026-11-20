# Architecture

```
 Claude Code session(s)                        Imperial Base backend (one Python process, 127.0.0.1:8742)
 ┌──────────────────────┐   stdin JSON   ┌────────────────────┐  append  ┌──────────────────────────────┐
 │ hook events          │ ─────────────► │ hooks/imperial-    │ ───────► │ ~/.imperial-base/spool/      │
 │ (SessionStart, Pre/  │                │ hook.js (Node)     │  1 line  │ events.jsonl                 │
 │ PostToolUse, Sub-    │                │ sanitise + redact  │          └──────────────┬───────────────┘
 │ agentStart/Stop …)   │                │ no network/stdout  │                         │ tail (0.5 s stat)
 └──────────────────────┘                └────────────────────┘                         ▼
                                                                    ┌──────────────────────────────────────┐
                                                                    │ engine.py: validate (allow-list) →   │
                                                                    │ SQLite events table → Registry       │
                                                                    │ (state.py pure reducer) → broadcast  │
                                                                    │ transcripts.py: usage counters only  │
                                                                    │ system.py: psutil / nvidia-smi /     │
                                                                    │ docker ps (only while a client is on)│
                                                                    └───────────────┬──────────────────────┘
                                                      REST /api/*  +  WebSocket /ws │ snapshot, then deltas
                                                                                    ▼
 Browser (React + R3F) ────────────────────────────────────────────────────────────────────────────────────
  state/store.ts (zustand)  ◄── lib/ws.ts (event-driven, reconnect backoff; 30 s keep-alive ping only)
  agents/actors.ts          confirmed agent state → department, station, path, action (pure)
  agents/AgentLayer.tsx     HeroCharacter bodies, nameplates, delegation arcs, exterior beacons
  sim/world.ts              aircraft sims + hangar doors (mutable singletons, stepped once per frame)
  aircraft/flight.ts        spline flight model, shuttle state machine, patrols, flyby (pure, tested)
  personnel/*               rig (pose math), instanced Crowd (12 draw calls), crowd sim on the nav graph
  world/*                   layout (single source of truth), terrain, sky, structures (merged kits)
  interiors/*               room layouts, interior renderer, holo tactical table, telemetry wall, crew
  camera/CameraRig.tsx      orbit / tactical / first-person / third-person / follow / cinematic tours
  ui/HUD.tsx                command interface (roster, missions, events, air control, facilities, inspector)
```

## Key decisions

* **File spool instead of HTTP from the hook.** Hooks run on every tool call; appending one line to a local
  file is fast, never blocks a session if the backend is down, and loses nothing while it is offline (the
  backend resumes from the stored byte offset). Partial lines are left for the next poll; truncation/rotation
  is detected and restarts from 0. The hook rotates the spool at 20 MB.
* **Events are the source of truth.** Agent and task state is a pure fold over stored events
  (`Registry.apply`). On restart the backend replays SQLite, so the UI state is reproducible and testable.
* **Defence in depth on privacy.** The hook reduces payloads (no tool inputs/outputs, basenames only, redacted
  short excerpts); the backend accepts only an allow-list of keys, redacts them again (`backend/app/redact.py`,
  the same patterns as the hook) and truncates strings. Redaction is pattern matching and cannot catch every secret.
* **One check at the server edge.** `LocalBoundary` (`backend/app/main.py`) runs before every route and WebSocket
  handshake: exact loopback `Host` on the server's own port, loopback caller, `Origin` (if sent) equal to that
  `Host`, no cross-site fetches of `/api` or `/ws`. A request naming a Vite dev port is accepted only with the
  token that the running Vite server wrote at start-up. Forwarding headers are never read.
* **Observation first, one command channel.** Nothing can be sent to a session started elsewhere. The Commander
  authorised one channel, off unless `IMPERIAL_ORDERS=1`: orders (`backend/app/orders.py`), which start a headless
  `claude -p` run in a workspace folder separate from the base's code. The run uses `acceptEdits` and a tool
  allowlist (`--tools Edit,Write`; Read, Glob and Grep only with `IMPERIAL_ORDERS_READ=1`; never a shell, web or
  MCP). A `PreToolUse` guard (`backend/app/orders_guard.py`) refuses any path outside the workspace. Deny rules
  cover the base's files, the Claude Code configuration and common credential files. The base refuses to start
  an agent when the workspace holds project configuration, or when the Commander's Claude Code settings could
  widen access. Each launch gets its own settings file. Conversations are held in memory, not written to the
  database.
* **Untrusted paths are checked as text first** (`backend/app/pathsafe.py`): transcript paths from events and URL
  paths in the catch-all route are refused if they are network, device or traversal paths, or fall outside the
  approved folders, before any filesystem call.
* **Interiors live inside their buildings** at real world coordinates. Agents walk from the department door to
  a station; the shell is hidden while the camera is inside. The command chamber is the tower's bridge with
  clear glass onto the live base; the bunker is underground. Only the active interior is rendered.
* **Simulation is separate from telemetry.** Aircraft/personnel live in `sim/` and `personnel/` and never read
  agent data; the only shared surface is the UI feed, where items are tagged SIM vs AGENT.
* **Geometry merging.** `world/kit.ts` accumulates primitives per material and merges them, so a building is a
  handful of draw calls. Aircraft use the same idea (`GeoBatch`). Crowds are instanced per body part.

## Processes and ports

| Process | Port | Notes |
|---|---|---|
| `uvicorn --factory app.main:create_app` | 8742 | serves API, WebSocket and the built frontend |
| `vite` (dev only) | 5273 (5274 for QA) | proxies `/api` and `/ws` to 8742, adding its per-launch dev-proxy token; `strictPort` |

Configuration is via environment variables (see `backend/app/config.py`): `IMPERIAL_PORT`, `IMPERIAL_HOST`,
`IMPERIAL_BASE_DIR`, `IMPERIAL_SPOOL`, `IMPERIAL_DB`, `IMPERIAL_STALE_AFTER`, `IMPERIAL_READ_USAGE=0` (disable
transcript usage reading), `IMPERIAL_SPOOL_POLL`, `IMPERIAL_SYSTEM_SAMPLE`, `IMPERIAL_MAX_EVENTS`.

## Directory map

```
backend/app/      config, store (SQLite), state (reducer), engine (ingest), transcripts, system, main (API)
backend/tests/    pytest suite (hook, reducer, API, WebSocket, spool tailing, restart replay)
hooks/            imperial-hook.js
scripts/          install_hooks.py
frontend/src/     see diagram above; *.test.ts are vitest suites
```

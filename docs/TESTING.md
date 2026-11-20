# Testing

## Automated suites

```bat
backend\.venv\Scripts\python -m pytest -q backend\tests     :: 121 tests (+2 skipped)
cd frontend && npx vitest run                               :: 111 tests in 15 files
cd frontend && npx tsc --noEmit -p .                         :: strict typecheck
```

`test.cmd` wraps the three. Last full run: 2026-11-20, `test.cmd` printed ALL TESTS PASSED
(121 backend passed and 2 skipped, 111 frontend, typecheck clean). The per-file lists below were written as each suite was added
and may lag the current totals.

### Backend — `backend/tests/test_security_high.py` (85 passing, 2 skipped)

Regression tests for the high-severity findings. No real agent is started (a scripted runner, or `subprocess.Popen`
replaced by a recorder), and no network path is touched (filesystem calls on UNC paths are recorded and refused):

* **`/api/ingest`:** legitimate local JSON accepted (with and without the base's own Origin); malicious Host
  headers, foreign / `null` / other-port / https Origins, and `text/plain`, form, multipart, `application/jsonp`
  or missing content types refused; oversized bodies refused both by declared length and while streaming;
  malformed JSON refused; UNC, `\\?\UNC` and `\\.\` transcript paths never reach the filesystem.
* **Paths:** Windows path forms (UNC, long-path and device prefixes, drive-relative, root-relative, alternate data
  streams, `..`, reserved names, NUL); transcripts outside the approved folders, or reached through a junction that
  leaves them, are not read. The symlink variants are skipped without Developer Mode; the junction variants run.
* **Catch-all route:** normal navigation, assets, root files and models still served; encoded UNC paths, encoded
  traversal, drive paths, NUL, alternate streams, reserved names and junction escapes get the app page instead.
* **Orders:** off unless `IMPERIAL_ORDERS=1` exactly; when off, no route or socket message starts anything and the
  workspace is not created; folders overlapping the checkout, the hook copy or the database are refused; with a
  mocked `Popen`, the agent runs in its workspace with `acceptEdits`, `--disallowedTools Bash,PowerShell`,
  `--strict-mcp-config` and a `--settings` file of deny rules, the prompt only on stdin; an overlapping folder is
  refused before any process starts; the full enabled path works end to end with the process mocked.
* **Hook installer** (run against a temporary home, checked first): installs a copy outside the checkout, moves an
  older entry that pointed into it, keeps other tools' hooks; unknown options and `--help` change nothing.

### Backend — `backend/tests/test_orders.py` (16 passing)

Runs the orders manager against a fake `claude` CLI, so no real agent starts:

* an order runs in the fixed folder and its reply reaches the chat; a follow-up resumes the same conversation;
* a busy agent refuses a second message and can be stopped; refused tool calls and failed runs are reported in
  the chat; a run that dies without a result is marked failed;
* live updates reach the WebSocket; input limits (8000 characters); at most four agents work at once;
* requests and sockets from other sites are refused, including pages served by other programs on this machine
  (same host name, different port), and conversations are never written to the database;
* the test host names `testserver` / `testclient` are not trusted; the suites connect as `127.0.0.1` like a real
  browser;
* a `claude` file planted in the working folder or the current folder is never run;
* `IMPERIAL_ORDERS=0` switches orders off; tool descriptions keep detail low; unknown records are ignored.

`frontend/src/lib/orders.test.ts` (4) covers the chat's client-side helpers.

### Backend — `backend/tests/test_backend.py` (20 passing)

* **Hook (runs the real `imperial-hook.js` under Node):** commands, bearer tokens, `token=` secrets and e-mail
  addresses never reach disk; tool_input is never stored; file tools keep the basename only; delegated prompts
  are not stored; prompt excerpts ≤ 160 chars; garbage input exits 0 with no stdout.
* **Reducer:** full lifecycle with delegation (parent/child link, department routing, tool attribution to the
  subagent, task closing and tool-call counting); failures, permission waiting and disconnect cascade; stale
  agents report unknown activity; injected subagent reports do not overwrite the Commander's orders.
* **Ingestion:** unknown fields rejected; transcript usage counters (dedupe of streamed messages, model id,
  missing file).
* **API/WebSocket:** ingest + snapshot + agent detail + the commands endpoint; live WebSocket delta after ingest.
* **Spool tailing:** incremental reads, partial-line handling, truncation/rotation restart.
* **Persistence:** state rebuilt identically from SQLite after a restart.

### Frontend — vitest (29 passing)

* `audio/engine.test.ts` (5): Doppler factor is 1 at rest, > 1.2 approaching / < 0.85 receding at 150 m/s,
  unaffected by perpendicular motion, accounts for listener motion, clamped.
  In-browser check: master output RMS 0.04 (ambience) → 0.09–0.11 following a TIE → 0.12 following the shuttle;
  muting suspends the context; no console errors.

* `aircraft/flight.test.ts` (11): every route (shuttle approach + climb-out, both patrol rings, X-wing flyby)
  clears terrain and all building volumes with margin; full shuttle state machine
  (away → approach → descent → landed → liftoff → climbout → away) incl. refused invalid commands, gear/wings/
  ramp states, no position jump between phases, never below the pad; patrols launch, patrol and recover to
  parked without NaNs; formation separation; X-wing appears, opens S-foils, leaves; orientation convention.
* `personnel/rig.test.ts` (13): pose determinism and finiteness, left/right gait half a cycle apart, arms
  opposite legs, cadence, foot contact; crowd sim determinism, 150 members × 10 000 steps without NaN,
  walkers stay within 6 m of graph edges, wall patrols on the wall, shuttle team reaches the pad and returns;
  triangle budget.

## Integration tests with real Claude Code

Two real headless Claude Code 2.1.318 sessions were run with the hook passed via `--settings` (no change to
global settings), against the running backend:

1. Lead agent delegating to an **Explore** subagent → captured SessionStart, UserPromptSubmit, Pre/PostToolUse
   (Agent, Glob, Bash, SubagentHandback), SubagentStart/Stop, Stop, SessionEnd. The backend produced: lead
   *Lead Developer* in Engineering, subagent *Research Specialist* in Intelligence linked as child, delegation
   task "Survey hook folder" completed, real model id (`claude-haiku-5-5`) and token counts from transcripts.
   This run exposed the injected-report prompt turn, which was then handled and covered by a unit test.
2. Lead agent delegating to **Explore + Plan** (then a **general-purpose**) subagent → agents appeared live in the
   browser with hierarchy, purple delegation arcs between Engineering ↔ Intelligence/Operations, per-agent
   inspector with live tool (`Read · rig.ts`), and bodies physically at Engineering consoles.

Observed runtime schemas are documented in EVENT_SCHEMA.md and served at `/api/schema`.

## Browser QA (Playwright, headless Chromium + SwiftShader)

Scripted runs drove the real app (hotkeys, button clicks, quality changes) and the screenshots were reviewed:
exterior overview, tactical view, command bridge with live holo table and clear glass, Engineering/
Intelligence interiors with real agents and nameplates, inspector, follow-agent camera, shuttle on approach and
**landed on the pad** (wings folded, gear down, ramp lowered), X-wing alert + interceptor feed, third-person
avatar walking, first-person entry with the door prompt.

Bugs found by QA and fixed: dark building materials; solid red roof slab on Operations; oversized labels near
the camera; command tour reset by interior change; landing-pad bevel hiding markings / raising touchdown;
tower shaft piercing the bridge floor; opaque bridge glass; task tool counts not pushed live; nameplates over
HUD; first-person spawn facing the wall; shuttle approach clipping the hangar roof edge and X-wing spline dipping
below terrain (both caught by the clearance tests).

Console: no application errors. Remaining warnings come from libraries (`THREE.Clock` deprecation inside R3F)
and SwiftShader's ReadPixels notice.

## Not verified here

* Real-GPU frame rate on the Intel iGPU (see PERFORMANCE.md).
* `PostToolUseFailure`, `StopFailure` and `Notification` payloads from a live session (handled per docs, covered
  by unit tests with synthetic events, but not yet observed at runtime).
* Pointer-lock mouse-look in first person (headless browsers cannot lock the pointer); movement, collision and
  door prompts were exercised.
* The globally installed hook (`scripts/install_hooks.py`) — the installer was not run because changing global
  Claude Code settings is left to you. The same hook command was exercised via `--settings`.

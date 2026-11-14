# IMPERIAL BASE

A living, explorable 3D Imperial-style planetary installation — **Imperial Garrison Aurek-9 on Ketrax Prime** —
where **real Claude Code agents** appear as identifiable personnel working inside the base, while shuttles land,
TIE-inspired fighters patrol and an unidentified X-wing-inspired contact crosses the horizon.

* Frontend: React 19 + TypeScript + Vite 8 + three.js 0.187 + React Three Fiber 9 + drei + zustand
* Backend: Python 3.12 + FastAPI + WebSockets + SQLite (stdlib)
* Agent integration: a Claude Code **hook** (`hooks/imperial-hook.js`) → local spool file → backend → browser
* Local-first: no cloud services, no paid APIs, no Docker, no extra subscriptions. Binds to `127.0.0.1` only.

All 3D assets are original procedural geometry and textures generated in code (no ripped models, no
copyrighted music or textures). Aircraft and architecture are *inspired by* the genre, not copies of film assets.

---

## Quick start (Windows)

Prerequisites: Node.js ≥ 20, Python ≥ 3.11, Claude Code.

```bat
cd C:\Projects\Imperial-Base
start.cmd
```

`start.cmd` creates the Python venv, installs dependencies and builds the frontend on first run, then serves the
app at **http://127.0.0.1:8742** and opens your browser.

To stop it, run `stop.cmd` (or press Ctrl+C in the window that `start.cmd` opened). `stop.cmd` ends whatever
`start.cmd` or `dev.cmd` left listening on ports 8742 and 5273, and leaves any other program on those ports alone.

### Connect your real Claude Code agents (one time)

```bat
python scripts\install_hooks.py          # add the capture hook to %USERPROFILE%\.claude\settings.json
python scripts\install_hooks.py --status # check
python scripts\install_hooks.py --uninstall
```

The installer is **additive** (your Agent HQ, Orca and OpenLIT hooks are untouched), **idempotent**, and writes a
timestamped backup (`settings.json.bak-imperial-*`) before every change. New Claude Code sessions report to the
base from then on; already-running sessions pick the hook up when restarted.

> Not installed by the build itself: changing your global Claude Code settings is your decision. Until you run
> the installer the base still runs (aircraft, personnel, facilities) and shows *HOOK NOT INSTALLED*.
>
> To try it without touching global settings, pass the hook for one session only:
> `claude --settings <file-with-the-hooks-block.json>` (see AGENT_INTEGRATION.md).

### Development mode

```bat
dev.cmd      :: backend with --reload on :8742 + Vite hot reload on http://127.0.0.1:5273
test.cmd     :: pytest + vitest + typecheck
```

Asset previews: `http://127.0.0.1:5273/?preview=aircraft` and `?preview=personnel`.

After changing frontend code, rebuild for `start.cmd`: `cd frontend && npx vite build`.

---

## Controls

| Key / action | Effect |
|---|---|
| `1` Exterior | Free orbit camera (drag orbit, right-drag pan, wheel zoom) |
| `2` Tactical | Top-down overview with building labels, agent beacons, aircraft |
| `3` First-person | Click to lock mouse, `WASD` move, `Shift` run, `E` enter/exit buildings at doors, `Esc` release |
| `4` Third-person | Controllable commander avatar, `WASD`, drag to turn camera, wheel zoom, `E` at doors |
| `5` Cinematic | Automated tours (flyover, shuttle arrival, hangar, command chamber, server bunker, agent activity) |
| `H` / `L` | Hide HUD / toggle building labels |
| `N` | Cycle time of day: golden hour → dusk → night (remembered) |
| `S` or 🔊 SOUND button | Sound on/off (+ volume slider). Off by default; remembered per browser |
| Click | Agents, aircraft and building labels open the inspector; *Follow* attaches the camera |

**Air Control tab** (simulation): trigger shuttle arrival / clear departure, auto-depart toggle, launch / recall
TIE patrols, simulate an X-wing flyby (interceptors pursue when patrols are up), hangar doors auto/open/closed,
follow any aircraft.

The same tab stages the **impounded freighter's escape** from Pad 3, follows the **heavy walker** on its perimeter
patrol, and opens the **lightsaber duel** on Pad 2. Every X-wing flyby now ends with a picket TIE being shot down.

**Needs you**: when an agent waits for a permission or a turn fails, a banner and a pulsing top-bar pill appear and
the browser tab title changes; click either to jump to that agent.

**Facilities tab**: view, enter, or walk into Command, Hangar, Intelligence, Engineering, Operations, AI Labs,
Security and the underground Server Bunker; start any cinematic tour.

**Quality**: LOW / MEDIUM (default) / HIGH / CINEMATIC selector in the top bar (remembered per browser).

---

## What is real and what is simulated

| Real (from Claude Code and Cursor hook events) | Simulated scenery |
|---|---|
| Agents, sessions, subagents, parent/child delegation | Shuttle, TIE fighters, X-wing, interceptors, the shoot-down |
| Status, active tool, tool target (sanitised), errors | Impounded freighter, heavy walker, lightsaber duel |
| Permission waits and failed turns ("needs you") | Decorative personnel (troopers, crew, officers…) |
| Assignments (prompt / delegation description excerpts) | Hangar doors, beacons, dust |
| Task history, completion summaries | |
| Token usage + model id (read from transcript usage counters after a turn) | |
| Host CPU / memory / GPU-availability / Docker status (bunker wall) | |

Real agents wear black uniforms with gold epaulettes, stand on a pulsing status ring, carry a **● LIVE AGENT**
nameplate and appear in the roster. Decorative personnel have none of these. Feed items are tagged
**AGENT** or **SIM**. If an agent has had no event for 15 minutes its activity is shown as
*unknown — last confirmed event: …* rather than guessed.

---

## Documentation

| File | Contents |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, data flow, process model |
| [AGENT_INTEGRATION.md](AGENT_INTEGRATION.md) | Hook capture, privacy, lifecycle mapping, department assignment |
| [EVENT_SCHEMA.md](EVENT_SCHEMA.md) | Validated runtime hook schema + the sanitised record format + API |
| [AIRCRAFT_SIMULATION.md](AIRCRAFT_SIMULATION.md) | Flight paths, landing sequence, patrols, clearance guarantees |
| [WORLD_DESIGN.md](WORLD_DESIGN.md) | Planet, terrain, layout, art direction |
| [DEPARTMENT_DESIGN.md](DEPARTMENT_DESIGN.md) | Every facility and interior, station → tool mapping |
| [PERFORMANCE.md](PERFORMANCE.md) | Budgets, presets, measurements |
| [TESTING.md](TESTING.md) | Test suites and what was verified how |
| [SKILL_INVENTORY.md](SKILL_INVENTORY.md) | Capability assessment, skills/agents used |
| [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) | Definition-of-done checklist, known limitations |

## Boundaries

Imperial Base is standalone. It does not modify Hermes Mission Control, TRON, CAOS, DeepSeek, TradingBOT,
OpenLIT or Agent HQ, and it does not orchestrate anything: it is **observation-only**
(`GET /api/commands` reports `enabled: false`).

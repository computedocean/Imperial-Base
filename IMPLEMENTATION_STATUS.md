# Implementation status

Legend: ✅ implemented and verified · 🟡 implemented, partially verified / simplified · ❌ not implemented

## Definition of done

| # | Requirement | Status | Evidence / notes |
|---|---|---|---|
| 1 | Explorable planetary Imperial base | ✅ | 14 km terrain, mountains, valley, settlements, perimeter, 11 facilities; screenshots |
| 2 | Multiple detailed military buildings | ✅ | each facility has its own silhouette/accents (WORLD_DESIGN.md) |
| 3 | Impressive central command HQ | ✅ | stepped citadel + T-bridge; bridge interior with live holo table over the real base |
| 4 | Large functional hangar | ✅ | 130 × 210 m, walkable, animated great doors, racks, parked fighters that launch/return |
| 5 | Shuttle arrival | ✅ | approach spline with decel + banking; screenshot on approach |
| 6 | Shuttle landing sequence | ✅ | wings fold, gear deploys, ramp lowers, ground crew; state-machine tests + screenshot on pad |
| 7 | Shuttle departure | ✅ | liftoff + climb-out to hyperspace; unit-tested |
| 8 | TIE patrols | ✅ | 2 formations, launch from hangar, recall; tests |
| 9 | X-wing flyby | ✅ | eastern valley pass, S-foils, alert, interceptor pursuit |
| 10 | Multiple camera modes | ✅ | exterior, tactical, first, third, follow, 6 cinematic tours |
| 11 | First-person exploration | ✅ | WASD + pointer lock, collision, enter/exit at doors (pointer-lock look not testable headless) |
| 12 | Living personnel | ✅ | 50–200 instanced personnel, 8 uniforms, 6 behaviours + interior crews |
| 13 | Real Claude Code event ingestion | ✅ | verified with real headless sessions |
| 14 | Real agents as identifiable characters | ✅ | distinct uniform, status ring, LIVE AGENT nameplate |
| 15 | Agents move on actual events | ✅ | station chosen from real active tool / status; walk on spawn/change/exit |
| 16 | Agent inspection panels | ✅ | status, activity, model, session, parent, assignment, tool, tasks, events, errors, duration, tokens |
| 17 | Real task and session info | ✅ | ORDERS / REPORT / DELEGATION tasks, sessions API |
| 18 | Tactical overview | ✅ | top-down mode + holo tactical table |
| 19 | Command interface for observation | ✅ | roster tree, missions, raw events, air control, facilities, feed |
| 20 | Reliable local Windows operation | 🟡 | runs on this Windows machine (backend + built app served on :8742); `start.cmd` reviewed but not executed by the build session |

## Facilities

Command ✅ · Hangar ✅ · Intelligence ✅ · Engineering ✅ · Operations ✅ · AI Research ✅ · Security ✅ ·
Server Bunker ✅ (live CPU/memory/GPU-availability/Docker wall) · Quarters 🟡 (exterior + medical wing, no interior) ·
Perimeter ✅ (walls, towers, gates, checkpoints, AA emplacements, wall patrols) ·
Landing & Transport ✅ (main elevated platform, 2 pads, depot, cargo yard, moving repulsor vehicles).

## Added since first delivery

* ✅ Synthesised positional sound with Doppler for TIEs, shuttle (incl. gear/ramp/touchdown), X-wing, klaxon,
  hangar doors, wind and interior ambience (see AIRCRAFT_SIMULATION.md → Sound).
* ✅ HUD motion via `motion` (Framer Motion, MIT): panels/top bar/feed slide in and out with H, sliding tab and
  camera-mode indicators, panel cross-fade, inspector enter/exit, agent/mission/feed rows animate in, alert and
  door prompts animate. `MotionConfig reducedMotion="user"` honours the OS reduced-motion setting.
* ✅ HUD polish (UI/UX Pro Max review): SVG icons instead of emoji, visible keyboard focus, aria roles/labels on
  tabs, toggles and sliders, larger minimum text sizes, gold corner-bracket panel frames, local clock + missions-in-progress
  counter, Esc closes the inspector, fonts bundled locally (@fontsource, OFL) so the HUD works offline.
* ✅ Rendering upgrade: time of day (golden hour / dusk / night, `N` cycles, persisted; store `timeOfDay`,
  `setTimeOfDay`, `cycleTimeOfDay`) driving sun/moon, hemisphere fill, fog, exposure, sky dome (fbm cirrus,
  stars, galactic band) and a PMREM environment map baked from the procedural sky; view-following soft
  shadows with texel-snapped frustum and texel-scaled bias; textured ferrocrete apron (12 m slab seams with
  normal + roughness maps, plus a base-wide macro layer: contact grime at building feet, pad/hangar scorch,
  exhaust streaks, tyre arcs, painted door hatching, taxi line, red pad borders, wind-blown sand at the walls);
  sand-ripple normals on the desert; normal maps on all building panel/concrete materials; lamp light pools
  at dusk/night; soft dust sprites; post stack per preset (SMAA, bloom, grade, ACES, vignette; N8AO on
  High/Cinematic). See PERFORMANCE.md.

* ✅ Ground vehicles (`src/vehicles/`): 4 original repulsor designs (cargo hauler, patrol speeder, fuel tender,
  troop carrier) on 6 routes — apron ⇄ depot, plaza patrol loop, security run, fuel run to pad 2, quarters ⇄
  operations, and a 3-vehicle supply convoy out of the east gate to Kel-Dorr. Corner-filleted routes, curvature
  + junction speed limits, accel/brake profile, hover bob, banking, slope pitch on the outpost road. Gate booms
  lift for approaching vehicles; checkpoint booths moved off the roadway. 6 vehicles on LOW, 9 on MEDIUM+.
  Tests: routes clear every footprint/pad, leave the wall only at a gate, continuous speed profile, convoy spacing.
* ✅ Roadside dressing: instanced lamp pylons with emissive heads, centre-line dashes, crate stacks and jersey
  barriers (depot yard, hangar apron, security chicane) — 5 draw calls; vehicles 8 draw calls + 6 for the booms.

* ✅ Blender hero models (tools/blender, original designs): command citadel (podium tiers with recessed lit window
  bands, ledges, diagonal buttress fins, slotted tower, stepped entrance with canopy) + separate command-bridge crown
  (octagonal-section T bridge, glazing, lattice mast, sensor dishes), and the hangar outer shell (pilasters,
  clerestory band, stepped door header, skylit spine, roof control booth). Baked AO (Cycles) in a second UV set;
  materials re-bound to the shared palette. Procedural kit remains the LOW-quality / loading fallback.

## Added 2026-11-10

Reliability and accuracy of the agent link:

* ✅ **Backlog no longer crashes the page.** After downtime the backend ingests the spool quietly in 1 MB chunks
  and sends one snapshot, instead of one WebSocket message per old event (which hit React's update-depth limit).
  The browser also applies live events in 50 ms batches, and old events never appear in the feed as "0s ago".
* ✅ **No lost or duplicated events.** Events and the spool read offset are committed in one transaction. Lines
  still unread in a rotated `events.jsonl.<ms>.old` file are drained before the new spool is read.
* ✅ **Honest head-count.** The top bar shows `N NEED YOU · N WORKING · N STANDBY` from one shared rule
  (`frontend/src/agents/liveness.ts`). Sessions that were opened but never prompted and never used a tool drop
  off the roster after 15 minutes; before, they were counted as active for 12 hours.
* ✅ **Attention alerts.** An agent waiting for a permission, or whose turn failed, raises a banner, a pulsing
  top-bar pill, a roster filter ("Needs you") and a browser-tab title such as `(1 need you · 2 working)`.
  `PermissionRequest` events now set the *waiting* status.
* ✅ **Cursor sessions are understood.** Cursor fires the same hook with camelCase event names
  (`beforeSubmitPrompt`, `preToolUse`, `stop` …). They are mapped to the Claude Code names in the hook and in the
  reducer (so already-stored events replay correctly) and those agents carry a `CURSOR` tag.
* ✅ Roster: day statistics strip (sessions, subagents, missions, tool calls, errors, tokens), busy agents sorted
  first, double-click a row to follow; feed lines about an agent are clickable.
* ✅ HUD fits narrow windows (two-row top bar under 1180 px, full-width panels under 760 px). Returning from
  Tactical to Exterior restores the establishing shot instead of leaving the camera looking straight down.
* ✅ `start.cmd` rebuilds the frontend whenever sources are newer than `dist` (`scripts/frontend_stale.py`).

New scenery (all simulated, all original geometry):

* ✅ **Impounded freighter** (Falcon-inspired, `aircraft/models/Freighter.tsx`, `aircraft/freighter.ts`): parked on
  Secondary Pad 3 on its landing gear; every few minutes (or on command) it breaks free, runs the southern apron,
  escapes through the eastern valley, and is later escorted back and lands. Alert banner, feed lines, engine sound.
* ✅ **Heavy assault walker** (AT-AT-inspired, `vehicles/Walker.tsx`, `vehicles/walkerGait.ts`): circles the base
  outside the wall. Lateral-sequence gait with two-bone leg IK; planted feet are exactly stationary (unit-tested).
* ✅ **Shoot-down** during the X-wing flyby (`aircraft/Combat.tsx`, `XWING_KILL` in `flight.ts`): a picket TIE closes
  head-on, the X-wing opens fire, the TIE explodes (flash, fireball, smoke, tumbling wreckage that lands), and the
  X-wing flies through the debris. Cannon and explosion sounds arrive late with distance.
* ✅ **Lightsaber duel** on Secondary Pad 2 (`personnel/Duel.tsx`, `personnel/duelMoves.ts`, `personnel/footwork.ts`):
  a tan-robed master against his dark-robed apprentice, both with blue blades, staged as a 43-second sparring
  round that repeats elsewhere on the pad: face-off and ignition, circling in, the apprentice attacking while the
  master gives ground, a blade lock face to face, a break, the master pressing, the apprentice spinning and
  leaping, a disarm (the saber tumbles to the deck and goes dark), the master holding his blade on him, and the
  saber flying back to its owner. The figures have faces, legs and boots; planted feet stay put and step.
  Cinematic tour *Lightsaber duel*; label `DUEL · PAD 2` is clickable.

Not verified on 2026-11-10: real-GPU frame rate with the new scenery (the preview pane was throttled while
testing), the new sounds by ear, and `start.cmd` end to end (its stale-build check was run on its own).

## Known limitations

* **Hook not installed globally yet.** Run `python scripts\install_hooks.py` once (see README). Until then
  only sessions started with the hook via `--settings` report to the base.
* Ground vehicles follow fixed scripted routes (simulation scenery, not tied to agent activity) and do not
  avoid personnel; the shuttle's ground crew is personnel only.
* Personnel do not avoid each other (lane offsets prevent stacking only); agents walk straight lines inside
  rooms and can pass through furniture edges.
* Building interiors other than the listed eight are not modelled (quarters, transport).
* Character detail: lab-coat skirt is rigid; hands are simple.
* `PostToolUseFailure` / `StopFailure` / `Notification` handled per documentation but not yet observed live.
* Token usage appears after a turn (Stop/SubagentStop) — mid-turn usage is not reported by hooks.
* Agents from sessions without SessionEnd (killed terminals) become *stale* after 15 min and are hidden after 12 h.
* Real-GPU FPS not measured in this environment.
* Observation-only: no command dispatch to agents (by design).
* Cursor agents report status, tools and prompts, but not token usage (Cursor's counters are not verified).
* The walker and the duellists do not react to vehicles or personnel crossing their path.
* The picket TIE appears at range without a launch sequence; interceptors still only chase.

## Repository state

`C:\Projects\Imperial-Base` is a fresh git repository (`git init`), **no commits made** — commit when you are
happy with it. `.gitignore` excludes `node_modules`, `dist`, `.venv` and `backend/data` (the SQLite database).

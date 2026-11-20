# Aircraft simulation

Environmental simulation only — aircraft are scenery, never telemetry and never AI agents. The UI labels them
"SIMULATED AIRCRAFT" and tags their feed items **SIM**. They run independently of the backend.

Code: `frontend/src/aircraft/flight.ts` (pure, deterministic, unit-tested), `sim/world.ts` (hub + commands),
`aircraft/AircraftLayer.tsx` (rendering), `aircraft/models/*` (original procedural models).

## Models (original procedural geometry, nose +Z, metres)

| Model | Size | Animated parts | Draw calls / tris |
|---|---|---|---|
| Shuttle (Lambda-inspired) | 20 m long, 21.5 m tall wings folded | wingFold (flight 38° down ↔ landing 7° off vertical), gear (retract 2.15 m), boarding ramp, thrust glow, blinking nav lights | ~18 / ~4.0k |
| TIE-inspired fighter | 7 m span, 6.2 m wings | thrust glow | ~6 / ~4.6k |
| X-wing-inspired fighter | 12.5 m long, 11.4 m span | S-foils (closed ↔ 13° X), thrust glow | ~26 / ~5.1k |

## Flight model

* `FlightPath`: centripetal Catmull-Rom spline, arc-length parameterised (`getPointAt`) for constant ground
  speed, with a **coordinated-turn bank angle** `atan(v·ψ̇ / g)` computed from the heading change rate
  (clamped per aircraft). `orient()` builds the attitude from the tangent, with optional pitch damping (the
  shuttle stays near-level on descent).
* `clearSpline()` iteratively raises control points until the *interpolated* curve — not just the control
  points — clears the terrain by a margin. `liftAboveTerrain()` samples a ring of radius 260 m around each point.
* All routes are tested to stay outside every building's bounding box (+12 m margin) and above terrain
  (shuttle ≥ 40 m, patrols ≥ 80 m, X-wing ≥ 100 m) — see `flight.test.ts`.

## Shuttle sequence (`ShuttleSim`)

| Phase | Duration | What happens |
|---|---|---|
| away | — | not visible (deep-space holding) |
| approach | 42 s | from 2.6 km out / ~950 m up over the south-west mountains, decelerating (ease-out), banking in turns, aligning with the pad heading over the last 25 % |
| descent | 16 s | vertical from 46 m hover to the Main Landing Platform (y = 7 m), wings fold up (0.5–7 s), gear deploys (6–11 s), thrust tapers |
| landed | until departure | boarding ramp lowers (2–6 s), engines idle, ground crew (4–6) walk up and inspect around the pad |
| liftoff | 14 s | ramp up, vertical climb to 60 m, gear retracts, wings unfold, yaw to the departure heading |
| climbout | 30 s | accelerating (ease-in) climb north-west over the quarters to 4.3 km out, then "jumps to hyperspace" |

Commands: **Trigger arrival** (valid only when away), **Clear departure** (only on the pad), auto-depart after
45 s (toggle). Invalid commands are refused with a feed message. On page load a shuttle is called in after 4 s.

## TIE patrols (`PatrolSim`)

* Onyx flight (3, V-formation) on the inner ring (~680 m radius, ~150 m altitude, 72 m/s); Sable element (2) on
  the outer ring (~1.25 km, ~300 m, 95 m/s, opposite direction). Followers fly the same path a few tens of metres
  behind with lateral offsets in the path frame, smoothing their bank.
* **Launch**: fighters leave the hangar one by one (3.2 s apart) through the great doors, climb over the apron and
  join their ring. **Recall**: each flies a recovery path (continue forward, climb, then the hangar approach in
  reverse) and parks; parked fighters reappear on the hangar floor racks.
* Hangar doors open automatically while fighters transit (or force open/closed).

## X-wing flyby (`XWingSim`)

A 48 s high-speed pass through the eastern valley, ~1.2–3.4 km from the base and visible from the command
bridge and exterior cameras. S-foils open to attack position mid-pass and close before exit. Triggers an
"UNIDENTIFIED CONTACT" alert. If patrols are active, an **interceptor pair** pursues along the same path
6 s behind. First flyby happens automatically ~75 s after load.

## Cameras

Follow any aircraft (Air Control tab or click it), the *Shuttle arrival* tour (tracks the approach from a
distance, then switches to a pad-side camera for descent/landing/liftoff), the *Hangar* tour and the command
bridge (clear glass overlooking the pad).

## Sound (`frontend/src/audio/engine.ts`)

All sounds are **synthesised live with the Web Audio API** — no recordings, so nothing copyrighted is used.

Version 3 (after user feedback that v1/v2 sounded awful) follows these rules: engines are built from **filtered
noise** (how real engines sound) instead of buzzy sawtooth/square waves; **no distortion**; tonal layers are soft
(sine/triangle, low-passed) and only come forward on close passes; fighters fall silent beyond ~2.2 km so there is
no permanent whining chorus; no mains-hum drones; alerts use soft triangle tones.

| Source | Synthesis | Behaviour |
|---|---|---|
| TIE fighters | pink-noise roar (band-pass ~700 Hz) + an airy resonant whistle (white noise through two cascaded narrow band-passes ~1.5 kHz) + a soft triangle "cry" with gentle vibrato near the pass | positional, Doppler-shifted, whistle and cry swell on close passes, silent beyond ~2.2 km |
| Shuttle | brown-noise rumble, breathy pink-noise mid layer, two low sines with a slow swell; all follow thrust | positional + Doppler; one-shots: smooth gear servo + clunk, ramp hydraulic hiss, touchdown thump |
| X-wing | pink-noise jet roar + brown-noise body + soft high whistle | positional + Doppler |
| Alert | soft two-tone triangle chime | when the flyby starts |
| Hangar doors | deep rolling rumble while moving, soft thud on stop | positional |
| Ambience | desert wind with gusts; indoors soft air handling, server-hall whoosh in the bunker; outdoors muffled inside buildings | |

**Controls:** 🔊 SOUND button or `S` (off by default; browsers need a click first), master volume slider in the
top bar, and in **Air Control → Sound**: Engines / Wind & ambience / Effects & alerts sliders plus preview
buttons (TIE flyby, X-wing flyby, Shuttle engines, Alert tone) to audition each sound on its own. Settings are
remembered per browser.

Measured in-browser (RMS / peak): wind 0.05 / 0.20; TIE preview approaching 0.05, at the pass 0.11 / 0.38;
shuttle 0.10 / 0.28; alert 0.08 / 0.21 — balanced, no clipping. Diagnostics: `window.__imperialAudio()`.

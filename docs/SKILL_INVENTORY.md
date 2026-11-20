# Build notes: initial capability assessment

> **Historical record.** This is the assessment made at the start of the project (2026-11-04). Several
> limits listed here were lifted later: Blender was installed and now builds the 3D models (`tools/blender/`),
> and photo-scanned CC0 assets are used for desert rocks. See [Implementation status](IMPLEMENTATION_STATUS.md)
> for the current state.

## Environment

| Capability | Status |
|---|---|
| Claude Code | 2.1.318 — hooks available (SessionStart … SessionEnd, Subagent*, Pre/PostToolUse*, Stop*, Notification) |
| Node.js / npm | 24.20 / 12.2 |
| Python | 3.12.10 (project venv in `backend/.venv`) |
| Playwright | 1.64 with Chromium headless shell installed (used for browser QA) |
| Blender | **not installed** → all assets are procedural three.js geometry |
| GPU | Intel(R) Graphics (integrated); no `nvidia-smi` → GPU utilisation reported as unavailable |
| Docker | CLI present (only read via `docker ps` for the bunker display; never started) |
| Existing hooks | Hooks from other tools — left untouched |

## Skills available (relevant subset of ~150 installed)

3D / game: `react-three-fiber`, `threejs-react-three-fiber`, `threejs-fundamentals`, `threejs-geometry`,
`threejs-materials`, `threejs-lighting`, `threejs-textures`, `threejs-shaders`, `threejs-animation`,
`threejs-performance`, `threejs-postprocessing`, `threejs-loaders`, `threejs-asset-pipeline`,
`threejs-interaction`, `threejs-webgl`, `babylonjs-engine`, `playcanvas-engine`, `aframe-webxr`,
`blender-web-pipeline`, `polyhaven`, `substance-3d-texturing`, `web3d-integration-patterns`.
UI: `frontend-design`, `modern-web-design`, `motion-framer`, `gsap-*`, `animated-component-libraries`.
Process: `superpowers:*` (brainstorming, writing-plans, TDD, verification-before-completion, dispatching-parallel-agents),
`engineering:*` (architecture, testing-strategy, documentation), `code-review`, `security-review`.
QA: `playwright-cli`, `claude-in-chrome`, `run`.
Agents: `general-purpose`, `Explore`, `Plan`, `claude-code-guide` (no custom agent definitions in `~/.claude/agents`).
MCP: Claude Docs, Google Workspace, Microsoft Learn, Remote Desktop Commander and others (none needed);
`clairvoyance_terminal` and `plugin:data:definite` failed to connect (not needed).

## Selected and how they were used

| Skill / capability | Why | How |
|---|---|---|
| `react-three-fiber` | stack choice (React + R3F) | Canvas setup, declarative scene graph, `useFrame` loops, events |
| `threejs-performance` | 16 GB / iGPU target | "Draw Calls" guidance → merged building kits, instanced crowd, shared materials, renderer.info measurement |
| `playwright-cli` / Playwright | automated browser QA | scripted runs + screenshots reviewed visually; renderer stats per preset |
| `general-purpose` subagents (×2, parallel) | independent, well-bounded asset work | (1) aircraft models + preview, (2) character rig, instanced crowd, crowd sim, hero character + tests. Both briefed with exact props/conventions; integration and review done centrally |
| Claude Code hooks (runtime) | the only supported local event source | capture hook + schema validation with real headless sessions |
| `superpowers` verification discipline | "do not claim untested functionality" | every phase verified with tests or screenshots before moving on |

Considered and not used: `blender-web-pipeline` (Blender absent), `polyhaven`/`substance-3d-texturing` (would
need downloaded third-party assets; procedural textures keep everything original and offline),
`babylonjs`/`playcanvas` (R3F preferred by the brief), OpenTelemetry (hooks give richer per-agent lifecycle
without running a collector).

## Unavailable / limited

* No Blender → no GLB authoring pipeline; models are code-generated (documented in AIRCRAFT_SIMULATION.md).
* No real GPU in the QA browser → frame rates not measured (PERFORMANCE.md).
* Modifying global `~/.claude/settings.json` was blocked by the session's permission classifier → the hook
  installer is provided for the user to run.

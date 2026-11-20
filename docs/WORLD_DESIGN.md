# World design

## Setting

**Ketrax Prime**, Outer Rim — Varrak Expanse. A rust-and-ochre desert world at golden hour under twin suns, with a
ringed gas giant hanging over the eastern mountains. **Imperial Garrison Aurek-9** sits on a levelled plateau;
a valley road leads east to *Mining Outpost Kel-Dorr*; a moisture-farm cluster and *Relay Station Nyx* sit far
out in the haze. All names are original.

## Terrain (`world/layout.ts → terrainHeight`, `world/Terrain.tsx`)

* 14 × 14 km. One deterministic height function shared by rendering, flight-path clearance, road placement
  and tests: flat plateau (r < 560 m) → dunes → rising mesa shelf (0.9–2.2 km) → ridged-multifractal mountain
  ranges (from 1.6 km, up to ~900 m), with a valley opening to the east.
* A centre-dense warped grid (exponent 1.8): metre-scale detail inside the base, coarse at the horizon. Vertex
  colours by slope/height/noise + a tiled grain texture. `terrainSampler.ts` returns the height of the
  *rendered* triangles so roads and settlements sit exactly on the visible surface.
* Exponential haze matched to the horizon colour; ~450 instanced boulders; airborne dust (Medium+).

## Installation layout (metres, +Z north-ish, origin = Command Citadel)

| Facility | Centre | Footprint | Height |
|---|---|---|---|
| Imperial Command Citadel | 0, 0 | 96 × 96 | 118 (antennae 163) |
| Starship Hangar Alpha | −270, 20 | 130 × 210 | 52 |
| Main Landing Platform | −125, 20 | r 34, deck at 7 m | |
| Secondary pads 2 / 3 | −135, −120 / −135, 160 | r 18 | |
| Intelligence Division | 200, −95 | 92 × 70 | 36 (+ sensor tower) |
| Engineering Division | 200, 105 | 104 × 82 | 30 |
| Operations Center | 10, 215 | 96 × 62 (hex) | 28 (+ holo rings) |
| AI Research Labs | −70, −225 | 84 × 72 | domes |
| Security Operations Center | 315, −265 | 56 × 56 | 24 (+ turret) |
| Server Bunker (surface) | 105, −230 | 46 × 34 | 9; hall 16 m below |
| Personnel Quarters + medical wing | −250, 280 | 120 × 64 | 24 |
| Transport & Vehicle Complex | 300, 290 | 90 × 64 | 16 (+ cargo yard, crane) |
| Perimeter | octagon r 470 | 14 m walls, 8 guard towers, east & north gates with checkpoints, 8 AA emplacements | |

Roads link the hub, apron, gates and every door (`ROADS`); a separate walk graph (`NAV_NODES/EDGES`) drives
personnel. The perimeter wall top is a patrol walkway.

## Art direction

Gunmetal and pale-grey panel plating (procedural plate/seam/rivet/vent texture), concrete slab, warm window bands,
**red** blinking beacons, **amber** service and warning strips, restrained **blue** holograms — no neon overload.
Golden-hour key light with long shadows, cool hemisphere fill, a soft generated environment map for metals,
AgX tone mapping followed by a generated colour-grade LUT (`world/grade.ts`), bloom + vignette, and nested sun
shadow cascades fitted to the camera's focus (`world/sunCascades.ts`). Every building has a silhouette of its own (stepped
citadel with T-shaped bridge, ribbed engineering block, hex operations hall with holo rings, dome cluster,
fortified security block with turret, vent stacks over the bunker).

## Personnel

~50–200 decorative personnel (by preset) in eight uniforms (officer, trooper, engineer, technician, scientist,
pilot, ground crew, analyst): walkers on the road graph who enter and leave buildings, wall patrols, gate
guards, officer groups talking, apron crew and the shuttle ground team. Each has its own phase, stride and idle
style. Interiors have their own crew at a subset of stations plus an entry sentry. Real agents are visually
distinct (see AGENT_INTEGRATION.md).

## Motor pool and roadside dressing

Ground traffic lives in `frontend/src/vehicles/`. Routes (`routes.ts`) are hand-placed polylines over open
roads and plaza (never across a footprint or pad — enforced by `routes.test.ts`), filleted and resampled every
metre with a precomputed speed profile. Vehicle designs (`models.ts`) are original: a two-module cargo hauler,
a wedge patrol speeder with bubble canopy, a fuel tender with hazard-banded tank, and an armoured troop carrier
with a roof turret. Each type is one vertex-coloured body + one glow geometry, instanced. The outpost-road
control points are shared (`OUTPOST_ROAD` in `layout.ts`) so the convoy follows the rendered road and terrain.
Lamps, dashes, crates and barriers are placed by `propPlacement.ts` (pure, tested) and drawn by `RoadProps.tsx`.

## Blender hero models

The command citadel (`citadel.glb` + `citadel_crown.glb`) and the hangar shell (`hangar.glb`) are scripted Blender
builds (`tools/blender/`), kept inside the exact envelope of the procedural versions (citadel 96 × 96 m, tower to
101.5 m, bridge 102–121.5 m, masts to 163 m; hangar x −335…−205, z −85…125, 52 m). Nothing on the hangar's east face
protrudes below the 38 m door header, so the animated great doors slide freely. Materials are bound by name to the
shared palette (`materials.ts`) and a baked AO map (UV1) darkens crevices; on LOW quality the procedural kit is used.

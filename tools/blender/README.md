# Blender hero models

Scripted, reproducible Blender 5.2 builds of the base's hero buildings (original designs). Each script builds the
geometry with `bkit.py`, unwraps a lightmap UV, bakes ambient occlusion (Cycles CPU) and exports a GLB plus an
`_ao.jpg` into `frontend/public/models/`. Three.js (`src/world/HeroModels.tsx`) re-binds materials by name to the
shared palette, applies the baked AO, and falls back to the procedural kit on LOW quality or if a file is missing.

```
set B="C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
%B% -b --factory-startup -P tools/blender/citadel.py -- --out frontend/public/models --samples 64 --size 2048
%B% -b --factory-startup -P tools/blender/hangar.py  -- --out frontend/public/models --samples 64 --size 2048
```
Add `--preview <dir>` to also render an Eevee preview PNG. Then rebuild the frontend (`npx vite build`).

## Ship models

`destroyer.py` and `freighter.py` build the Star Destroyer and the light freighter the same way. They are modelled
around their own centre with the bow towards +Z, so they drop straight into the matching React component, which
loads them through `frontend/src/aircraft/models/Baked.tsx` and keeps the code-built version as the fallback
(while loading, on LOW quality, or if the file is missing).

```
set B="C:\Program Files\Blender Foundation\Blender 5.3\blender.exe"
%B% -b --factory-startup -P tools/blender/destroyer.py -- --out frontend/public/models --samples 40 --size 2048
%B% -b --factory-startup -P tools/blender/freighter.py -- --out frontend/public/models --samples 48 --size 2048
```
`--size 1024 --samples 12` gives a quick draft in under half a minute. `bkit.py` gained `lathe_z`, `sphere` and
`hull_z` for these (bodies of revolution and hulls lofted along the ship's length).


## Gunship, walker and sail barge

`gunship.py`, `walker.py` and `sailbarge.py` follow the same pattern. The walker is posed in code, so it is exported
as five GLBs (`walker_body`, `walker_head`, `walker_thigh`, `walker_shin`, `walker_foot`), each in the frame of the
code-built part it replaces and each with its own shadow map. The barge adds a `lamp` material for lanterns and lit
windows.

```
%B% -b --factory-startup -P tools/blender/gunship.py   -- --out frontend/public/models --samples 48 --size 2048
%B% -b --factory-startup -P tools/blender/walker.py    -- --out frontend/public/models --samples 48 --size 2048
%B% -b --factory-startup -P tools/blender/sailbarge.py -- --out frontend/public/models --samples 48 --size 2048
```
`bkit.py` gained `lathe` (solid of revolution about any axis; the profile may double back for intake lips and
nozzles), `tube` (round strut between two points) and `sheet` (thin skin through a grid of points, for sails).
Check the result in the app at `?preview=aircraft&focus=gunship` or `focus=barge`.

## Desert: mesas and boulders

`desert.py` generates three terraced mesas with the **A.N.T.Landscape** extension, bakes their ambient occlusion and
exports `mesa_a/b/c.glb`. It needs that extension enabled in Blender's preferences, so run it without
`--factory-startup` (or from the Scripting tab of an open Blender):

```
%B% -b -P tools/blender/desert.py -- --out frontend/public/models
```
The boulders (`rock_a/b/c.glb`) and the cliff texture (`cliff_diff.jpg`, `cliff_nor.jpg`) are Poly Haven CC0 assets
(namaqualand_boulder_05, namaqualand_boulder_03, boulder_01, marble_cliff_03), imported through the MCP for Blender
add-on, decimated to 1,500 triangles each and exported with colour and normal maps. `frontend/src/world/Desert.tsx`
places both.

## Shuttle, TIE fighter, X-wing and the ground vehicles

`shuttle.py`, `tie.py`, `xwing.py` and `vehicles.py` use the shared runner `bkit.run(tag, parts, tile, ...)`, which
builds each part, unwraps a lightmap, bakes ambient occlusion and exports `<name>.glb` + `<name>_ao.jpg`.

```
%B% -b --factory-startup -P tools/blender/tie.py      -- --out frontend/public/models
%B% -b --factory-startup -P tools/blender/xwing.py    -- --out frontend/public/models
%B% -b --factory-startup -P tools/blender/shuttle.py  -- --out frontend/public/models
%B% -b --factory-startup -P tools/blender/vehicles.py -- --out frontend/public/models
```
Parts that move in code are separate files in the frame of the part they replace: `xwing_body` + `xwing_wing` (one
wing, mirrored three times), `shuttle_body` + `shuttle_wing` (hinge frame). The shuttle's gear and ramp stay in code.
The vehicles (`veh_hauler`, `veh_speeder`, `veh_tender`, `veh_troop`) are merged by the app into one vertex-coloured
body and one glow geometry each, so they still draw as two instanced meshes per type.
`bkit.py` gained smooth shading on lofts and lathes, `ring` (hoops and collars) and `plate_zy` (fins and wings).

## Division buildings

`divisions.py` builds the eight division buildings (`div_intelligence`, `div_engineering`, `div_operations`,
`div_research`, `div_security`, `div_bunker`, `div_quarters`, `div_transport`) in world coordinates, from the
footprints in `frontend/src/world/layout.ts`. They share a small vocabulary defined at the top of the script
(`block`, `ledge`, `band`, `fins`, `parapet`, `clutter`, `doorway`, `mast`).

```
%B% -b --factory-startup -P tools/blender/divisions.py -- --out frontend/public/models
%B% -b --factory-startup -P tools/blender/divisions.py -- --out frontend/public/models --only security
```
`frontend/src/world/Structures.tsx` loads each through `Hero`, with the code-built building as the fallback.

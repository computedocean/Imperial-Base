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


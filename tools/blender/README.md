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

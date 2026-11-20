# Performance

Target: Windows PC, 16 GB RAM, **Intel integrated graphics** (the development machine's adapter).

## Presets (top-bar selector, persisted in localStorage)

| | Low | Medium (default) | High | Cinematic |
|---|---|---|---|---|
| Pixel ratio | 0.75 | 1.0 | 1.25 | 1.5 × 1.25 |
| Shadows | off | 1024² | 2048² | 4096² |
| Terrain grid | 160² | 256² | 384² | 512² |
| Decorative crowd | 50 | 100 | 150 | 200 |
| Boulders | 150 | 450 | 450 | 450 |
| Dust particles | 0 | 300 | 800 | 1500 |
| Soft shadows (PCF radius) | – | 2 | 2.5 | 3 |
| Post: SMAA + bloom + AgX tone map + LUT colour grade + vignette | – | ✓ | ✓ | ✓ |
| Post: N8AO ambient occlusion | – | – | ✓ (half-res) | ✓ (full-res) |
| Composer MSAA | – | – (SMAA) | – (SMAA) | 4× |
| Texture anisotropy | 2× | 4× | 8× | 16× |

## Measured (opening exterior view, renderer.info, headless Chromium)

| Preset | Draw calls | Triangles | Geometries | Textures | JS heap |
|---|---|---|---|---|---|
| Low | 247 | 139 k | 216 | 15 | ~23–31 MB |
| Low, shuttle pad close-up | 78 | 115 k | 158 | 15 | 31 MB |
| Medium (shadows on) | 379 | 346 k | 217 | 17 | ~23 MB |

`window.__imperialStats` now sums every render pass of a frame (shadow map, scene, post), so the numbers
below are whole-frame costs and are higher than the older scene-only Low/Medium figures above.

### Rendering upgrade (time of day, apron, post stack)

Opening exterior view, golden hour, whole frame (shadow pass + scene + post), headless Chromium. This build also
contains the Blender hero models (citadel, hangar) added in parallel, which account for most of the scene-call
growth since the table above; the rendering upgrade itself adds 1 call (apron) by day and 1 (lamp pools) at
dusk/night, plus the post passes.

| Preset | Draw calls / frame | Triangles / frame | Post |
|---|---|---|---|
| Low | 442 | 155 k | none |
| Medium | 776 | 421 k | SMAA + bloom (5 mips) + grade/ACES/vignette (≈ 15 passes) |
| High | 833 | 618 k | + N8AO (full-res, low quality) |

N8AO runs full-res because the half-res path of n8ao 2.0.1 crashes with three r187 (`setupRenderTarget`).

Startup: the procedural apron/normal-map textures cost ≈ 0.9 s of CPU once (headless measurement; cached
afterwards). The environment map is re-baked from the sky (PMREM, one cube render) only when the time of day
changes. Live numbers are always on `window.__imperialStats` (fps, calls, triangles, geometries, textures,
programs, heap).

**Not measured: real-GPU frame rate.** QA ran in headless Chromium with SwiftShader (software rendering, no
GPU), where frame rates of 2–12 fps say nothing about a real Intel iGPU. Please check FPS on your machine
(`window.__imperialStats.fps` in the browser console) and step down a preset if needed.

## Techniques

* **Merged static geometry** (`world/kit.ts`): each building is one mesh per material (≈4–8 draw calls).
* **Instanced crowd**: one InstancedMesh per body part → 12 draw calls for any head-count; matrices written in a
  single `useFrame` with no per-frame allocation; hidden members compacted out of the draw range.
* **Shared materials and textures**: lazy singletons; all textures are small generated CanvasTextures (≤1024²).
* **Aircraft**: ≤ 30 draw calls each, geometry built once per model type and shared by all instances; React
  re-renders only when quantised animation parameters change.
* **Only one interior is rendered** (the one you are in); sealed interiors also hide terrain, sky, exterior
  buildings and the exterior crowd.
* **Shadow frustum follows the area of interest** (snapped to avoid shimmering), sized by camera height.
* **Centre-dense terrain grid**: detail where you look, coarse at the horizon, hidden by haze.
* **Backend**: one process; the spool tail is one `os.stat` per 0.5 s when idle; host telemetry is sampled only
  while a browser is connected (every 5 s); Docker/GPU queries cached 30 s; no Docker, no extra services.
* **WebSocket**: push-based; the browser sends a keep-alive ping every 30 s and never polls the API in a loop.

## If it is slow

1. Switch to **Low** (no shadows, smaller canvas).
2. Hide the HUD (`H`) — DOM overlays cost a little on iGPUs.
3. Close other WebGL tabs. Chrome/Edge with hardware acceleration enabled is assumed.

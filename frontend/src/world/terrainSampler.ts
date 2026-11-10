// Height of the terrain *as rendered* (the triangulated warped grid), so props placed on it
// sit exactly on the visible surface instead of the analytic height function.
import { WORLD_SIZE, terrainHeight } from './layout'

const EXP = 1.8
const warp = (t: number) => Math.sign(t) * Math.pow(Math.abs(t), EXP)
const unwarp = (s: number) => Math.sign(s) * Math.pow(Math.abs(s), 1 / EXP)

export function makeTerrainSampler(segments: number) {
  const n = segments
  const half = WORLD_SIZE / 2
  const cache = new Map<number, number>()
  const vh = (i: number, j: number) => {
    const key = j * (n + 1) + i
    let h = cache.get(key)
    if (h === undefined) {
      h = terrainHeight(warp((i / n) * 2 - 1) * half, warp((j / n) * 2 - 1) * half)
      cache.set(key, h)
    }
    return h
  }
  const vx = (i: number) => warp((i / n) * 2 - 1) * half
  return (x: number, z: number) => {
    const fi = ((unwarp(Math.max(-1, Math.min(1, x / half))) + 1) / 2) * n
    const fj = ((unwarp(Math.max(-1, Math.min(1, z / half))) + 1) / 2) * n
    const i = Math.min(n - 1, Math.max(0, Math.floor(fi)))
    const j = Math.min(n - 1, Math.max(0, Math.floor(fj)))
    // local coords inside the (non-uniform) cell
    const u = (x - vx(i)) / (vx(i + 1) - vx(i))
    const v = (z - vx(j)) / (vx(j + 1) - vx(j))
    const a = vh(i, j), b = vh(i + 1, j), d = vh(i, j + 1), e = vh(i + 1, j + 1)
    // triangles (a,d,b) and (b,d,e) — matches Terrain.tsx index order
    if (u + v <= 1) return a + (b - a) * u + (d - a) * v
    return e + (d - e) * (1 - u) + (b - e) * (1 - v)
  }
}

import { describe, expect, it } from 'vitest'
import { FACILITIES, PADS, PERIMETER_RADIUS } from './layout'

const WALL_HALF_THICKNESS = 2.5
const APOTHEM = PERIMETER_RADIUS * Math.cos(Math.PI / 8)
// octagon vertices sit at 22.5° + k·45°, so the wall faces have normals at k·45°
const NORMALS = Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4)

/** Smallest distance from any footprint corner to the inner face of the perimeter wall (negative = through it). */
function wallClearance(x: number, z: number, sx: number, sz: number) {
  let min = Infinity
  for (const cx of [-1, 1]) for (const cz of [-1, 1]) {
    const px = x + (cx * sx) / 2
    const pz = z + (cz * sz) / 2
    for (const a of NORMALS) min = Math.min(min, APOTHEM - WALL_HALF_THICKNESS - (px * Math.cos(a) + pz * Math.sin(a)))
  }
  return min
}

describe('installation layout', () => {
  it('every building sits at least 15 m inside the perimeter wall', () => {
    for (const f of FACILITIES) {
      const c = wallClearance(f.x, f.z, f.sx, f.sz)
      expect(c, `${f.id} clearance ${c.toFixed(1)} m`).toBeGreaterThanOrEqual(15)
    }
  })
  it('landing pads are inside the wall', () => {
    for (const p of PADS) expect(wallClearance(p.x, p.z, p.radius * 2, p.radius * 2)).toBeGreaterThanOrEqual(15)
  })
  it('no two buildings overlap (≥ 8 m apart)', () => {
    for (let i = 0; i < FACILITIES.length; i++) {
      for (let j = i + 1; j < FACILITIES.length; j++) {
        const a = FACILITIES[i]
        const b = FACILITIES[j]
        const gapX = Math.abs(a.x - b.x) - (a.sx + b.sx) / 2
        const gapZ = Math.abs(a.z - b.z) - (a.sz + b.sz) / 2
        expect(Math.max(gapX, gapZ), `${a.id} vs ${b.id}`).toBeGreaterThanOrEqual(8)
      }
    }
  })
  it('doors sit on or just outside their building footprint', () => {
    for (const f of FACILITIES) {
      const dx = Math.abs(f.door[0] - f.x) - f.sx / 2
      const dz = Math.abs(f.door[1] - f.z) - f.sz / 2
      expect(Math.max(dx, dz), `${f.id} door`).toBeGreaterThanOrEqual(-3)
      expect(Math.max(dx, dz), `${f.id} door`).toBeLessThanOrEqual(12)
    }
  })
})

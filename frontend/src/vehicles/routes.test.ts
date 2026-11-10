import { describe, expect, it } from 'vitest'
import { FACILITIES, GATES, PADS } from '../world/layout'
import { Follower, ROUTE_DEFS, STEP, UNITS, buildRoute, insideWall, routes } from './routes'

const HALF_WIDTH = 3.5 // widest vehicle half-width + margin

function boxDistance(x: number, z: number, f: { x: number; z: number; sx: number; sz: number }) {
  const dx = Math.max(0, Math.abs(x - f.x) - f.sx / 2)
  const dz = Math.max(0, Math.abs(z - f.z) - f.sz / 2)
  return Math.hypot(dx, dz)
}

function nearGate(x: number, z: number) {
  return GATES.some((g) => Math.hypot(g.x - x, g.z - z) < 40)
}

describe('ground vehicle routes', () => {
  const R = routes()

  it('every route keeps clear of building footprints and landing pads', () => {
    for (const r of Object.values(R)) {
      for (let i = 0; i < r.x.length; i++) {
        const x = r.x[i]
        const z = r.z[i]
        for (const f of FACILITIES) {
          expect(boxDistance(x, z, f), `${r.id}@${i} (${x.toFixed(0)},${z.toFixed(0)}) vs ${f.id}`).toBeGreaterThan(HALF_WIDTH)
        }
        for (const p of PADS) {
          expect(Math.hypot(x - p.x, z - p.z), `${r.id}@${i} vs pad ${p.id}`).toBeGreaterThan(p.radius + HALF_WIDTH)
        }
      }
    }
  })

  it('stays inside the wall except through a gate', () => {
    for (const r of Object.values(R)) {
      let outside = false
      for (let i = 0; i < r.x.length; i++) {
        const inside = insideWall(r.x[i], r.z[i], 8)
        if (!inside && !outside) {
          // the first sample past the wall margin must be at a gate
          expect(nearGate(r.x[i], r.z[i]), `${r.id} leaves the base at (${r.x[i].toFixed(0)},${r.z[i].toFixed(0)})`).toBe(true)
          outside = true
        }
        if (inside) outside = false
      }
    }
  })

  it('speed profile is continuous: accel/brake within limits, zero at shuttle ends', () => {
    for (const d of ROUTE_DEFS) {
      const r = buildRoute(d)
      for (let i = 1; i < r.v.length; i++) {
        expect(Math.abs(r.v[i] ** 2 - r.v[i - 1] ** 2)).toBeLessThanOrEqual(2 * 2.2 * STEP + 1e-3)
      }
      if (!d.loop) {
        expect(r.v[0]).toBe(0)
        expect(r.v[r.v.length - 1]).toBe(0)
      }
      expect(Math.max(...r.v)).toBeLessThanOrEqual(Math.max(d.vIn, d.vOut ?? 0) + 1e-6)
    }
  })

  it('slows for junctions (corner speed well under the straight limit)', () => {
    const r = R['apron-depot']
    // slowest sample within 20 m of the [-175,190] corner
    let vCorner = Infinity
    for (let i = 0; i < r.x.length; i++) if (Math.hypot(r.x[i] + 175, r.z[i] - 190) < 20) vCorner = Math.min(vCorner, r.v[i])
    expect(vCorner).toBeLessThan(9)
    expect(Math.max(...r.v)).toBeCloseTo(11, 0)
  })

  it('a shuttle unit reaches both ends, dwells, and turns around', () => {
    const f = new Follower(R.fuel, { dwellA: 3, dwellB: 3 })
    let sawEnd = false
    let sawReturn = false
    for (let t = 0; t < 400; t += 0.05) {
      f.step(0.05)
      if (f.s >= R.fuel.length - 1e-6) sawEnd = true
      if (sawEnd && f.s <= 1e-6) sawReturn = true
    }
    expect(sawEnd && sawReturn).toBe(true)
  })

  it('convoy members keep their spacing and never stack', () => {
    const spec = UNITS.find((u) => u.id === 'convoy')!
    const f = new Follower(R[spec.route], { members: spec.types.length, gap: spec.gap, dwellA: 2, dwellB: 2 })
    for (let t = 0; t < 900; t += 0.1) {
      const poses = f.step(0.1)
      for (let i = 1; i < poses.length; i++) {
        expect(Math.hypot(poses[i].x - poses[i - 1].x, poses[i].z - poses[i - 1].z)).toBeGreaterThan(12)
      }
    }
  })
})

describe('roadside props', () => {
  it('lamps, dashes and blocks never stand on buildings, pads or vehicle routes', async () => {
    const { lampPlacements, dashPlacements, blockPlacements, clearSpot, routeDistance, roadEdgeDistance } = await import('./propPlacement')
    const lamps = lampPlacements()
    const blocks = blockPlacements()
    expect(lamps.length).toBeGreaterThan(20)
    expect(blocks.length).toBeGreaterThan(10)
    for (const l of lamps) {
      expect(clearSpot(l.x, l.z, 4)).toBe(true)
      expect(routeDistance(l.x, l.z)).toBeGreaterThanOrEqual(6)
      expect(roadEdgeDistance(l.x, l.z)).toBeGreaterThan(0)
    }
    for (const b of blocks) expect(routeDistance(b.x, b.z)).toBeGreaterThan(5)
    for (const d of dashPlacements()) expect(clearSpot(d.x, d.z, 2)).toBe(true)
  })
})

// Placement of roadside props (pure; tested). Lamps along every base road, centre-line dashes,
// barrier and crate clusters at the depot and hangar apron. Nothing may stand on a building
// footprint, a pad, another road, or a vehicle route.
import { FACILITIES, PADS, ROADS } from '../world/layout'
import { insideWall, routes } from './routes'

export interface Lamp { x: number; z: number; rotY: number }
export interface Dash { x: number; z: number; rotY: number; len: number }
export interface Block { x: number; z: number; rotY: number; sx: number; sy: number; sz: number; tint: number }

function boxDist(x: number, z: number, f: { x: number; z: number; sx: number; sz: number }) {
  return Math.hypot(Math.max(0, Math.abs(x - f.x) - f.sx / 2), Math.max(0, Math.abs(z - f.z) - f.sz / 2))
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax
  const dz = bz - az
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)))
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t))
}

/** distance from (x,z) to the nearest road edge (negative = on a road) */
export function roadEdgeDistance(x: number, z: number) {
  let best = Infinity
  for (const r of ROADS) for (let i = 0; i < r.pts.length - 1; i++) {
    const [a, b] = [r.pts[i], r.pts[i + 1]]
    best = Math.min(best, segDist(x, z, a[0], a[1], b[0], b[1]) - r.width / 2)
  }
  return best
}

/** distance from (x,z) to the nearest vehicle-route sample */
export function routeDistance(x: number, z: number) {
  let best = Infinity
  for (const r of Object.values(routes())) for (let i = 0; i < r.x.length; i += 2) best = Math.min(best, Math.hypot(r.x[i] - x, r.z[i] - z))
  return best
}

export function clearSpot(x: number, z: number, margin: number) {
  if (!insideWall(x, z, 12)) return false
  if (FACILITIES.some((f) => boxDist(x, z, f) < margin)) return false
  if (PADS.some((p) => Math.hypot(x - p.x, z - p.z) < p.radius + margin)) return false
  return true
}

export function lampPlacements(spacing = 34): Lamp[] {
  const out: Lamp[] = []
  for (const r of ROADS) {
    let side = 1
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i]
      const [bx, bz] = r.pts[i + 1]
      const L = Math.hypot(bx - ax, bz - az)
      const ux = (bx - ax) / L
      const uz = (bz - az) / L
      for (let s = 14; s < L - 14; s += spacing) {
        side = -side
        const off = r.width / 2 + 1.6
        const x = ax + ux * s - uz * off * side
        const z = az + uz * s + ux * off * side
        if (!clearSpot(x, z, 4)) continue
        if (roadEdgeDistance(x, z) < 0.8) continue
        if (routeDistance(x, z) < 6) continue
        if (out.some((l) => Math.hypot(l.x - x, l.z - z) < spacing * 0.6)) continue
        // arm points back over the road
        out.push({ x, z, rotY: Math.atan2(uz * side, -ux * side) })
      }
    }
  }
  return out
}

export function dashPlacements(): Dash[] {
  const out: Dash[] = []
  for (const r of ROADS) {
    if (r.width < 10) continue
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i]
      const [bx, bz] = r.pts[i + 1]
      const L = Math.hypot(bx - ax, bz - az)
      const rotY = Math.atan2(bx - ax, bz - az)
      for (let s = 10; s < L - 10; s += 10) {
        const x = ax + ((bx - ax) * s) / L
        const z = az + ((bz - az) * s) / L
        if (!clearSpot(x, z, 2)) continue
        out.push({ x, z, rotY, len: 4 })
      }
    }
  }
  return out
}

/** Jersey barriers and cargo crates in a few deliberate clusters. */
export function blockPlacements(): Block[] {
  const out: Block[] = []
  const crate = (x: number, z: number, rot: number, h: number, tint: number) => out.push({ x, z, rotY: rot, sx: 2.4, sy: h, sz: 2.4, tint })
  const barrier = (x: number, z: number, rot: number) => out.push({ x, z, rotY: rot, sx: 0.8, sy: 1.1, sz: 3.6, tint: -1 })
  // transport depot yard (east of the depot)
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) crate(310 + i * 2.8, 215 + j * 2.8, 0, j === 1 && i % 2 ? 4.8 : 2.4, (i + j) % 3)
  for (let i = 0; i < 5; i++) barrier(306, 236 + i * 4, 0)
  // hangar apron, between the hangar wall and the apron road
  for (let i = 0; i < 3; i++) crate(-195, -64 - i * 2.8, 0, i === 1 ? 4.8 : 2.4, i)
  for (let i = 0; i < 3; i++) crate(-195, 100 + i * 2.8, 0, 2.4, (i + 1) % 3)
  // security approach chicane
  for (let i = 0; i < 3; i++) barrier(232 + i * 5, -214 + (i % 2) * 3, Math.PI / 2.6)
  return out.filter((b) => clearSpot(b.x, b.z, 2) && roadEdgeDistance(b.x, b.z) > 0.5 && routeDistance(b.x, b.z) > 5)
}

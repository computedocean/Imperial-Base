// Ground-vehicle routes: pure logic, no three.js scene code (unit-tested in routes.test.ts).
//
// A route is a hand-placed polyline that keeps to open roads and plazas (it never crosses a
// building footprint or a landing pad). Corners are filleted, the result is resampled every
// STEP metres, and a speed profile is precomputed from local curvature (lateral-accel limit)
// plus accel/brake limits, so vehicles slow for junctions and stop smoothly at the ends.

import { CatmullRomCurve3, Vector3 } from 'three'
import { OUTPOST_ROAD, PERIMETER_RADIUS } from '../world/layout'

export const STEP = 1 // metres between route samples
const A_LAT = 1.8 // m/s² lateral limit in turns
const A_LONG = 2.2 // m/s² accel / brake

export interface Route {
  id: string
  loop: boolean
  /** xz samples, STEP apart */
  x: Float32Array
  z: Float32Array
  /** speed limit at each sample, m/s */
  v: Float32Array
  length: number
}

export interface RouteDef {
  id: string
  pts: [number, number][]
  loop?: boolean
  /** speed limit inside the wall / outside it */
  vIn: number
  vOut?: number
  /** corner fillet radius */
  fillet?: number
  /** extra smooth tail (Catmull-Rom points appended after pts, e.g. the outpost road) */
  tail?: [number, number][]
}

const WALL_APOTHEM = PERIMETER_RADIUS * Math.cos(Math.PI / 8)
export function insideWall(x: number, z: number, margin = 0) {
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4
    if (x * Math.cos(a) + z * Math.sin(a) > WALL_APOTHEM - margin) return false
  }
  return true
}

/** Polyline with rounded corners (quadratic Bézier fillets), returned as a dense point list. */
function fillet(pts: [number, number][], r: number, loop: boolean): [number, number][] {
  const n = pts.length
  const out: [number, number][] = []
  const at = (i: number) => pts[(i + n) % n]
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    const isEnd = !loop && (i === 0 || i === n - 1)
    if (isEnd) { out.push(p); continue }
    const a = at(i - 1)
    const b = at(i + 1)
    const la = Math.hypot(a[0] - p[0], a[1] - p[1])
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1])
    const rr = Math.min(r, la * 0.45, lb * 0.45)
    const p0: [number, number] = [p[0] + ((a[0] - p[0]) / la) * rr, p[1] + ((a[1] - p[1]) / la) * rr]
    const p2: [number, number] = [p[0] + ((b[0] - p[0]) / lb) * rr, p[1] + ((b[1] - p[1]) / lb) * rr]
    for (let k = 0; k <= 8; k++) {
      const t = k / 8
      const u = 1 - t
      out.push([u * u * p0[0] + 2 * u * t * p[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p[1] + t * t * p2[1]])
    }
  }
  if (loop) out.push(out[0])
  return out
}

function resample(poly: [number, number][]) {
  const xs: number[] = [poly[0][0]]
  const zs: number[] = [poly[0][1]]
  let carry = 0
  for (let i = 0; i < poly.length - 1; i++) {
    const [ax, az] = poly[i]
    const [bx, bz] = poly[i + 1]
    const L = Math.hypot(bx - ax, bz - az)
    let d = STEP - carry
    while (d <= L) {
      xs.push(ax + ((bx - ax) * d) / L)
      zs.push(az + ((bz - az) * d) / L)
      d += STEP
    }
    carry = L - (d - STEP)
  }
  const last = poly[poly.length - 1]
  if (Math.hypot(xs[xs.length - 1] - last[0], zs[zs.length - 1] - last[1]) > STEP * 0.3) { xs.push(last[0]); zs.push(last[1]) }
  return { xs, zs }
}

export function buildRoute(def: RouteDef): Route {
  const loop = !!def.loop
  let poly = fillet(def.pts, def.fillet ?? 14, loop)
  if (def.tail) {
    const c = new CatmullRomCurve3([poly[poly.length - 1], ...def.tail].map(([x, z]) => new Vector3(x, 0, z)), false, 'centripetal')
    const n = Math.ceil(c.getLength() / 4)
    poly = poly.concat(c.getSpacedPoints(n).slice(1).map((p) => [p.x, p.z] as [number, number]))
  }
  const { xs, zs } = resample(poly)
  const N = xs.length
  const v = new Float32Array(N)
  // curvature limit from the heading change over ±W samples
  const W = 4
  for (let i = 0; i < N; i++) {
    const vmax = insideWall(xs[i], zs[i], -6) ? def.vIn : def.vOut ?? def.vIn
    const i0 = loop ? (i - W + N - 1) % (N - 1) : Math.max(0, i - W)
    const i1 = loop ? (i + W) % (N - 1) : Math.min(N - 1, i + W)
    const h0 = Math.atan2(xs[i] - xs[i0], zs[i] - zs[i0])
    const h1 = Math.atan2(xs[i1] - xs[i], zs[i1] - zs[i])
    let dh = Math.abs(h1 - h0)
    if (dh > Math.PI) dh = 2 * Math.PI - dh
    const span = STEP * W * 2
    const kappa = dh / span
    v[i] = Math.min(vmax, kappa > 1e-6 ? Math.sqrt(A_LAT / kappa) : vmax)
  }
  // junction rule: also cap speed at every waypoint by how sharply the route turns there (≥ 35 % of the limit)
  const P = def.pts
  for (let k = 0; k < P.length; k++) {
    if (!loop && (k === 0 || k === P.length - 1)) continue
    const a = P[(k - 1 + P.length) % P.length]
    const b = P[(k + 1) % P.length]
    const p = P[k]
    let turn = Math.abs(Math.atan2(b[0] - p[0], b[1] - p[1]) - Math.atan2(p[0] - a[0], p[1] - a[1]))
    if (turn > Math.PI) turn = 2 * Math.PI - turn
    const cap = def.vIn * Math.max(0.35, 1 - (turn / (Math.PI / 2)) * 0.6)
    let best = 0
    let bd = Infinity
    for (let i = 0; i < N; i++) {
      const d = (xs[i] - p[0]) ** 2 + (zs[i] - p[1]) ** 2
      if (d < bd) { bd = d; best = i }
    }
    for (let i = Math.max(0, best - 3); i <= Math.min(N - 1, best + 3); i++) v[i] = Math.min(v[i], cap)
  }
  if (!loop) { v[0] = 0; v[N - 1] = 0 }
  // forward (accel) + backward (brake) passes: v² may change by at most 2·a·ds per sample
  const passes = loop ? 2 : 1
  for (let p = 0; p < passes; p++) {
    for (let i = 1; i < N; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * A_LONG * STEP))
    for (let i = N - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * A_LONG * STEP))
    if (loop) { v[0] = Math.min(v[0], v[N - 1]); v[N - 1] = v[0] }
  }
  return { id: def.id, loop, x: Float32Array.from(xs), z: Float32Array.from(zs), v, length: (N - 1) * STEP }
}

export interface Pose { x: number; z: number; yaw: number; speed: number }

/** Position + heading at arc length s (models face +Z, so yaw = atan2(dx, dz)). */
export function sampleRoute(r: Route, s: number, dir = 1): Pose {
  const N = r.x.length
  if (r.loop) s = ((s % r.length) + r.length) % r.length
  else s = Math.max(0, Math.min(r.length, s))
  const f = s / STEP
  const i = Math.min(N - 2, Math.floor(f))
  const t = f - i
  const x = r.x[i] + (r.x[i + 1] - r.x[i]) * t
  const z = r.z[i] + (r.z[i + 1] - r.z[i]) * t
  // heading from a short look-ahead chord (smooths the polyline facets)
  const j0 = Math.max(0, i - 2)
  const j1 = Math.min(N - 1, i + 3)
  let yaw = Math.atan2(r.x[j1] - r.x[j0], r.z[j1] - r.z[j0])
  if (dir < 0) yaw += Math.PI
  const speed = r.v[i] + (r.v[i + 1] - r.v[i]) * t
  return { x, z, yaw, speed }
}

/**
 * Drives a unit along a route: either loops, or shuttles end to end with a dwell at each end.
 * A unit is one vehicle or a convoy: members keep fixed arc-length offsets (0, -gap, -2·gap …),
 * so whoever is in front leads, and they never stack at the ends.
 */
export class Follower {
  /** reference arc length (the first member) */
  s: number
  dir = 1
  dwell: number
  v = 0
  readonly offsets: number[]
  readonly sMin: number
  readonly sMax: number
  dwellA: number
  dwellB: number
  minSpeed: number
  constructor(public route: Route, opts: { s?: number; delay?: number; dwellA?: number; dwellB?: number; minSpeed?: number; members?: number; gap?: number } = {}) {
    const n = opts.members ?? 1
    const gap = opts.gap ?? 24
    this.offsets = Array.from({ length: n }, (_, i) => -gap * i)
    this.sMin = route.loop ? -Infinity : gap * (n - 1)
    this.sMax = route.loop ? Infinity : route.length
    this.s = Math.max(this.sMin, opts.s ?? 0)
    this.dwell = opts.delay ?? 0
    this.dwellA = opts.dwellA ?? 12
    this.dwellB = opts.dwellB ?? 12
    this.minSpeed = opts.minSpeed ?? 0.9
  }

  /** Advances the unit and returns one pose per member. */
  step(dt: number): Pose[] {
    const r = this.route
    if (this.dwell > 0) {
      this.dwell -= dt
      this.v = 0
    } else {
      let limit = Infinity
      for (const o of this.offsets) limit = Math.min(limit, sampleRoute(r, this.s + o).speed)
      // brake for the end of travel of the whole unit
      if (!r.loop) {
        const toEnd = this.dir > 0 ? this.sMax - this.s : this.s - this.sMin
        limit = Math.min(limit, Math.sqrt(2 * A_LONG * Math.max(0, toEnd)))
      }
      const target = Math.max(this.minSpeed, limit)
      this.v += Math.max(-A_LONG * 2 * dt, Math.min(A_LONG * dt, target - this.v))
      this.s += this.v * dt * this.dir
      if (!r.loop) {
        if (this.s >= this.sMax) { this.s = this.sMax; this.dir = -1; this.dwell = this.dwellB; this.v = 0 }
        else if (this.s <= this.sMin) { this.s = this.sMin; this.dir = 1; this.dwell = this.dwellA; this.v = 0 }
      }
    }
    return this.offsets.map((o) => ({ ...sampleRoute(r, this.s + o, this.dir), speed: this.v }))
  }
}

// ---------------------------------------------------------------- the base's routes

export const ROUTE_DEFS: RouteDef[] = [
  // landing-platform apron (west of the main pad) ⇄ transport depot, around the north side of the base
  { id: 'apron-depot', vIn: 11, pts: [[-175, 30], [-175, 190], [-150, 215], [0, 300], [225, 190], [246, 202]] },
  // perimeter patrol of the citadel plaza
  { id: 'plaza-loop', vIn: 9, loop: true, fillet: 18, pts: [[70, 70], [70, -70], [-70, -70], [-70, 70]] },
  // security run: plaza → bunker junction → security operations
  { id: 'security', vIn: 12, pts: [[70, -70], [80, -140], [240, -200], [246, -222]] },
  // fuel tender: hangar apron ⇄ secondary pad 2
  { id: 'fuel', vIn: 7, pts: [[-178, -40], [-175, -90], [-152, -100]] },
  // troop transport: personnel quarters ⇄ operations center
  { id: 'troops', vIn: 9, pts: [[-222, 214], [-160, 212], [-95, 168], [-70, 150], [10, 170]] },
  // supply convoy: depot → east gate → outpost road to Kel-Dorr
  { id: 'convoy', vIn: 10, vOut: 22, pts: [[238, 197], [200, 170], [120, 160], [110, 10], [430, 0]], tail: OUTPOST_ROAD.slice(0, -1).concat([[OUTPOST_ROAD[OUTPOST_ROAD.length - 1][0] - 60, OUTPOST_ROAD[OUTPOST_ROAD.length - 1][1]]]) },
]

export type VehicleType = 'hauler' | 'speeder' | 'tender' | 'troop'

/** A unit drives one route; several types make a convoy. minQuality 0 = always, 1 = medium and above. */
export interface UnitSpec {
  id: string
  route: string
  types: VehicleType[]
  s?: number
  delay?: number
  dwellA?: number
  dwellB?: number
  gap?: number
  minQuality: 0 | 1
}

export const UNITS: UnitSpec[] = [
  { id: 'hauler-1', types: ['hauler'], route: 'apron-depot', dwellA: 25, dwellB: 20, minQuality: 0 },
  { id: 'speeder-1', types: ['speeder'], route: 'plaza-loop', minQuality: 0 },
  { id: 'tender-1', types: ['tender'], route: 'fuel', dwellA: 30, dwellB: 18, delay: 4, minQuality: 0 },
  { id: 'speeder-2', types: ['speeder'], route: 'plaza-loop', s: 280, minQuality: 1 },
  { id: 'speeder-3', types: ['speeder'], route: 'security', dwellA: 10, dwellB: 22, minQuality: 1 },
  { id: 'troop-1', types: ['troop'], route: 'troops', dwellA: 30, dwellB: 25, delay: 8, minQuality: 1 },
  // supply convoy to the mining outpost and back
  { id: 'convoy', types: ['speeder', 'hauler', 'troop'], gap: 26, route: 'convoy', delay: 20, dwellA: 70, dwellB: 30, minQuality: 1 },
]

let _routes: Record<string, Route> | null = null
export function routes(): Record<string, Route> {
  return (_routes ??= Object.fromEntries(ROUTE_DEFS.map((d) => [d.id, buildRoute(d)])))
}

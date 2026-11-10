// Aircraft flight simulation — pure TypeScript (no React), deterministic, unit-tested.
// Environmental simulation only: it is NOT telemetry of anything real.

import * as THREE from 'three'
import { HANGAR_DOOR, PADS, terrainHeight } from '../world/layout'

const UP = new THREE.Vector3(0, 1, 0)
const G = 9.81

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
export const easeInCubic = (t: number) => t * t * t
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))

export interface Pose {
  pos: THREE.Vector3
  quat: THREE.Quaternion
  bank: number
  speed: number
  visible: boolean
}

/** Raise every control point so the local terrain (sampled in a ring) is cleared by `clearance` metres. */
export function liftAboveTerrain(points: THREE.Vector3[], clearance: number, ring = 260): THREE.Vector3[] {
  return points.map((p) => {
    let maxH = terrainHeight(p.x, p.z)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      maxH = Math.max(maxH, terrainHeight(p.x + Math.cos(a) * ring, p.z + Math.sin(a) * ring))
    }
    return new THREE.Vector3(p.x, Math.max(p.y, maxH + clearance), p.z)
  })
}

/**
 * Iteratively raise control points until the *interpolated* spline (not just the control points)
 * clears the terrain by `clearance` metres. Points with index in `locked` are never moved.
 */
export function clearSpline(points: THREE.Vector3[], clearance: number, closed = false, locked: number[] = []): THREE.Vector3[] {
  const pts = points.map((p) => p.clone())
  const probe = new THREE.Vector3()
  for (let iter = 0; iter < 40; iter++) {
    const curve = new THREE.CatmullRomCurve3(pts, closed, 'centripetal', 0.5)
    let worst = 0
    let worstU = 0
    const n = 1200
    for (let i = 0; i <= n; i++) {
      const u = i / n
      curve.getPoint(u, probe)
      const deficit = terrainHeight(probe.x, probe.z) + clearance - probe.y
      if (deficit > worst) { worst = deficit; worstU = u }
    }
    if (worst <= 0.5) break
    const segs = closed ? pts.length : pts.length - 1
    const f = worstU * segs
    const i0 = Math.floor(f) % pts.length
    const i1 = (i0 + 1) % pts.length
    for (const i of [i0, i1]) if (!locked.includes(i)) pts[i].y += worst * 0.75 + 5
  }
  return pts
}

/** Arc-length parameterised spline with orientation + coordinated-turn banking. */
export class FlightPath {
  curve: THREE.CatmullRomCurve3
  length: number
  closed: boolean
  constructor(points: THREE.Vector3[], closed = false, tension = 0.5) {
    this.curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal', tension)
    this.curve.arcLengthDivisions = 400
    this.length = this.curve.getLength()
    this.closed = closed
  }
  point(u: number, out = new THREE.Vector3()) {
    return this.curve.getPointAt(this.wrap(u), out)
  }
  tangent(u: number, out = new THREE.Vector3()) {
    return this.curve.getTangentAt(this.wrap(u), out).normalize()
  }
  wrap(u: number) {
    return this.closed ? ((u % 1) + 1) % 1 : clamp01(u)
  }
  /** Bank angle (radians, + = right wing down) for flying the path at `speed` m/s. */
  bank(u: number, speed: number, maxBank = 1.05) {
    const du = Math.min(0.01, 25 / this.length)
    const t0 = this.tangent(u - du)
    const t1 = this.tangent(u + du)
    const h0 = Math.atan2(t0.x, t0.z)
    const h1 = Math.atan2(t1.x, t1.z)
    let dh = h1 - h0
    if (dh > Math.PI) dh -= Math.PI * 2
    if (dh < -Math.PI) dh += Math.PI * 2
    const ds = 2 * du * this.length
    const yawRate = (dh / ds) * speed // rad/s
    const b = Math.atan((speed * yawRate) / G)
    return Math.max(-maxBank, Math.min(maxBank, -b))
  }
}

const _m = new THREE.Matrix4()
const _x = new THREE.Vector3()
const _y = new THREE.Vector3()
const _z = new THREE.Vector3()
const _q = new THREE.Quaternion()

/** Orientation for a model whose nose is +Z: face `forward`, roll by `bank`, optional pitch damping. */
export function orient(forward: THREE.Vector3, bank: number, out = new THREE.Quaternion(), pitchScale = 1) {
  _z.copy(forward)
  _z.y *= pitchScale
  if (_z.lengthSq() < 1e-8) _z.set(0, 0, 1)
  _z.normalize()
  _x.crossVectors(UP, _z)
  if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0)
  _x.normalize()
  _y.crossVectors(_z, _x).normalize()
  _m.makeBasis(_x, _y, _z)
  out.setFromRotationMatrix(_m)
  _q.setFromAxisAngle(_z.set(0, 0, 1), bank)
  return out.multiply(_q)
}

export function yawQuat(yaw: number, out = new THREE.Quaternion()) {
  return out.setFromAxisAngle(UP, yaw)
}

// ======================================================================= SHUTTLE

export type ShuttlePhase = 'away' | 'approach' | 'descent' | 'landed' | 'liftoff' | 'climbout'

export const SHUTTLE_TIMING = { approach: 42, descent: 16, liftoff: 14, climbout: 30 }
export const MAIN_PAD = PADS[0]
const HOVER = 46
const LAND_YAW = Math.PI / 2 // nose east (+X), boarding ramp toward the citadel

// Far waypoints are lifted clear of terrain; the final approach over the plateau is fixed.
const approachPts = [
  ...clearSpline(liftAboveTerrain([
    new THREE.Vector3(-2600, 950, -2300),
    new THREE.Vector3(-1500, 560, -1250),
    new THREE.Vector3(-780, 300, -470),
  ], 160), 160),
  new THREE.Vector3(-380, 150, -90),
  new THREE.Vector3(-215, 86, 12),
  new THREE.Vector3(MAIN_PAD.x, MAIN_PAD.y + HOVER, MAIN_PAD.z),
]

const climbPts = [
  new THREE.Vector3(MAIN_PAD.x, MAIN_PAD.y + HOVER + 14, MAIN_PAD.z),
  new THREE.Vector3(-150, 120, 240),
  ...clearSpline(liftAboveTerrain([
    new THREE.Vector3(-330, 330, 880),
    new THREE.Vector3(-900, 720, 2300),
    new THREE.Vector3(-1800, 1150, 4300),
  ], 180), 180),
]

export const SHUTTLE_APPROACH = new FlightPath(approachPts)
export const SHUTTLE_CLIMB = new FlightPath(climbPts)

export interface ShuttleState extends Pose {
  phase: ShuttlePhase
  wingFold: number
  gear: number
  ramp: number
  thrust: number
  /** 0..1 progress through the current phase */
  progress: number
}

export class ShuttleSim {
  phase: ShuttlePhase = 'away'
  t0 = 0
  autoCycle = true
  landedHold = 45
  private departYaw = Math.atan2(SHUTTLE_CLIMB.tangent(0.02).x, SHUTTLE_CLIMB.tangent(0.02).z)
  readonly state: ShuttleState = {
    phase: 'away', pos: new THREE.Vector3(), quat: new THREE.Quaternion(), bank: 0, speed: 0, visible: false,
    wingFold: 0, gear: 0, ramp: 0, thrust: 0, progress: 0,
  }

  /** Commander controls. Return false when the command is not valid in the current phase. */
  arrive(now: number) {
    if (this.phase !== 'away') return false
    this.phase = 'approach'
    this.t0 = now
    return true
  }
  depart(now: number) {
    if (this.phase !== 'landed') return false
    this.phase = 'liftoff'
    this.t0 = now
    return true
  }

  update(now: number): ShuttleState {
    const s = this.state
    let t = now - this.t0
    // phase transitions
    if (this.phase === 'approach' && t >= SHUTTLE_TIMING.approach) this.next('descent', now)
    else if (this.phase === 'descent' && t >= SHUTTLE_TIMING.descent) this.next('landed', now)
    else if (this.phase === 'landed' && this.autoCycle && t >= this.landedHold) this.next('liftoff', now)
    else if (this.phase === 'liftoff' && t >= SHUTTLE_TIMING.liftoff) this.next('climbout', now)
    else if (this.phase === 'climbout' && t >= SHUTTLE_TIMING.climbout) this.next('away', now)
    t = now - this.t0
    s.phase = this.phase
    s.visible = this.phase !== 'away'
    const padTop = new THREE.Vector3(MAIN_PAD.x, MAIN_PAD.y, MAIN_PAD.z)

    switch (this.phase) {
      case 'away':
        s.progress = 0; s.thrust = 0; s.speed = 0
        break
      case 'approach': {
        const k = clamp01(t / SHUTTLE_TIMING.approach)
        const u = easeOutCubic(k)
        SHUTTLE_APPROACH.point(u, s.pos)
        const speed = (3 * Math.pow(1 - k, 2) * SHUTTLE_APPROACH.length) / SHUTTLE_TIMING.approach
        const fwd = SHUTTLE_APPROACH.tangent(Math.min(u, 0.995))
        // align with the pad heading over the last 25 %
        const align = seg(k, 0.75, 1)
        const target = new THREE.Vector3(Math.sin(LAND_YAW), 0, Math.cos(LAND_YAW))
        fwd.lerp(target, easeInOut(align)).normalize()
        s.bank = SHUTTLE_APPROACH.bank(u, speed, 0.45) * (1 - align)
        orient(fwd, s.bank, s.quat, 0.35)
        s.speed = speed
        s.wingFold = 0
        s.gear = 0
        s.ramp = 0
        s.thrust = 0.55 + 0.45 * (1 - k)
        s.progress = k
        break
      }
      case 'descent': {
        const k = clamp01(t / SHUTTLE_TIMING.descent)
        const h = HOVER * (1 - easeInOut(k))
        s.pos.copy(padTop).y += h
        yawQuat(LAND_YAW, s.quat)
        s.bank = 0
        s.speed = (HOVER / SHUTTLE_TIMING.descent) * 1.5 * Math.sin(Math.PI * k)
        s.wingFold = easeInOut(seg(t, 0.5, 7))
        s.gear = easeInOut(seg(t, 6, 11))
        s.ramp = 0
        s.thrust = 0.75 - 0.5 * k
        s.progress = k
        break
      }
      case 'landed': {
        s.pos.copy(padTop)
        yawQuat(LAND_YAW, s.quat)
        s.bank = 0; s.speed = 0
        s.wingFold = 1; s.gear = 1
        s.ramp = easeInOut(seg(t, 2, 6))
        s.thrust = Math.max(0.05, 0.25 * (1 - seg(t, 0, 4)))
        s.progress = this.autoCycle ? clamp01(t / this.landedHold) : 0
        break
      }
      case 'liftoff': {
        const k = clamp01(t / SHUTTLE_TIMING.liftoff)
        s.ramp = 1 - easeInOut(seg(t, 0, 3))
        const climbK = seg(t, 3.5, SHUTTLE_TIMING.liftoff)
        s.pos.copy(padTop).y += (HOVER + 14) * easeInOut(climbK)
        const yaw = LAND_YAW + shortestAngle(LAND_YAW, this.departYaw) * easeInOut(seg(t, 7, SHUTTLE_TIMING.liftoff))
        yawQuat(yaw, s.quat)
        s.bank = 0
        s.speed = ((HOVER + 14) / (SHUTTLE_TIMING.liftoff - 3.5)) * 1.5 * Math.sin(Math.PI * climbK)
        s.gear = 1 - easeInOut(seg(t, 6, 10))
        s.wingFold = 1 - easeInOut(seg(t, 8, 13.5))
        s.thrust = 0.35 + 0.55 * climbK
        s.progress = k
        break
      }
      case 'climbout': {
        const k = clamp01(t / SHUTTLE_TIMING.climbout)
        const u = easeInCubic(k)
        SHUTTLE_CLIMB.point(u, s.pos)
        const speed = (3 * k * k * SHUTTLE_CLIMB.length) / SHUTTLE_TIMING.climbout
        s.bank = SHUTTLE_CLIMB.bank(Math.max(u, 0.01), speed, 0.5)
        orient(SHUTTLE_CLIMB.tangent(Math.max(u, 0.01)), s.bank, s.quat, 0.4)
        s.speed = speed
        s.wingFold = 0; s.gear = 0; s.ramp = 0
        s.thrust = 0.9 + 0.1 * k
        s.progress = k
        break
      }
    }
    return s
  }

  private next(p: ShuttlePhase, now: number) {
    this.phase = p
    this.t0 = now
  }
}

export function shortestAngle(a: number, b: number) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

// ======================================================================= TIE PATROLS

function ring(radius: number, alt: number, n: number, wobble: number, phase = 0) {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + phase
    const r = radius * (1 + wobble * Math.sin(a * 3 + 1.3))
    pts.push(new THREE.Vector3(Math.cos(a) * r, alt + 35 * Math.sin(a * 2), Math.sin(a) * r))
  }
  return pts
}

export const PATROL_ROUTES = {
  inner: new FlightPath(clearSpline(liftAboveTerrain(ring(680, 150, 12, 0.08), 90), 100, true), true),
  outer: new FlightPath(clearSpline(liftAboveTerrain(ring(1250, 300, 14, 0.12, 0.6).reverse(), 140), 140, true), true),
}

/** Hangar-side waypoints: launch goes out through these, recovery comes back through them reversed. */
const HANGAR_INSIDE = new THREE.Vector3(HANGAR_DOOR.x - 30, 9, HANGAR_DOOR.z)
const HANGAR_EXIT = [
  new THREE.Vector3(HANGAR_DOOR.x - 30, 9, HANGAR_DOOR.z),
  new THREE.Vector3(HANGAR_DOOR.x + 25, 13, HANGAR_DOOR.z),
  new THREE.Vector3(-80, 60, 110),
  new THREE.Vector3(80, 120, 320),
]

export type FlightState = 'parked' | 'launching' | 'patrol' | 'returning' | 'intercept'

export interface Fighter {
  id: string
  callsign: string
  route: keyof typeof PATROL_ROUTES
  slot: number // formation slot: 0 leader, 1 left, 2 right
  state: FlightState
  u: number // progress along route (patrol) or transition
  transition: FlightPath | null
  transitionSpeed: number
  delay: number // staggered launch delay (s)
  pose: Pose
  thrust: number
}

const SLOT_OFFSETS: [number, number, number][] = [[0, 0, 0], [-18, -3, -22], [18, -3, -22], [-36, -6, -44]]

export class PatrolSim {
  fighters: Fighter[] = []
  active = false
  speed = { inner: 72, outer: 95 }
  private _p = new THREE.Vector3()
  private _t = new THREE.Vector3()
  private _r = new THREE.Vector3()

  constructor() {
    const mk = (id: string, cs: string, route: Fighter['route'], slot: number): Fighter => ({
      id, callsign: cs, route, slot, state: 'parked', u: 0, transition: null, transitionSpeed: 60, delay: 0,
      pose: { pos: HANGAR_INSIDE.clone(), quat: new THREE.Quaternion(), bank: 0, speed: 0, visible: false }, thrust: 0,
    })
    this.fighters = [
      mk('tie-1', 'Onyx Lead', 'inner', 0), mk('tie-2', 'Onyx Two', 'inner', 1), mk('tie-3', 'Onyx Three', 'inner', 2),
      mk('tie-4', 'Sable Lead', 'outer', 0), mk('tie-5', 'Sable Two', 'outer', 1),
    ]
  }

  /** Start patrols: fighters launch from the hangar in sequence and join their route. */
  start(immediate = false) {
    this.active = true
    this.fighters.forEach((f, i) => {
      if (immediate) {
        f.state = 'patrol'
        f.u = f.route === 'inner' ? 0.05 : 0.55
        f.pose.visible = true
      } else if (f.state === 'parked' || f.state === 'returning') {
        const join = PATROL_ROUTES[f.route].point(f.route === 'inner' ? 0.1 : 0.62)
        const pts = [...HANGAR_EXIT.map((p) => p.clone()), join]
        if (f.state === 'returning') pts.splice(0, pts.length - 2, f.pose.pos.clone())
        f.transition = new FlightPath(pts)
        f.transitionSpeed = 55
        f.delay = f.state === 'parked' ? i * 3.2 : 0
        f.state = 'launching'
        f.u = 0
      }
    })
  }

  /** Stop patrols: every airborne fighter flies a recovery path back into the hangar. */
  stop() {
    this.active = false
    for (const f of this.fighters) {
      if (f.state === 'parked') continue
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(f.pose.quat)
      const pts = [f.pose.pos.clone(), f.pose.pos.clone().addScaledVector(fwd, 250), ...[...HANGAR_EXIT].reverse().map((p) => p.clone())]
      pts[1].y = Math.max(pts[1].y, 120)
      f.transition = new FlightPath(liftAboveTerrain(pts.slice(0, 2), 80).concat(pts.slice(2)))
      f.transitionSpeed = 65
      f.state = 'returning'
      f.u = 0
      f.delay = f.slot * 1.5
    }
  }

  update(dt: number) {
    for (const f of this.fighters) {
      if (f.state === 'parked') { f.pose.visible = false; f.thrust = 0; continue }
      if (f.delay > 0) { f.delay -= dt; if (f.state === 'launching') { f.pose.visible = false; continue } }
      f.pose.visible = true
      if (f.state === 'patrol') {
        const path = PATROL_ROUTES[f.route]
        const speed = this.speed[f.route]
        f.u = (f.u + (speed * dt) / path.length) % 1
        // followers fly the same path slightly behind, offset laterally in the path frame
        const off = SLOT_OFFSETS[f.slot]
        const uu = f.u + off[2] / path.length
        path.point(uu, this._p)
        path.tangent(uu, this._t)
        this._r.crossVectors(this._t, UP).normalize()
        f.pose.pos.copy(this._p).addScaledVector(this._r, off[0]).y += off[1]
        f.pose.bank += (path.bank(uu, speed) - f.pose.bank) * Math.min(1, dt * 2)
        orient(this._t, f.pose.bank, f.pose.quat)
        f.pose.speed = speed
        f.thrust = 0.85
      } else if (f.transition) {
        const p = f.transition
        const k = f.u
        // gentle speed profile: accelerate out of the hangar / decelerate into it
        const sp = f.state === 'launching' ? f.transitionSpeed * (0.3 + 0.7 * Math.min(1, k * 4)) : f.transitionSpeed * (0.25 + 0.75 * Math.min(1, (1 - k) * 4))
        f.u = Math.min(1, f.u + (sp * dt) / p.length)
        p.point(f.u, f.pose.pos)
        p.tangent(f.u, this._t)
        f.pose.bank += (p.bank(f.u, sp, 0.8) - f.pose.bank) * Math.min(1, dt * 2)
        orient(this._t, f.pose.bank, f.pose.quat)
        f.pose.speed = sp
        f.thrust = 0.6
        if (f.u >= 1) {
          if (f.state === 'launching') {
            f.state = 'patrol'
            f.u = f.route === 'inner' ? 0.1 : 0.62
          } else {
            f.state = 'parked'
            f.transition = null
            f.pose.visible = false
          }
        }
      }
    }
  }
}

// ======================================================================= X-WING FLYBY

export const XWING_TIMING = { duration: 48 }
/**
 * The shoot-down, in fractions of the flyby: the picket appears, the intruder opens fire, the picket
 * is hit when `gap` metres ahead. `closing` is the picket's speed relative to the intruder's.
 */
export const XWING_KILL = { appear: 0.12, fire: 0.405, hit: 0.44, gap: 170, closing: 0.8, offsetY: 26 }
export const XWING_PATH = new FlightPath(clearSpline(liftAboveTerrain([
  new THREE.Vector3(3400, 520, -4200),
  new THREE.Vector3(2300, 330, -1900),
  new THREE.Vector3(1500, 230, -500),
  new THREE.Vector3(1250, 210, 700),
  new THREE.Vector3(1700, 300, 2200),
  new THREE.Vector3(3000, 520, 4300),
], 120), 130))

export class XWingSim {
  active = false
  t0 = 0
  interceptLag = 6
  intercept = true
  readonly pose: Pose & { sFoil: number; thrust: number } = {
    pos: new THREE.Vector3(), quat: new THREE.Quaternion(), bank: 0, speed: 0, visible: false, sFoil: 0, thrust: 0,
  }
  /** Two interceptors chase along the same path (only when patrols are active). */
  readonly interceptors: (Pose & { thrust: number })[] = [0, 1].map(() => ({
    pos: new THREE.Vector3(), quat: new THREE.Quaternion(), bank: 0, speed: 0, visible: false, thrust: 0,
  }))

  /** A lone picket fighter meets the intruder head-on and is shot down (see XWING_KILL). */
  readonly picket: Pose & { thrust: number } = {
    pos: new THREE.Vector3(), quat: new THREE.Quaternion(), bank: 0, speed: 0, visible: false, thrust: 0,
  }
  /** True while the intruder is firing its cannons. */
  firing = false
  /** Simulation time of the kill (null until it happens on this pass) and where it happened. */
  killAt: number | null = null
  readonly killPos = new THREE.Vector3()
  /** Counts kills so far, so views can react to a new one exactly once. */
  kills = 0

  trigger(now: number, withIntercept: boolean) {
    if (this.active) return false
    this.active = true
    this.t0 = now
    this.intercept = withIntercept
    this.killAt = null
    this.firing = false
    return true
  }

  /** Path parameter of the picket for the intruder's parameter k: closing head-on, `gap` apart at the kill. */
  private picketU(k: number) {
    const K = XWING_KILL
    return K.hit + K.gap / XWING_PATH.length + (K.hit - k) * K.closing
  }

  update(now: number) {
    const t = now - this.t0
    const D = XWING_TIMING.duration
    if (!this.active) {
      this.pose.visible = false
      this.picket.visible = false
      this.firing = false
      this.interceptors.forEach((p) => (p.visible = false))
      return this.pose
    }
    // picket fighter: flies the same corridor the other way until the intruder's guns find it
    {
      const K = XWING_KILL
      const kk = t / D
      const u = this.picketU(kk)
      const p = this.picket
      p.visible = kk >= K.appear && kk < K.hit && u < 1
      if (p.visible) {
        XWING_PATH.point(u, p.pos)
        p.pos.y += K.offsetY * (1 - seg(kk, K.fire, K.hit)) // drops onto the intruder's line as it commits
        const tan = XWING_PATH.tangent(u).multiplyScalar(-1)
        // in the last moments it breaks hard, too late
        p.bank = seg(kk, K.fire, K.hit) * 0.9
        orient(tan, p.bank, p.quat)
        p.thrust = 1
      }
      this.firing = kk >= K.fire && kk < K.hit
      if (this.killAt === null && kk >= K.hit) {
        this.killAt = this.t0 + K.hit * D
        XWING_PATH.point(this.picketU(K.hit), this.killPos)
        this.kills++
      }
    }
    const speed = XWING_PATH.length / D
    const k = t / D
    const set = (pose: Pose, kk: number, sp: number) => {
      pose.visible = kk > 0 && kk < 1
      if (!pose.visible) return
      XWING_PATH.point(kk, pose.pos)
      const bank = XWING_PATH.bank(kk, sp, 1.2)
      pose.bank = bank
      orient(XWING_PATH.tangent(kk), bank, pose.quat)
      pose.speed = sp
    }
    set(this.pose, k, speed)
    this.pose.sFoil = easeInOut(seg(k, 0.15, 0.3)) * (1 - easeInOut(seg(k, 0.8, 0.92)))
    this.pose.thrust = 0.9
    this.interceptors.forEach((p, i) => {
      if (!this.intercept) { p.visible = false; return }
      const kk = (t - this.interceptLag - i * 1.2) / D
      set(p, kk, speed)
      if (p.visible) p.pos.x += i === 0 ? -14 : 14
      p.thrust = 0.95
    })
    const lastIntercept = this.intercept ? (this.interceptLag + 1.2) / D : 0
    if (k >= 1 + lastIntercept) {
      this.active = false
      this.pose.visible = false
    }
    return this.pose
  }
}

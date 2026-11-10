// Impounded freighter — pure TypeScript (no React), deterministic, unit-tested.
// Environmental simulation only: it is NOT telemetry of anything real.
//
// A captured light freighter sits on Secondary Pad 3. Now and then it breaks its clamps, lifts off,
// runs low along the southern apron and out through the eastern valley; later it is brought back.
import * as THREE from 'three'
import { PADS } from '../world/layout'
import { FlightPath, clamp01, clearSpline, easeInOut, orient, yawQuat, type Pose } from './flight'

const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))

export type FreighterPhase = 'impounded' | 'liftoff' | 'escape' | 'away' | 'return' | 'landing'
export const FREIGHTER_TIMING = { liftoff: 7, escape: 30, away: 40, return: 34, landing: 9, autoAfter: 150 }
export const FREIGHTER_PAD = PADS[2]
/** Height of the model origin above the pad when it stands on its landing gear. */
export const FREIGHTER_REST = 4.3
const HOVER = 32
const rest = new THREE.Vector3(FREIGHTER_PAD.x, FREIGHTER_PAD.y + FREIGHTER_REST, FREIGHTER_PAD.z)
const hover = rest.clone().setY(rest.y + HOVER)

export const FREIGHTER_ESCAPE = new FlightPath(clearSpline([
  hover.clone(),
  new THREE.Vector3(-70, 44, 215),
  new THREE.Vector3(70, 52, 275),
  new THREE.Vector3(250, 62, 250),
  new THREE.Vector3(420, 80, 130),
  new THREE.Vector3(700, 150, 120),
  new THREE.Vector3(1500, 330, 420),
  new THREE.Vector3(2900, 760, 900),
  new THREE.Vector3(4600, 1500, 1450),
], 80, false, [0, 1, 2, 3, 4]))

export const FREIGHTER_RETURN = new FlightPath(clearSpline([
  new THREE.Vector3(4200, 1300, 2100),
  new THREE.Vector3(2600, 640, 1250),
  new THREE.Vector3(1300, 300, 620),
  new THREE.Vector3(620, 150, 380),
  new THREE.Vector3(260, 80, 300),
  new THREE.Vector3(20, 52, 240),
  hover.clone(),
], 80, false, [3, 4, 5, 6]))

export interface FreighterState extends Pose {
  phase: FreighterPhase
  /** 0 retracted .. 1 down */
  gear: number
  thrust: number
}

const _q = new THREE.Quaternion()
const _t = new THREE.Vector3()

export class FreighterSim {
  phase: FreighterPhase = 'impounded'
  t0 = 0
  autoCycle = true
  /** heading (radians about +Y) of the parked ship; the nose points east at first */
  parkedYaw = Math.PI / 2
  readonly state: FreighterState = {
    pos: rest.clone(), quat: yawQuat(Math.PI / 2), bank: 0, speed: 0, visible: true, phase: 'impounded', gear: 1, thrust: 0,
  }

  /** True while the ship is making its run (drives the base alert). */
  get escaping() { return this.phase === 'liftoff' || this.phase === 'escape' }

  /** 0..1 through the whole excursion (liftoff to touchdown), 0 while parked. */
  get progress() {
    const T = FREIGHTER_TIMING
    const order: FreighterPhase[] = ['liftoff', 'escape', 'away', 'return', 'landing']
    const i = order.indexOf(this.phase)
    if (i < 0) return 0
    const total = order.reduce((s, p) => s + T[p as keyof typeof T], 0)
    let done = 0
    for (let k = 0; k < i; k++) done += T[order[k] as keyof typeof T]
    return clamp01((done + this.elapsed) / total)
  }

  private elapsed = 0

  escape(now: number) {
    if (this.phase !== 'impounded') return false
    this.phase = 'liftoff'
    this.t0 = now
    return true
  }

  private go(phase: FreighterPhase, at: number) {
    this.phase = phase
    this.t0 = at
  }

  update(now: number): FreighterState {
    const T = FREIGHTER_TIMING
    const s = this.state
    // advance through phases (a long frame may cross more than one boundary)
    for (let guard = 0; guard < 6; guard++) {
      const t = now - this.t0
      if (this.phase === 'impounded') { if (this.autoCycle && t >= T.autoAfter) this.go('liftoff', this.t0 + T.autoAfter); else break }
      else if (this.phase === 'liftoff') { if (t >= T.liftoff) this.go('escape', this.t0 + T.liftoff); else break }
      else if (this.phase === 'escape') { if (t >= T.escape) this.go('away', this.t0 + T.escape); else break }
      else if (this.phase === 'away') { if (t >= T.away) this.go('return', this.t0 + T.away); else break }
      else if (this.phase === 'return') { if (t >= T.return) this.go('landing', this.t0 + T.return); else break }
      else if (t >= T.landing) {
        FREIGHTER_RETURN.tangent(1, _t)
        this.parkedYaw = Math.atan2(_t.x, _t.z)
        this.go('impounded', this.t0 + T.landing)
      } else break
    }
    const t = now - this.t0
    this.elapsed = t
    s.phase = this.phase
    s.visible = this.phase !== 'away'
    s.bank = 0
    switch (this.phase) {
      case 'impounded':
        s.pos.copy(rest)
        yawQuat(this.parkedYaw, s.quat)
        s.gear = 1; s.thrust = 0; s.speed = 0
        break
      case 'liftoff': {
        const k = clamp01(t / T.liftoff)
        s.pos.copy(rest).lerp(hover, easeInOut(k))
        // swing the nose onto the escape heading while rising
        yawQuat(this.parkedYaw, s.quat).slerp(orient(FREIGHTER_ESCAPE.tangent(0, _t), 0, _q, 0), easeInOut(seg(k, 0.15, 1)))
        s.gear = 1 - seg(k, 0.35, 0.95)
        s.thrust = 0.3 + 0.5 * k
        s.speed = 0
        break
      }
      case 'escape': {
        const k = clamp01(t / T.escape)
        const u = Math.pow(k, 1.7) // slow off the hover, flat out by the valley
        const speed = (FREIGHTER_ESCAPE.length * 1.7 * Math.pow(k, 0.7)) / T.escape
        FREIGHTER_ESCAPE.point(u, s.pos)
        s.bank = FREIGHTER_ESCAPE.bank(u, Math.max(speed, 40), 1.1) * seg(k, 0, 0.12)
        orient(FREIGHTER_ESCAPE.tangent(u, _t), s.bank, s.quat, seg(k, 0, 0.1))
        s.gear = 0; s.thrust = 1; s.speed = speed
        break
      }
      case 'away':
        s.gear = 0; s.thrust = 0; s.speed = 0
        break
      case 'return': {
        const k = clamp01(t / T.return)
        const u = 1 - Math.pow(1 - k, 1.8) // fast in, bleeding speed into the hover
        const speed = (FREIGHTER_RETURN.length * 1.8 * Math.pow(1 - k, 0.8)) / T.return
        FREIGHTER_RETURN.point(u, s.pos)
        const level = 1 - seg(k, 0.85, 1)
        s.bank = FREIGHTER_RETURN.bank(u, Math.max(speed, 40), 0.9) * level
        orient(FREIGHTER_RETURN.tangent(u, _t), s.bank, s.quat, level)
        s.gear = 0; s.thrust = 0.75 - 0.3 * k; s.speed = speed
        break
      }
      case 'landing': {
        const k = clamp01(t / T.landing)
        s.pos.copy(hover).lerp(rest, easeInOut(k))
        orient(FREIGHTER_RETURN.tangent(1, _t), 0, s.quat, 0)
        s.gear = seg(k, 0.05, 0.55)
        s.thrust = 0.45 * (1 - k)
        s.speed = 0
        break
      }
    }
    return s
  }
}

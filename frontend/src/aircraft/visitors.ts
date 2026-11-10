// Visiting ships — pure TypeScript (no React), deterministic, unit-tested.
// Environmental simulation only: it is NOT telemetry of anything real.
//
//  * a bounty hunter's gunship that flies in, sets down on a visitor stand inside the east wall,
//    waits a while and leaves again;
//  * a Hutt sail barge that drifts in a wide circle over the dunes outside the base.
import * as THREE from 'three'
import { terrainHeight } from '../world/layout'
import { FlightPath, clamp01, clearSpline, easeInOut, orient, type Pose } from './flight'

const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))

// ======================================================================= GUNSHIP
export type LanderPhase = 'away' | 'approach' | 'landing' | 'landed' | 'liftoff' | 'depart'
export const GUNSHIP = {
  /** visitor stand on the east apron, between the Intelligence building and the wall */
  stand: { x: 340, y: 0, z: -85 },
  /** height of the model origin above the ground when it stands on its gear */
  rest: 3.4,
  hover: 30,
  timing: { approach: 34, landing: 8, landed: 70, liftoff: 7, depart: 26, away: 80 },
  /** seconds after start-up before the first arrival begins */
  firstArrival: 25,
}
const gRest = new THREE.Vector3(GUNSHIP.stand.x, GUNSHIP.stand.y + GUNSHIP.rest, GUNSHIP.stand.z)
const gHover = gRest.clone().setY(gRest.y + GUNSHIP.hover)

export const GUNSHIP_APPROACH = new FlightPath(clearSpline([
  new THREE.Vector3(3000, 760, -2700),
  new THREE.Vector3(1600, 330, -1300),
  new THREE.Vector3(860, 150, -560),
  new THREE.Vector3(500, 70, -210),
  gHover.clone(),
], 70, false, [3, 4]))

export const GUNSHIP_DEPART = new FlightPath(clearSpline([
  gHover.clone(),
  new THREE.Vector3(400, 70, -250),
  new THREE.Vector3(640, 170, -700),
  new THREE.Vector3(1500, 560, -2000),
  new THREE.Vector3(3200, 1500, -4300),
], 70, false, [0, 1]))

export interface LanderState extends Pose {
  phase: LanderPhase
  /** 0 retracted .. 1 down */
  gear: number
  thrust: number
}

const ORDER: LanderPhase[] = ['away', 'approach', 'landing', 'landed', 'liftoff', 'depart']
const _t = new THREE.Vector3()

export class GunshipSim {
  phase: LanderPhase = 'away'
  /** start time of the current phase; negative at first so the first arrival comes soon after start-up */
  t0 = GUNSHIP.firstArrival - GUNSHIP.timing.away
  readonly state: LanderState = {
    pos: gRest.clone(), quat: new THREE.Quaternion(), bank: 0, speed: 0, visible: false, phase: 'away', gear: 0, thrust: 0,
  }

  update(now: number): LanderState {
    const T = GUNSHIP.timing
    const s = this.state
    // advance through phases (a long frame may cross more than one boundary)
    for (let guard = 0; guard < 8; guard++) {
      const d = T[this.phase]
      if (now - this.t0 < d) break
      this.t0 += d
      this.phase = ORDER[(ORDER.indexOf(this.phase) + 1) % ORDER.length]
    }
    const t = now - this.t0
    const k = clamp01(t / T[this.phase])
    s.phase = this.phase
    s.visible = this.phase !== 'away'
    s.bank = 0
    switch (this.phase) {
      case 'away':
        s.gear = 0; s.thrust = 0; s.speed = 0
        break
      case 'approach': {
        const u = 1 - Math.pow(1 - k, 1.8) // fast in, bleeding speed into the hover
        const speed = (GUNSHIP_APPROACH.length * 1.8 * Math.pow(1 - k, 0.8)) / T.approach
        GUNSHIP_APPROACH.point(u, s.pos)
        const level = 1 - seg(k, 0.85, 1)
        s.bank = GUNSHIP_APPROACH.bank(u, Math.max(speed, 40), 0.9) * level
        orient(GUNSHIP_APPROACH.tangent(u, _t), s.bank, s.quat, level)
        s.gear = 0; s.thrust = 0.8 - 0.3 * k; s.speed = speed
        break
      }
      case 'landing':
        s.pos.copy(gHover).lerp(gRest, easeInOut(k))
        orient(GUNSHIP_APPROACH.tangent(1, _t), 0, s.quat, 0)
        s.gear = seg(k, 0.05, 0.55); s.thrust = 0.45 * (1 - k); s.speed = 0
        break
      case 'landed':
        s.pos.copy(gRest)
        orient(GUNSHIP_APPROACH.tangent(1, _t), 0, s.quat, 0)
        s.gear = 1; s.thrust = 0; s.speed = 0
        break
      case 'liftoff': {
        s.pos.copy(gRest).lerp(gHover, easeInOut(k))
        // swing the nose from the way it came in to the way it is leaving
        const q0 = orient(GUNSHIP_APPROACH.tangent(1, _t), 0, new THREE.Quaternion(), 0)
        s.quat.copy(q0).slerp(orient(GUNSHIP_DEPART.tangent(0, _t), 0, new THREE.Quaternion(), 0), easeInOut(seg(k, 0.15, 1)))
        s.gear = 1 - seg(k, 0.35, 0.95); s.thrust = 0.3 + 0.5 * k; s.speed = 0
        break
      }
      case 'depart': {
        const u = Math.pow(k, 1.7) // slow off the hover, flat out by the mountains
        const speed = (GUNSHIP_DEPART.length * 1.7 * Math.pow(k, 0.7)) / T.depart
        GUNSHIP_DEPART.point(u, s.pos)
        s.bank = GUNSHIP_DEPART.bank(u, Math.max(speed, 40), 1.0) * seg(k, 0, 0.12)
        orient(GUNSHIP_DEPART.tangent(u, _t), s.bank, s.quat, seg(k, 0, 0.1))
        s.gear = 0; s.thrust = 1; s.speed = speed
        break
      }
    }
    return s
  }
}

// ======================================================================= SAIL BARGE
export const BARGE = {
  /** it circles the base out on the dunes, well beyond the walker's lane (525 m) */
  radius: 780,
  /** ground speed, m/s (clockwise, against the walker) */
  speed: 9,
  /** clearance kept between the keel and the highest ground under the hull */
  hover: 6,
  /** hull length, used to sample the ground under bow and stern */
  length: 32,
  startAngle: 0.55,
}

export interface BargePose { x: number; y: number; z: number; heading: number; pitch: number; roll: number }

function bargeAngle(t: number) { return BARGE.startAngle - (BARGE.speed / BARGE.radius) * t }

/** Highest ground under the hull when its centre is at angle a on the circle. */
function groundUnder(a: number) {
  let h = -Infinity
  for (let i = -2; i <= 2; i++) {
    const b = a + (i * BARGE.length * 0.3) / BARGE.radius
    h = Math.max(h, terrainHeight(Math.cos(b) * BARGE.radius, Math.sin(b) * BARGE.radius))
  }
  return h
}

/** Where the sail barge is at time t. Heading is the yaw of a +Z-facing model. */
export function bargeAt(t: number, out: BargePose = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 }): BargePose {
  const a = bargeAngle(t)
  out.x = Math.cos(a) * BARGE.radius
  out.z = Math.sin(a) * BARGE.radius
  // ride smoothly over the dunes: average the ground a little ahead and behind
  const da = 14 / BARGE.radius
  const g0 = groundUnder(a - da), g1 = groundUnder(a), g2 = groundUnder(a + da)
  out.y = (g0 + 2 * g1 + g2) / 4 + BARGE.hover + Math.sin(t * 0.5) * 0.35
  // travelling with decreasing angle: tangent = (sin a, -cos a)
  out.heading = Math.atan2(Math.sin(a), -Math.cos(a))
  // nose follows the slope it is climbing (ahead = smaller angle), plus a slow sway
  out.pitch = Math.atan2(g0 - g2, 28) * 0.6
  out.roll = Math.sin(t * 0.31) * 0.025
  return out
}

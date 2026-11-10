// Footwork for the duellists: feet that plant, hold their ground, and step when the body has moved
// far enough. Pure TypeScript (no React), unit-tested. Simulated scenery.
import * as THREE from 'three'

export const LEG = {
  /** hip joint height above the ground when standing */
  hip: 0.88,
  thigh: 0.47,
  shin: 0.47,
  /** ankle height above the sole */
  ankle: 0.07,
  /** half the distance between the hip joints */
  hipHalf: 0.1,
}

export const STEP = {
  /** stance: each foot sits this far to its side, the left one ahead and the right one behind */
  side: 0.17,
  lead: 0.16,
  /** a planted foot steps once it is this far from where it should be */
  trigger: 0.26,
  /** seconds per step, and how high the foot lifts */
  time: 0.19,
  lift: 0.11,
  /** beyond this the foot is simply placed (first frame, or a camera-cut sized jump) */
  snap: 0.9,
}

export interface Foot {
  /** sole position (world) */
  pos: THREE.Vector3
  /** yaw of the boot */
  yaw: number
  /** 1 = planted; 0..1 = part-way through a step */
  k: number
  from: THREE.Vector3
  to: THREE.Vector3
}

const mkFoot = (): Foot => ({ pos: new THREE.Vector3(), yaw: 0, k: 1, from: new THREE.Vector3(), to: new THREE.Vector3() })
const smooth = (k: number) => k * k * (3 - 2 * k)
const _ideal = new THREE.Vector3()
const _vel = new THREE.Vector3()

export class Footwork {
  /** [left, right] — left is the +X side of a +Z-facing figure */
  readonly feet: [Foot, Foot] = [mkFoot(), mkFoot()]
  private last = new THREE.Vector3()
  private ready = false

  /** Where a foot belongs for a body standing at `pos` facing `heading`. */
  ideal(i: 0 | 1, pos: THREE.Vector3, heading: number, out = new THREE.Vector3(), stance = 1) {
    const s = i === 0 ? 1 : -1
    const fx = Math.sin(heading), fz = Math.cos(heading)
    // left of a +Z-facing figure is +X: (cos h, 0, -sin h)
    // a wider stance is mostly a longer one: the lead foot reaches forward, the rear foot drives back
    const side = STEP.side * (1 + (stance - 1) * 0.25) * s
    const lead = STEP.lead * stance * s
    return out.set(pos.x + fz * side + fx * lead, pos.y, pos.z - fx * side + fz * lead)
  }

  /**
   * Advance by dt. `pos` is the point on the ground under the body, `airborne` the height of a hop
   * (0 when grounded): in the air both feet travel with the body, tucked up. `stance` widens the feet
   * for a lunge (1 = standing).
   */
  update(pos: THREE.Vector3, heading: number, dt: number, airborne = 0, stance = 1) {
    if (!this.ready) this.last.copy(pos)
    _vel.subVectors(pos, this.last).divideScalar(Math.max(dt, 1e-4))
    if (_vel.length() > 12) _vel.set(0, 0, 0)
    this.last.copy(pos)
    this.feet.forEach((f, idx) => {
      const i = idx as 0 | 1
      const other = this.feet[1 - idx]
      this.ideal(i, pos, heading, _ideal, stance)
      f.yaw = heading + (i === 0 ? 0.28 : -0.28)
      const off = Math.hypot(f.pos.x - _ideal.x, f.pos.z - _ideal.z)
      if (!this.ready || off > STEP.snap || airborne > 0.03) {
        f.pos.copy(_ideal)
        f.pos.y = _ideal.y + airborne
        f.k = 1
        return
      }
      if (f.k >= 1) {
        f.pos.y = _ideal.y // landed
        if (off > STEP.trigger && other.k >= 1) {
          f.k = 0
          f.from.copy(f.pos)
        }
      }
      if (f.k < 1) {
        f.k = Math.min(1, f.k + dt / STEP.time)
        // aim a little past the ideal spot, in the direction the body is travelling
        f.to.copy(_ideal).addScaledVector(_vel, STEP.time * 0.9)
        f.to.y = _ideal.y
        f.pos.lerpVectors(f.from, f.to, smooth(f.k))
        f.pos.y = _ideal.y + Math.sin(Math.PI * f.k) * STEP.lift
      }
    })
    this.ready = true
  }
}

const _d = new THREE.Vector3()
const _n = new THREE.Vector3()

/** Two-bone IK: knee position for a hip and an ankle, bending towards `forward`. */
export function kneeOf(hip: THREE.Vector3, ankle: THREE.Vector3, forward: THREE.Vector3, out: THREE.Vector3) {
  const L1 = LEG.thigh, L2 = LEG.shin
  _d.subVectors(ankle, hip)
  const raw = _d.length() || 1e-6
  const dist = Math.min(raw, L1 + L2 - 1e-3)
  _d.divideScalar(raw)
  const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist)
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a))
  _n.copy(forward).addScaledVector(_d, -forward.dot(_d))
  if (_n.lengthSq() < 1e-8) _n.set(0, 0, 1)
  _n.normalize()
  return out.copy(hip).addScaledVector(_d, a).addScaledVector(_n, h)
}

// IMPERIAL BASE — procedural humanoid rig. Pure pose math, no React.
//
// A ~1.78 m adult built from rigid parts. Each part has a pivot (joint) and a
// local transform relative to its parent. `computePose` fills a Pose with
// per-part local position + Euler rotation (order XYZ); `poseToMatrices`
// runs forward kinematics into world matrices.
//
// Conventions: the character faces +Z, +Y up, its LEFT side is +X.
//   rotX > 0 tips a part's top forward / its bottom backward
//            (thigh rotX < 0 swings the leg forward, knee rotX > 0 bends the knee,
//             forearm rotX < 0 flexes the elbow, head rotX > 0 looks down)
//   rotZ > 0 swings a hanging limb toward +X (outward for left limbs)
//
// `phase` semantics: for 'walk' it is gait cycles (advance it by
// gaitCadence(speed, stride) * dt); for every other action it is seconds.
// Callers add a per-character offset so nobody moves in lock-step.

import { Euler, Matrix4, Quaternion, Vector3 } from 'three'

export type Action = 'walk' | 'idle' | 'work' | 'guard' | 'salute' | 'inspect' | 'talk'

export const PART = {
  pelvis: 0,
  torso: 1,
  head: 2,
  helmet: 3,
  upperArmL: 4,
  upperArmR: 5,
  forearmL: 6,
  forearmR: 7,
  thighL: 8,
  thighR: 9,
  shinL: 10,
  shinR: 11,
} as const
export type PartName = keyof typeof PART
export const PART_COUNT = 12
export const PART_NAMES: PartName[] = [
  'pelvis', 'torso', 'head', 'helmet', 'upperArmL', 'upperArmR',
  'forearmL', 'forearmR', 'thighL', 'thighR', 'shinL', 'shinR',
]
/** Parent index per part (-1 = root). Parents always precede children. */
export const PART_PARENT: readonly number[] = [-1, 0, 1, 2, 1, 1, 4, 5, 0, 0, 8, 9]

/** Body dimensions in metres. */
export const BODY = {
  sole: 0.045, // boot sole below the ankle pivot-chain
  shin: 0.455, // knee -> ankle
  thigh: 0.44, // hip -> knee
  hipX: 0.088, // hip joint lateral offset
  waist: 0.1, // hip joint -> waist pivot
  torso: 0.44, // waist -> neck base
  shoulderX: 0.188,
  shoulderY: 0.395, // waist -> shoulder joint
  upperArm: 0.29,
  forearm: 0.255, // elbow -> wrist
  hand: 0.085,
  headCenter: 0.165, // neck base -> skull centre
} as const
export const HIP_HEIGHT = BODY.sole + BODY.shin + BODY.thigh
export const CHARACTER_HEIGHT = HIP_HEIGHT + BODY.waist + BODY.torso + BODY.headCenter + 0.125

export interface Pose {
  /** PART_COUNT * 3 local positions */
  pos: Float32Array
  /** PART_COUNT * 3 local Euler XYZ rotations (radians) */
  rot: Float32Array
}

export interface PoseOptions {
  /** per-character variation seed in [0,1) */
  seed?: number
  /** stride length multiplier (~0.9..1.1), see strideScaleFor */
  stride?: number
  /** carrying a rifle across the chest (troopers) */
  carry?: boolean
}

/** Rifle mount in the TORSO frame (centre of the weapon, held diagonally, muzzle up-left). */
export const RIFLE_LOCAL = { x: -0.005, y: 0.2, z: 0.2, rotX: 0.12, rotY: 0, rotZ: -0.78 }

export function createPose(): Pose {
  const p = { pos: new Float32Array(PART_COUNT * 3), rot: new Float32Array(PART_COUNT * 3) }
  setRest(p)
  return p
}

export function copyPose(src: Pose, dst: Pose): Pose {
  dst.pos.set(src.pos)
  dst.rot.set(src.rot)
  return dst
}

/** out = a + (b - a) * t (component-wise; fine for the small angle ranges used here). */
export function lerpPose(a: Pose, b: Pose, t: number, out: Pose): Pose {
  const n = PART_COUNT * 3
  for (let i = 0; i < n; i++) {
    out.pos[i] = a.pos[i] + (b.pos[i] - a.pos[i]) * t
    out.rot[i] = a.rot[i] + (b.rot[i] - a.rot[i]) * t
  }
  return out
}

/** Integer hash -> [0,1). Deterministic, used for per-character variation. */
export function hash01(n: number): number {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** Per-character stride multiplier in [0.9, 1.1]. */
export function strideScaleFor(index: number): number {
  return 0.9 + hash01(index * 7 + 3) * 0.2
}

/** Full gait-cycle length (two steps) in metres at a given speed. */
export function strideLength(speed: number, scale = 1): number {
  return scale * (0.72 + 0.57 * Math.min(Math.max(speed, 0), 2.6))
}

/** Gait cycles per second so the feet do not slide. */
export function gaitCadence(speed: number, scale = 1): number {
  if (speed <= 0) return 0
  return speed / strideLength(speed, scale)
}

/** Advance an animation phase by dt for the given action (gait cycles while walking, seconds otherwise). */
export function advancePhase(phase: number, action: Action, speed: number, dt: number, scale = 1): number {
  if (action === 'walk' && speed > WALK_MIN_SPEED) return phase + gaitCadence(speed, scale) * dt
  return phase + dt
}

export const WALK_MIN_SPEED = 0.05

// ------------------------------------------------------------------ helpers

const TAU = Math.PI * 2
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const smooth = (t: number) => {
  const c = clamp(t, 0, 1)
  return c * c * (3 - 2 * c)
}

function setRest(o: Pose) {
  o.pos.fill(0)
  o.rot.fill(0)
  setPos(o, PART.pelvis, 0, HIP_HEIGHT, 0)
  setPos(o, PART.torso, 0, BODY.waist, 0)
  setPos(o, PART.head, 0, BODY.torso, 0)
  setPos(o, PART.upperArmL, BODY.shoulderX, BODY.shoulderY, 0)
  setPos(o, PART.upperArmR, -BODY.shoulderX, BODY.shoulderY, 0)
  setPos(o, PART.forearmL, 0, -BODY.upperArm, 0)
  setPos(o, PART.forearmR, 0, -BODY.upperArm, 0)
  setPos(o, PART.thighL, BODY.hipX, 0, 0)
  setPos(o, PART.thighR, -BODY.hipX, 0, 0)
  setPos(o, PART.shinL, 0, -BODY.thigh, 0)
  setPos(o, PART.shinR, 0, -BODY.thigh, 0)
}

function setPos(o: Pose, part: number, x: number, y: number, z: number) {
  o.pos[part * 3] = x
  o.pos[part * 3 + 1] = y
  o.pos[part * 3 + 2] = z
}
function setRot(o: Pose, part: number, x: number, y: number, z: number) {
  o.rot[part * 3] = x
  o.rot[part * 3 + 1] = y
  o.rot[part * 3 + 2] = z
}
function addRot(o: Pose, part: number, x: number, y: number, z: number) {
  o.rot[part * 3] += x
  o.rot[part * 3 + 1] += y
  o.rot[part * 3 + 2] += z
}
function addPos(o: Pose, part: number, x: number, y: number, z: number) {
  o.pos[part * 3] += x
  o.pos[part * 3 + 1] += y
  o.pos[part * 3 + 2] += z
}

/** Relaxed hanging arms. */
function hangArms(o: Pose, sway: number, seed: number) {
  const out = 0.075 + seed * 0.03
  setRot(o, PART.upperArmL, 0.03 + sway, 0, out)
  setRot(o, PART.upperArmR, 0.03 - sway, 0, -out)
  setRot(o, PART.forearmL, -0.16 - seed * 0.08, 0, 0)
  setRot(o, PART.forearmR, -0.16 - seed * 0.08, 0, 0)
}

/** Standing legs with weight shift (shift in [-1,1], +1 = weight on left leg). */
function standLegs(o: Pose, shift: number, spread: number) {
  const roll = 0.035 * shift
  addPos(o, PART.pelvis, 0.028 * shift, 0, 0)
  addRot(o, PART.pelvis, 0, 0.03 * shift, roll)
  addRot(o, PART.torso, 0, -0.02 * shift, -roll * 0.8)
  const bendR = Math.max(0, shift)
  const bendL = Math.max(0, -shift)
  setRot(o, PART.thighL, -0.09 * bendL, -0.06, spread - roll - 0.02 * bendL)
  setRot(o, PART.thighR, -0.09 * bendR, 0.06, -spread - roll + 0.02 * bendR)
  setRot(o, PART.shinL, 0.03 + 0.2 * bendL, 0, 0)
  setRot(o, PART.shinR, 0.03 + 0.2 * bendR, 0, 0)
}

// --- two-bone arm IK, everything in the torso frame
const _S = new Vector3()
const _T = new Vector3()
const _D = new Vector3()
const _P = new Vector3()
const _U = new Vector3()
const _E = new Vector3()
const _F = new Vector3()
const _X = new Vector3()
const _Y = new Vector3()
const _Z = new Vector3()
const _M = new Matrix4()
const _EU = new Euler()

/**
 * Place the wrist (plus `extra` metres along the hand) at target (tx,ty,tz) in the torso frame.
 * (px,py,pz) is the pole direction: where the elbow should point.
 */
function armIK(o: Pose, left: boolean, tx: number, ty: number, tz: number, px: number, py: number, pz: number, extra = 0.04) {
  const a = BODY.upperArm
  const b = BODY.forearm + extra
  _S.set(left ? BODY.shoulderX : -BODY.shoulderX, BODY.shoulderY, 0)
  _T.set(tx, ty, tz)
  _D.subVectors(_T, _S)
  let d = _D.length()
  if (d < 1e-5) {
    _D.set(0, -1, 0)
    d = 1e-5
  }
  _D.divideScalar(d)
  d = clamp(d, Math.abs(a - b) + 0.01, a + b - 0.002)
  // elbow
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1)
  const sinA = Math.sqrt(1 - cosA * cosA)
  _P.set(px, py, pz)
  _P.addScaledVector(_D, -_P.dot(_D))
  if (_P.lengthSq() < 1e-8) _P.set(0, -1, -0.2).addScaledVector(_D, -_D.y)
  _P.normalize()
  _U.copy(_D).multiplyScalar(cosA).addScaledVector(_P, sinA) // shoulder->elbow unit
  _E.copy(_S).addScaledVector(_U, a)
  _F.copy(_S).addScaledVector(_D, d).sub(_E).normalize() // elbow->wrist unit
  // upper-arm frame: -Y along the bone, +Z toward the forearm (inner elbow)
  _Y.copy(_U).negate()
  _Z.copy(_F).addScaledVector(_Y, -_F.dot(_Y))
  if (_Z.lengthSq() < 1e-8) _Z.set(0, 0, 1).addScaledVector(_Y, -_Y.z)
  _Z.normalize()
  _X.crossVectors(_Y, _Z)
  _M.makeBasis(_X, _Y, _Z)
  _EU.setFromRotationMatrix(_M, 'XYZ')
  const ua = left ? PART.upperArmL : PART.upperArmR
  setRot(o, ua, _EU.x, _EU.y, _EU.z)
  // elbow flex: angle between bones
  const bend = Math.acos(clamp(_U.dot(_F), -1, 1))
  setRot(o, left ? PART.forearmL : PART.forearmR, -bend, 0, 0)
}

/** Hands on the rifle held across the chest. */
const RIFLE_DIR_X = -Math.sin(RIFLE_LOCAL.rotZ)
const RIFLE_DIR_Y = Math.cos(RIFLE_LOCAL.rotZ)
function rifleArms(o: Pose, jig: number) {
  const cx = RIFLE_LOCAL.x
  const cy = RIFLE_LOCAL.y + jig
  const cz = RIFLE_LOCAL.z
  // right hand on the grip (below centre), left hand on the fore-grip
  armIK(o, false, cx - 0.12 * RIFLE_DIR_X, cy - 0.12 * RIFLE_DIR_Y, cz - 0.01, -0.7, -0.6, -0.25, 0.03)
  armIK(o, true, cx + 0.15 * RIFLE_DIR_X, cy + 0.15 * RIFLE_DIR_Y, cz + 0.02, 0.8, -0.55, -0.1, 0.03)
}

/** Lift the pelvis so the lower foot rests on the ground. */
function groundFix(o: Pose) {
  const pr = o.rot[PART.pelvis * 3]
  const prz = o.rot[PART.pelvis * 3 + 2]
  const drop = (thigh: number, shin: number) => {
    const tx = pr + o.rot[thigh * 3]
    const kx = o.rot[shin * 3]
    const tz = prz + o.rot[thigh * 3 + 2]
    return (BODY.thigh * Math.cos(tx) + BODY.shin * Math.cos(tx + kx)) * Math.cos(tz)
  }
  const dl = drop(PART.thighL, PART.shinL)
  const dr = drop(PART.thighR, PART.shinR)
  // roll lifts one hip relative to the other
  const rollLift = Math.sin(prz) * BODY.hipX
  const yl = dl - rollLift
  const yr = dr + rollLift
  o.pos[PART.pelvis * 3 + 1] = BODY.sole + Math.max(yl, yr) + (o.pos[PART.pelvis * 3 + 1] - HIP_HEIGHT)
}

// ------------------------------------------------------------------ actions

function walkPose(o: Pose, phase: number, speed: number, stride: number, seed: number, carry: boolean) {
  const a = phase * TAU
  const s = Math.sin(a)
  const c = Math.cos(a)
  const len = strideLength(speed, stride)
  const legLen = BODY.thigh + BODY.shin
  const A = Math.asin(clamp(len / (4 * legLen), 0, 0.8)) // hip swing amplitude
  const k = A / 0.42 // normalised effort
  const brisk = 0.9 + seed * 0.2

  // legs: left forward when sin(a) > 0, right half a cycle later
  setRot(o, PART.thighL, -A * s - 0.04 * k, 0, 0.012)
  setRot(o, PART.thighR, A * s - 0.04 * k, 0, -0.012)
  const swingL = Math.max(0, c)
  const swingR = Math.max(0, -c)
  setRot(o, PART.shinL, 0.07 + 1.0 * k * swingL * swingL, 0, 0)
  setRot(o, PART.shinR, 0.07 + 1.0 * k * swingR * swingR, 0, 0)

  // pelvis: lateral sway toward stance leg, twist and slight roll
  addPos(o, PART.pelvis, -0.018 * c * k, 0, 0)
  setRot(o, PART.pelvis, 0, 0.11 * s * k, 0.035 * c * k)
  // torso counter-rotation + forward lean grows with speed
  setRot(o, PART.torso, 0.045 + 0.05 * k + 0.01 * Math.sin(2 * a), -0.15 * s * k, -0.03 * c * k)
  // head stabilises
  setRot(o, PART.head, -0.03 - 0.01 * Math.sin(2 * a) + 0.02 * seed, 0.06 * s * k, 0.018 * c * k)

  if (carry) {
    rifleArms(o, 0.008 * Math.sin(2 * a))
  } else {
    // arms opposite legs
    const B = 0.38 * k * brisk
    const out = 0.07 + 0.02 * seed
    setRot(o, PART.upperArmL, B * s + 0.02, 0, out)
    setRot(o, PART.upperArmR, -B * s + 0.02, 0, -out)
    setRot(o, PART.forearmL, -0.22 - 0.28 * k * Math.max(0, -s), 0, 0)
    setRot(o, PART.forearmR, -0.22 - 0.28 * k * Math.max(0, s), 0, 0)
  }
}

function breath(phase: number, seed: number) {
  return Math.sin(phase * TAU / (3.8 + seed * 1.4) + seed * 11)
}
function weightShift(phase: number, seed: number) {
  return Math.tanh(2.6 * Math.sin(phase * (0.42 + seed * 0.3) + seed * 40))
}
function lookAround(phase: number, seed: number) {
  return 0.32 * Math.sin(phase * (0.19 + seed * 0.13) + seed * 23) + 0.12 * Math.sin(phase * 0.53 + seed * 7)
}

function idlePose(o: Pose, phase: number, seed: number, carry: boolean) {
  const b = breath(phase, seed)
  const sh = weightShift(phase, seed)
  standLegs(o, sh, 0.045)
  addPos(o, PART.torso, 0, 0.004 * b, 0)
  setRot(o, PART.torso, -0.015 + 0.012 * b + o.rot[PART.torso * 3], o.rot[PART.torso * 3 + 1], o.rot[PART.torso * 3 + 2])
  setRot(o, PART.head, 0.04 + 0.04 * Math.sin(phase * 0.31 + seed * 5), lookAround(phase, seed), 0.02 * sh)
  if (carry) {
    rifleArms(o, 0.004 * b)
  } else if (seed < 0.32) {
    // hands clasped behind the back (parade rest)
    armIK(o, true, 0.05, 0.03 + 0.003 * b, -0.15, 1, -0.2, -0.6, 0.02)
    armIK(o, false, -0.05, 0.03 + 0.003 * b, -0.15, -1, -0.2, -0.6, 0.02)
  } else {
    hangArms(o, 0.012 * b, seed)
  }
}

function workPose(o: Pose, phase: number, seed: number) {
  const b = breath(phase, seed)
  standLegs(o, weightShift(phase, seed) * 0.45, 0.06)
  setRot(o, PART.torso, 0.16 + 0.01 * b, 0.03 * Math.sin(phase * 0.21 + seed * 9), o.rot[PART.torso * 3 + 2])
  setRot(o, PART.head, 0.36 + 0.05 * Math.sin(phase * 0.4 + seed), 0.18 * Math.sin(phase * 0.17 + seed * 13), 0)
  // typing: quick alternating taps, occasional reach across the panel
  const tapL = Math.max(0, Math.sin(phase * 17.0 + seed * 3)) ** 3
  const tapR = Math.max(0, Math.sin(phase * 15.3 + seed * 5 + 1.7)) ** 3
  const reach = smooth((Math.sin(phase * 0.37 + seed * 17) - 0.55) * 3)
  const side = Math.sin(phase * 0.11 + seed * 3) > 0 ? 1 : -1
  const rL = side > 0 ? reach : 0
  const rR = side < 0 ? reach : 0
  armIK(o, true, 0.15 + 0.12 * rL, 0.1 + 0.018 * tapL + 0.09 * rL, 0.34 + 0.08 * rL, 0.6, -0.8, -0.3)
  armIK(o, false, -0.15 - 0.12 * rR, 0.1 + 0.018 * tapR + 0.09 * rR, 0.34 + 0.08 * rR, -0.6, -0.8, -0.3)
}

function guardPose(o: Pose, phase: number, seed: number, carry: boolean) {
  const b = breath(phase, seed)
  setRot(o, PART.thighL, 0, -0.08, 0.07)
  setRot(o, PART.thighR, 0, 0.08, -0.07)
  setRot(o, PART.shinL, 0.02, 0, 0)
  setRot(o, PART.shinR, 0.02, 0, 0)
  setRot(o, PART.torso, -0.03 + 0.006 * b, 0, 0)
  // slow, deliberate scan: hold, turn, hold
  const scan = Math.tanh(3 * Math.sin(phase * (0.16 + seed * 0.08) + seed * 31)) * 0.35
  setRot(o, PART.head, -0.02, scan, 0)
  if (carry) rifleArms(o, 0.003 * b)
  else {
    // sidearm guard: hands clasped in front
    armIK(o, true, 0.04, 0.0, 0.13, 1, -0.4, 0, 0.03)
    armIK(o, false, -0.04, 0.0, 0.13, -1, -0.4, 0, 0.03)
  }
}

function salutePose(o: Pose, phase: number, seed: number) {
  const b = breath(phase, seed)
  setRot(o, PART.thighL, 0, -0.1, 0.02)
  setRot(o, PART.thighR, 0, 0.1, -0.02)
  setRot(o, PART.torso, -0.05 + 0.005 * b, 0, 0)
  setRot(o, PART.head, -0.04, 0, 0)
  // left arm at attention
  setRot(o, PART.upperArmL, 0.02, 0, 0.05)
  setRot(o, PART.forearmL, -0.08, 0, 0)
  // right hand to the brow
  const headY = BODY.torso + BODY.headCenter
  armIK(o, false, -0.105, headY + 0.05, 0.115, -1, 0.15, 0.35, 0.06)
}

const _saveRot = new Float32Array(PART_COUNT * 3)
/** Arms = saved + (current - saved) * t. Upper arms + forearms occupy parts 4..7. */
function blendArmsFromSave(o: Pose, t: number) {
  for (let j = PART.upperArmL * 3; j < (PART.forearmR + 1) * 3; j++) o.rot[j] = _saveRot[j] + (o.rot[j] - _saveRot[j]) * t
}

function inspectPose(o: Pose, phase: number, seed: number, tmpB: Pose) {
  // mode A: standing, looking up at the airframe, sometimes pointing
  const b = breath(phase, seed)
  standLegs(o, weightShift(phase, seed) * 0.6, 0.07)
  setRot(o, PART.torso, -0.14 + 0.01 * b, 0.12 * Math.sin(phase * 0.23 + seed * 3), o.rot[PART.torso * 3 + 2])
  setRot(o, PART.head, -0.5 + 0.08 * Math.sin(phase * 0.5 + seed), 0.25 * Math.sin(phase * 0.29 + seed * 11), 0)
  const point = smooth((Math.sin(phase * 0.45 + seed * 19) - 0.2) * 2.5)
  hangArms(o, 0, seed)
  // left hand resting on hip
  armIK(o, true, 0.2, -0.02, 0.02, 1, 0, -0.5, 0.02)
  if (point > 0.01) {
    _saveRot.set(o.rot)
    armIK(o, false, -0.35, 0.95, 0.55, -1, -0.5, 0)
    blendArmsFromSave(o, point)
  }

  // mode B: kneeling, checking something low (landing gear, panel)
  const kneel = smooth((Math.sin(phase * (0.13 + seed * 0.05) + seed * 29) + 0.1) * 2.2)
  if (kneel <= 0.001) return
  setRest(tmpB)
  setRot(tmpB, PART.thighL, -1.48, -0.1, 0.12)
  setRot(tmpB, PART.shinL, 1.5, 0, 0)
  setRot(tmpB, PART.thighR, 0.06, 0.05, -0.06)
  setRot(tmpB, PART.shinR, 1.52, 0, 0)
  setRot(tmpB, PART.torso, 0.32 + 0.01 * b, -0.1, 0)
  setRot(tmpB, PART.head, 0.25, 0.3 * Math.sin(phase * 0.4 + seed * 2), 0)
  // left forearm on the raised knee, right hand reaching forward-low
  armIK(tmpB, true, 0.13, -0.08, 0.3, 1, -0.3, -0.3)
  const work = Math.sin(phase * 2.1 + seed * 7) * 0.03
  armIK(tmpB, false, -0.12, -0.3 + work, 0.42, -1, -0.3, -0.3)
  lerpPose(o, tmpB, kneel, o)
}

function talkPose(o: Pose, phase: number, seed: number) {
  const b = breath(phase, seed)
  const sh = weightShift(phase, seed)
  standLegs(o, sh, 0.06)
  setRot(o, PART.torso, -0.01 + 0.012 * b, 0.08 * Math.sin(phase * 0.6 + seed * 4), o.rot[PART.torso * 3 + 2])
  // speaking turns: gesture intensity rises and falls
  const turn = smooth((Math.sin(phase * (0.35 + seed * 0.2) + seed * 37) + 0.3) * 1.8)
  const nod = Math.sin(phase * 3.1 + seed * 5) * 0.05 * (0.4 + turn)
  setRot(o, PART.head, 0.03 + nod, 0.22 * Math.sin(phase * 0.27 + seed * 15), 0.04 * Math.sin(phase * 0.8))
  hangArms(o, 0, seed)
  if (turn < 0.01) return
  const g1 = Math.sin(phase * 2.3 + seed * 9)
  const g2 = Math.sin(phase * 1.7 + seed * 3 + 1)
  const both = seed > 0.5
  _saveRot.set(o.rot)
  armIK(o, false, -0.16 - 0.06 * g2, 0.12 + 0.06 * g1, 0.3 + 0.04 * g2, -1, -0.6, -0.2)
  if (both) armIK(o, true, 0.17 + 0.05 * g1, 0.08 + 0.05 * g2, 0.27, 1, -0.6, -0.2)
  blendArmsFromSave(o, turn)
}

const _tmpPose: Pose = { pos: new Float32Array(PART_COUNT * 3), rot: new Float32Array(PART_COUNT * 3) }
const NO_OPTS: PoseOptions = {}

/**
 * Write the pose for `action` at `phase` into `out` (local transforms per part).
 * Deterministic: same inputs -> same output. Returns `out`.
 */
export function computePose(action: Action, phase: number, speed: number, out: Pose, opts: PoseOptions = NO_OPTS): Pose {
  const seed = opts.seed ?? 0
  const stride = opts.stride ?? 1
  const carry = opts.carry ?? false
  setRest(out)
  switch (action) {
    case 'walk':
      if (speed > WALK_MIN_SPEED) walkPose(out, phase, speed, stride, seed, carry)
      else idlePose(out, phase, seed, carry)
      break
    case 'idle':
      idlePose(out, phase, seed, carry)
      break
    case 'work':
      workPose(out, phase, seed)
      break
    case 'guard':
      guardPose(out, phase, seed, carry)
      break
    case 'salute':
      salutePose(out, phase, seed)
      if (carry) {
        // rifle stays slung in the left hand
        armIK(out, true, RIFLE_LOCAL.x + 0.15 * RIFLE_DIR_X, RIFLE_LOCAL.y + 0.15 * RIFLE_DIR_Y, RIFLE_LOCAL.z + 0.02, 0.8, -0.55, -0.1, 0.03)
      }
      break
    case 'inspect':
      inspectPose(out, phase, seed, _tmpPose)
      break
    case 'talk':
      talkPose(out, phase, seed)
      break
  }
  groundFix(out)
  return out
}

// ------------------------------------------------------------------ forward kinematics

const _q = new Quaternion()
const _e = new Euler(0, 0, 0, 'XYZ')
const _v = new Vector3()
const _one = new Vector3(1, 1, 1)
const _local = new Matrix4()

/** Compose a local matrix for one part. */
export function partLocalMatrix(pose: Pose, part: number, out: Matrix4): Matrix4 {
  const i = part * 3
  _e.set(pose.rot[i], pose.rot[i + 1], pose.rot[i + 2], 'XYZ')
  _q.setFromEuler(_e)
  _v.set(pose.pos[i], pose.pos[i + 1], pose.pos[i + 2])
  return out.compose(_v, _q, _one)
}

/** World matrix per part = root * chain of locals. `out` must hold PART_COUNT matrices. */
export function poseToMatrices(pose: Pose, root: Matrix4, out: Matrix4[]): Matrix4[] {
  for (let p = 0; p < PART_COUNT; p++) {
    partLocalMatrix(pose, p, _local)
    const parent = PART_PARENT[p]
    out[p].multiplyMatrices(parent < 0 ? root : out[parent], _local)
  }
  return out
}

/** Root transform for a character at (x,y,z) facing `heading` (0 faces +Z). */
export function rootMatrix(x: number, y: number, z: number, heading: number, out: Matrix4): Matrix4 {
  const c = Math.cos(heading)
  const s = Math.sin(heading)
  // rotation about Y
  out.set(c, 0, s, x, 0, 1, 0, y, -s, 0, c, z, 0, 0, 0, 1)
  return out
}

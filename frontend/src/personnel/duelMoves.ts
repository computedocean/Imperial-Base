// Lightsaber duel on Secondary Pad 2 — choreography. Pure TypeScript (no React), deterministic, unit-tested.
// Simulated scenery: it never represents real-world activity.
//
// Staged after a master-and-apprentice sparring match: the two face off at a distance and ignite,
// circle in, and the apprentice attacks hard while the master gives ground. They lock blades face to
// face, shove apart, and the master takes the initiative; the apprentice answers with a spin and a
// leaping overhead blow. A final exchange tears the apprentice's weapon from his hand, the master
// holds his blade on him, and they reset: the lost saber flies back to its owner's hand. Then again,
// somewhere else on the pad.
import * as THREE from 'three'
import { PADS } from '../world/layout'

export const DUEL_PAD = PADS[1]
export const DUEL = {
  /** blade length, m */
  blade: 1.15,
  /** height of the sword hands above the ground in a neutral guard */
  handY: 1.22,
  /** how far the fight's centre roams from the pad centre (pad radius is 18 m) */
  roam: 3.2,
}

/** One round, in seconds per phase, in this order. */
export const ROUND = {
  standoff: 5, circle: 5, attackA: 8, lock: 3.5, breakaway: 2, attackB: 8, disarm: 1.2, yield: 5.5, reset: 4.8,
}
export type DuelPhase = keyof typeof ROUND
export const PHASES = Object.keys(ROUND) as DuelPhase[]
/** Start time of each phase within a round. */
export const START = {} as Record<DuelPhase, number>
{
  let t = 0
  for (const p of PHASES) { START[p] = t; t += ROUND[p] }
}
export const ROUND_LENGTH = PHASES.reduce((s, p) => s + ROUND[p], 0)

/** The moment (within a round) the apprentice loses his weapon, and when it is back in his hand. */
export const DISARM_AT = START.disarm + 0.45
export const RECALL_FROM = START.reset + 1.0
export const RECALL_TO = START.reset + 2.4
const SPIN_AT = START.attackB + 3.1
const LEAP_AT = START.attackB + 5.2
const TEMPO_A = 2.3 // blows per second while the apprentice attacks
const TEMPO_B = 2.0

export interface Duellist {
  /** point on the ground under the body (world) */
  pos: THREE.Vector3
  /** yaw of a +Z-facing figure */
  heading: number
  /** forward lean, radians (+ = into the attack) */
  lean: number
  /** height of a hop or leap, m */
  lift: number
  /** how far the hips drop into a fighting stance, m */
  crouch: number
  /** stance width multiplier for the feet (1 = standing, larger = lunging) */
  stance: number
  /** sword hands (world) */
  hand: THREE.Vector3
  /** centre of the saber hilt (world) — the hand, unless the weapon has been knocked away */
  saber: THREE.Vector3
  /** unit blade direction (world) */
  bladeDir: THREE.Vector3
  /** 0 = blade off .. 1 = fully ignited */
  bladeLen: number
  /** false while the weapon is out of the fighter's hands */
  armed: boolean
  /** 0..1 how hard this one is pressing the attack right now */
  press: number
}

export interface DuelState {
  /** a = the master (tan robes), b = the apprentice (dark robes) */
  a: Duellist
  b: Duellist
  phase: DuelPhase
  /** which round this is (they fight again and again) */
  round: number
  /** midpoint between the fighters at chest height: where cameras look */
  focus: THREE.Vector3
  /** distance between the fighters, m */
  gap: number
  /** 1 at the instant blades meet, decaying to 0; held high while the blades are locked */
  clash: number
  /** small vertical jitter for placing the spark */
  clashSide: number
}

const mk = (): Duellist => ({
  pos: new THREE.Vector3(), heading: 0, lean: 0, lift: 0, crouch: 0, stance: 1, hand: new THREE.Vector3(), saber: new THREE.Vector3(),
  bladeDir: new THREE.Vector3(0, 1, 0), bladeLen: 0, armed: true, press: 0,
})

export function createDuelState(): DuelState {
  return { a: mk(), b: mk(), phase: 'standoff', round: 0, focus: new THREE.Vector3(), gap: 7, clash: 0, clashSide: 0 }
}

// ---------------------------------------------------------------- helpers
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const smooth = (k: number) => { const c = clamp01(k); return c * c * (3 - 2 * c) }
/** 0 before a, 1 after b, eased in between. */
const ramp = (t: number, a: number, b: number) => smooth((t - a) / (b - a))
/** 1 inside [a, b], with eased edges of width e. */
const band = (t: number, a: number, b: number, e = 0.4) => ramp(t, a, a + e) * (1 - ramp(t, b - e, b))

/** Eased interpolation through (time, value) keys. */
function track(keys: readonly (readonly [number, number])[], t: number) {
  if (t <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1], [t1, v1] = keys[i]
      return v0 + (v1 - v0) * smooth((t - t0) / (t1 - t0))
    }
  }
  return keys[keys.length - 1][1]
}

const S = START
const L = ROUND_LENGTH
/** Distance between the fighters through a round. */
const GAP = [
  [0, 7], [S.circle, 7], [S.attackA, 2.2], [S.lock, 2.2], [S.lock + 0.5, 1.2], [S.breakaway, 1.2], [S.attackB, 4.2],
  [S.attackB + 0.8, 2.2], [S.disarm, 2.2], [S.yield, 1.95], [S.yield + 1.6, 2.5], [S.reset, 2.5], [L, 7],
] as const
/** Where the midpoint sits along the line between them: negative = the master has been driven back. */
const SHOVE = [
  [0, 0], [S.attackA, 0], [S.lock, -4.3], [S.attackB, -4.3], [S.disarm, 1.4], [S.reset, 1.4], [L, 0],
] as const
/** How far the line between them has turned during the round (they circle each other). */
const TURN_PER_ROUND = 3.7
const TURN = [
  [0, 0], [S.circle, 0], [S.attackA, 1.35], [S.lock, 1.9], [S.breakaway, 2.35], [S.attackB, 2.5], [S.disarm, 3.4], [S.reset, 3.5], [L, TURN_PER_ROUND],
] as const

export function phaseAt(tau: number): DuelPhase {
  let p: DuelPhase = 'standoff'
  for (const q of PHASES) if (tau >= S[q]) p = q
  return p
}

const _axis = new THREE.Vector3()
const _left = new THREE.Vector3()
const _f = new THREE.Vector3()
const _l = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _hand = new THREE.Vector3()

interface Mix { hf: number; hl: number; hy: number; df: number; dl: number; du: number }
const mixZero = (): Mix => ({ hf: 0, hl: 0, hy: 0, df: 0, dl: 0, du: 0 })
const _mix = mixZero()
function add(m: Mix, w: number, hf: number, hl: number, hy: number, df: number, dl: number, du: number) {
  if (w <= 0) return
  m.hf += hf * w; m.hl += hl * w; m.hy += hy * w
  const n = Math.hypot(df, dl, du) || 1
  m.df += (df / n) * w; m.dl += (dl / n) * w; m.du += (du / n) * w
}

/**
 * Pose one fighter at round time tau. `who` 0 = master, 1 = apprentice. `cx, cz` is the midpoint on
 * the ground, `_axis` (set by the caller) points from the master to the apprentice.
 */
function pose(d: Duellist, who: 0 | 1, tau: number, cx: number, cz: number, gap: number, groundY: number) {
  const facing = who === 0 ? 1 : -1
  const along = who === 0 ? -gap / 2 : gap / 2
  d.pos.set(cx + _axis.x * along, groundY, cz + _axis.z * along)
  // weights of the things a fighter can be doing
  const wFight = Math.max(band(tau, S.attackA, S.lock), band(tau, S.attackB + 0.5, S.yield, 0.35))
  const wLock = band(tau, S.lock + 0.2, S.breakaway + 0.3)
  const wYield = band(tau, S.yield - 0.1, S.reset + 0.6, 0.5)
  const wGuard = clamp01(1 - wFight - wLock - wYield)
  // who is pressing: the apprentice in the first exchange, the master in the second
  const pressB = band(tau, S.attackA, S.lock, 0.6)
  const pressA = band(tau, S.attackB + 0.5, S.yield, 0.6)
  d.press = who === 0 ? pressA : pressB
  const stroke = tau < S.lock + 1 ? (tau - S.attackA) * TEMPO_A : (tau - S.attackB) * TEMPO_B

  // body
  let spin = 0
  d.lift = 0
  if (who === 1) {
    spin = Math.PI * 2 * smooth((tau - SPIN_AT) / 0.75) // a full turn, back onto the same line
    d.lift = 1.05 * Math.sin(Math.PI * clamp01((tau - LEAP_AT) / 0.75)) // the leaping overhead blow
  }
  d.heading = Math.atan2(_axis.x * facing, _axis.z * facing) + spin
  d.lean = 0.06 + 0.2 * wFight * (0.4 + 0.6 * d.press) + 0.22 * wLock
  d.crouch = 0.02 + wFight * (0.1 + 0.08 * d.press) + wLock * 0.12
  d.stance = 1 + wFight * (0.9 + 0.9 * d.press) + wLock * 1.1
  // feet-to-head bounce while fighting
  const bounce = Math.abs(Math.sin(stroke * Math.PI)) * 0.04 * wFight

  // sword hands and blade direction: a weighted blend of poses, in the fighter's own frame
  const m = _mix
  m.hf = m.hl = m.hy = m.df = m.dl = m.du = 0
  if (who === 0) add(m, wGuard, 0.32, 0.0, 1.24, 0.26, 0.05, 1) // master: blade upright before him
  else add(m, wGuard, 0.4, 0, 1.12, 0.12, 1, 0.16) // challenger: staff held level across the body
  if (wFight > 0) {
    // mirrored figure-eights: each blade passes the centre line exactly when the other does
    const sweep = Math.sin(stroke * Math.PI) * (1.05 + 0.25 * d.press)
    const overhead = who === 1 ? Math.sin(Math.PI * clamp01((tau - LEAP_AT) / 0.75)) : 0
    const raise = 0.95 + 0.42 * Math.cos(stroke * Math.PI * 2) + 0.25 * d.press + 0.5 * overhead
    add(m, wFight,
      (who === 1 ? 0.56 : 0.42) + 0.1 * d.press, Math.sin(sweep) * 0.3, DUEL.handY + 0.14 * Math.cos(stroke * Math.PI * 2) + 0.35 * overhead,
      Math.cos(sweep) * Math.cos(raise) + (who === 1 ? 0.15 : 0.4), Math.sin(sweep), Math.cos(sweep) * Math.sin(raise))
  }
  if (wLock > 0) {
    // blades crossed high between them, both leaning in; the whole bind shudders
    const tremble = Math.sin(tau * 31) * 0.03
    // hands low on the right, blade angled up to the left: the two blades make an X on the centre line
    add(m, wLock, 0.4, -0.28 + tremble, 1.38 + tremble * 0.5, 0.3, 0.55 + tremble, 0.75)
  }
  if (wYield > 0) {
    if (who === 0) add(m, wYield, 0.62, 0, 1.36, 1, 0, 0.03) // blade levelled at the beaten man
    else add(m, wYield, 0.14, 0, 0.96, 0.4, 0, -1) // empty hands, lowered
  }
  _f.set(Math.sin(d.heading), 0, Math.cos(d.heading))
  _l.set(_f.z, 0, -_f.x)
  const y = groundY + m.hy + d.lift - d.crouch + bounce
  d.hand.set(d.pos.x + _f.x * m.hf + _l.x * m.hl, y, d.pos.z + _f.z * m.hf + _l.z * m.hl)
  d.bladeDir.set(_f.x * m.df + _l.x * m.dl, m.du, _f.z * m.df + _l.z * m.dl)
  if (d.bladeDir.lengthSq() < 1e-6) d.bladeDir.set(0, 1, 0)
  d.bladeDir.normalize()
  d.saber.copy(d.hand)
  d.armed = true
}

/** Midpoint, facing line and separation at (round, tau). Sets `_axis`. Returns [cx, cz, gap]. */
function stage(round: number, tau: number, wobble: boolean): [number, number, number] {
  // each round is fought somewhere else on the pad; they walk there during the reset
  const m = round + ramp(tau, S.reset + 0.4, L)
  const ox = DUEL_PAD.x + Math.cos(m * 2.1) * DUEL.roam
  const oz = DUEL_PAD.z + Math.sin(m * 1.3 + 0.7) * DUEL.roam
  const theta = round * TURN_PER_ROUND + track(TURN, tau)
  _axis.set(Math.sin(theta), 0, Math.cos(theta))
  _left.set(_axis.z, 0, -_axis.x)
  const shove = track(SHOVE, tau)
  const fighting = Math.max(band(tau, S.attackA + 0.3, S.lock), band(tau, S.attackB + 1, S.disarm))
  const gap = track(GAP, tau) + (wobble ? Math.sin(tau * 2.3) * 0.2 * fighting : 0)
  return [ox + _axis.x * shove, oz + _axis.z * shove, gap]
}

const GRAVITY = 9.8
const _p0 = new THREE.Vector3()
const _v0 = new THREE.Vector3()
const _rest = new THREE.Vector3()
const _tmp = mk()

/** Full state of the duel at simulation time t (seconds). */
export function duelAt(t: number, out: DuelState = createDuelState()): DuelState {
  const round = Math.floor(t / L)
  const tau = t - round * L
  const pad = DUEL_PAD
  const [cx, cz, gap] = stage(round, tau, true)
  pose(out.a, 0, tau, cx, cz, gap, pad.y)
  pose(out.b, 1, tau, cx, cz, gap, pad.y)
  out.phase = phaseAt(tau)
  out.round = round
  out.gap = gap
  out.focus.set(cx, pad.y + 1.4, cz)

  // blades: the master ignites first; he switches off once the bout is over
  out.a.bladeLen = ramp(tau, 0.9, 1.25) * (1 - ramp(tau, S.reset + 0.2, S.reset + 0.55))
  out.b.bladeLen = ramp(tau, 2.0, 2.35) * (1 - ramp(tau, DISARM_AT + 0.15, DISARM_AT + 0.5))

  // the apprentice's weapon: torn from his hand, tumbling to the deck, later called back
  if (tau >= DISARM_AT && tau < RECALL_TO) {
    const b = out.b
    // where it left his hand, and which way (sideways, up and behind him)
    const [dx, dz, dgap] = stage(round, DISARM_AT, true)
    pose(_tmp, 1, DISARM_AT, dx, dz, dgap, pad.y)
    _p0.copy(_tmp.hand)
    _v0.copy(_left).multiplyScalar(3.4).addScaledVector(_axis, 2.6)
    _v0.y = 4.6
    const floor = pad.y + 0.04
    const tLand = (_v0.y + Math.sqrt(_v0.y * _v0.y + 2 * GRAVITY * (_p0.y - floor))) / GRAVITY
    const u = Math.min(tau - DISARM_AT, tLand)
    _rest.set(_p0.x + _v0.x * tLand, floor, _p0.z + _v0.z * tLand)
    b.saber.set(_p0.x + _v0.x * u, Math.max(floor, _p0.y + _v0.y * u - 0.5 * GRAVITY * u * u), _p0.z + _v0.z * u)
    // tumbling end over end, then lying flat
    const ang = u * 13
    b.bladeDir.set(_left.x * Math.cos(ang), Math.sin(ang), _left.z * Math.cos(ang))
    if (u >= tLand) b.bladeDir.set(_left.x, 0, _left.z)
    b.armed = false
    // restore the stage the caller expects (pose() above reset `_axis`)
    stage(round, tau, true)
    if (tau >= RECALL_FROM) {
      // called back: it lifts off the deck and flies to his open hand
      const k = smooth((tau - RECALL_FROM) / (RECALL_TO - RECALL_FROM))
      _hand.copy(out.b.hand)
      b.saber.lerpVectors(_rest, _hand, k)
      b.saber.y += Math.sin(Math.PI * k) * 0.5
      _dir.set(_left.x, 0, _left.z).lerp(_tmp.bladeDir.set(0.3, -1, 0), k).normalize()
      b.bladeDir.copy(_dir)
    }
  }

  // clashes: once per blow while they fight, a continuous grind while locked, one great flash at the disarm
  const strokeA = (tau - S.attackA) * TEMPO_A
  const strokeB = (tau - S.attackB) * TEMPO_B
  let clash = 0
  if (tau >= S.attackA && tau < S.lock + 0.2) clash = Math.exp(-(strokeA - Math.floor(strokeA)) * 8)
  else if (tau >= S.attackB + 0.8 && tau < DISARM_AT) clash = Math.exp(-(strokeB - Math.floor(strokeB)) * 8)
  clash = Math.max(clash, band(tau, S.lock + 0.3, S.breakaway + 0.15, 0.2) * (0.6 + 0.3 * Math.sin(tau * 43)))
  if (tau >= DISARM_AT) clash = Math.max(clash, Math.exp(-(tau - DISARM_AT) * 5))
  out.clash = clamp01(clash)
  out.clashSide = Math.sin(Math.floor(tau * 2.3) * 2.4)
  return out
}

// Lightsaber duel on Secondary Pad 2 — choreography. Pure TypeScript (no React), deterministic, unit-tested.
// Simulated scenery: it never represents real-world activity.
//
// Two robed duellists circle each other on the open landing pad. One presses, the other gives ground,
// then the tide turns. Their blades sweep mirrored figure-eights that meet between them: every meeting
// is a clash (spark + flash).
import * as THREE from 'three'
import { PADS } from '../world/layout'

export const DUEL_PAD = PADS[1]
export const DUEL = {
  /** the pair never strays further than this from the pad centre (pad radius is 18 m) */
  roam: 7,
  /** blade length, m */
  blade: 1.15,
  /** blade strokes per second (each stroke ends in a clash) */
  tempo: 1.35,
  /** height of the sword hands above the ground */
  handY: 1.22,
}

export interface Duellist {
  /** feet position (world) */
  pos: THREE.Vector3
  /** yaw of a +Z-facing figure */
  heading: number
  /** forward lean, radians (+ = into the attack) */
  lean: number
  /** vertical bob / small hops, m */
  lift: number
  /** sword hands (world) and unit blade direction (world) */
  hand: THREE.Vector3
  bladeDir: THREE.Vector3
  /** 0..1 how hard this one is pressing the attack right now */
  press: number
}

export interface DuelState {
  a: Duellist
  b: Duellist
  /** midpoint between the fighters at chest height: where blades meet, where cameras look */
  focus: THREE.Vector3
  /** 1 at the instant blades meet, decaying to 0 before the next stroke */
  clash: number
  /** which side of the centre line the blades met on (-1..1), for placing the spark */
  clashSide: number
}

const mk = (): Duellist => ({
  pos: new THREE.Vector3(), heading: 0, lean: 0, lift: 0, hand: new THREE.Vector3(), bladeDir: new THREE.Vector3(0, 1, 0), press: 0,
})

export function createDuelState(): DuelState {
  return { a: mk(), b: mk(), focus: new THREE.Vector3(), clash: 0, clashSide: 0 }
}

const _axis = new THREE.Vector3()
const _side = new THREE.Vector3()

function pose(d: Duellist, cx: number, cz: number, along: number, facing: 1 | -1, t: number, stroke: number, mirror: 1 | -1, press: number, groundY: number) {
  // feet
  d.pos.set(cx + _axis.x * along, groundY, cz + _axis.z * along)
  d.heading = Math.atan2(_axis.x * facing, _axis.z * facing)
  d.press = press
  d.lean = 0.1 + 0.22 * press
  // a quick hop on the heaviest blows, otherwise a fighter's bounce
  d.lift = Math.max(0, Math.sin(t * 0.37 + (facing > 0 ? 0 : 2.1)) - 0.93) * 6 + Math.abs(Math.sin(stroke * Math.PI)) * 0.05
  // blade: a figure-eight in front of the body. `sweep` swings side to side once per two strokes and
  // passes through the centre line exactly when the opponent's (mirrored) blade does.
  const sweep = Math.sin(stroke * Math.PI) * 1.15 * mirror
  const raise = 0.55 + 0.4 * Math.cos(stroke * Math.PI * 2) + 0.2 * press
  const fx = _axis.x * facing, fz = _axis.z * facing // forward
  const sx = _side.x * facing, sz = _side.z * facing // the fighter's left
  d.hand.set(
    d.pos.x + fx * 0.42 + sx * Math.sin(sweep) * 0.28,
    groundY + DUEL.handY + d.lift + 0.12 * Math.cos(stroke * Math.PI * 2),
    d.pos.z + fz * 0.42 + sz * Math.sin(sweep) * 0.28,
  )
  // direction: mostly up and forward, tilted sideways by the sweep
  const up = Math.cos(sweep) * Math.sin(raise + 0.5)
  const fwd = Math.cos(sweep) * Math.cos(raise + 0.5) + 0.35
  const lat = Math.sin(sweep)
  d.bladeDir.set(fx * fwd + sx * lat, up, fz * fwd + sz * lat).normalize()
}

/** Full state of the duel at simulation time t (seconds). */
export function duelAt(t: number, out: DuelState = createDuelState()): DuelState {
  const pad = DUEL_PAD
  // the fight wanders around the pad
  const cx = pad.x + Math.cos(t * 0.083) * DUEL.roam * 0.55 + Math.sin(t * 0.031) * DUEL.roam * 0.3
  const cz = pad.z + Math.sin(t * 0.067 + 1.3) * DUEL.roam * 0.55 + Math.cos(t * 0.043) * DUEL.roam * 0.3
  // they circle each other, sometimes reversing
  const theta = t * 0.21 + Math.sin(t * 0.13) * 1.4
  _axis.set(Math.sin(theta), 0, Math.cos(theta))
  _side.set(_axis.z, 0, -_axis.x)
  // the tide of the fight: +1 = A drives B back, -1 = B drives A back
  const tide = Math.sin(t * 0.29) * 0.75 + Math.sin(t * 0.71 + 0.6) * 0.25
  const gap = 2.05 + 0.25 * Math.sin(t * 1.9)
  const shove = tide * 1.5
  const stroke = t * DUEL.tempo
  pose(out.a, cx, cz, shove - gap / 2, 1, t, stroke, 1, Math.max(0, tide), pad.y)
  pose(out.b, cx, cz, shove + gap / 2, -1, t, stroke, 1, Math.max(0, -tide), pad.y)
  out.focus.set(cx + _axis.x * shove, pad.y + 1.45, cz + _axis.z * shove)
  // blades cross the centre line at every whole stroke
  const since = stroke - Math.floor(stroke)
  out.clash = Math.exp(-since * 9)
  out.clashSide = Math.sin(Math.floor(stroke) * 2.4)
  return out
}

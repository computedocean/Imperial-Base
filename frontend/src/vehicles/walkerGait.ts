// Heavy assault walker — gait and patrol route. Pure TypeScript (no React), deterministic, unit-tested.
// Simulated scenery: it never represents real-world activity.
//
// The walker circles the installation outside the perimeter wall. Feet are planted at fixed
// world positions for the whole stance phase (no skating), then swing to the next plant.
import * as THREE from 'three'
import { PERIMETER_RADIUS, PLATEAU_RADIUS, terrainHeight } from '../world/layout'

export const WALKER = {
  /** patrol circle radius: between the wall and the edge of the flat plateau */
  routeRadius: 525,
  /** ground speed, m/s */
  speed: 4.2,
  /** seconds for one full gait cycle (all four legs step once) */
  cycle: 3.4,
  /** fraction of the cycle a foot spends on the ground; 0.75 keeps three feet down at all times */
  duty: 0.75,
  /** foot lift at mid-swing, m */
  stepHeight: 2.6,
  /** hip joint height above the ground when standing, m */
  hipHeight: 13.6,
  /** hip positions in the body frame: half-width (x) and distance fore/aft of the centre (z) */
  hipX: 3.9,
  hipZ: 5.4,
  /** how far outboard of the hip the foot is planted */
  splay: 0.7,
  thigh: 8.2,
  shin: 7.6,
  /** ankle joint height above the sole */
  ankle: 1.5,
  /** starting bearing on the circle (radians): south-east, in view of the default camera */
  startAngle: 0.9,
}

export interface LegSpec { id: string; side: 1 | -1; fore: 1 | -1; phase: number }
/** Lateral-sequence walk: left hind, left fore, right hind, right fore. (+X is the left side of a +Z-facing body.) */
export const LEGS: LegSpec[] = [
  { id: 'LH', side: 1, fore: -1, phase: 0 },
  { id: 'LF', side: 1, fore: 1, phase: 0.25 },
  { id: 'RH', side: -1, fore: -1, phase: 0.5 },
  { id: 'RF', side: -1, fore: 1, phase: 0.75 },
]

export interface BodyPose { x: number; z: number; heading: number }

/** Body centre on the patrol circle at time t (seconds). Heading is the yaw of a +Z-facing model. */
export function bodyAt(t: number, out: BodyPose = { x: 0, z: 0, heading: 0 }): BodyPose {
  const a = WALKER.startAngle + (WALKER.speed / WALKER.routeRadius) * t
  out.x = Math.cos(a) * WALKER.routeRadius
  out.z = Math.sin(a) * WALKER.routeRadius
  // travelling with increasing angle: tangent = (-sin a, cos a)
  out.heading = Math.atan2(-Math.sin(a), Math.cos(a))
  return out
}

const _b: BodyPose = { x: 0, z: 0, heading: 0 }

/** World position of a point given in the body frame (x left, z forward) at time t. */
function bodyPoint(t: number, lx: number, lz: number, out: THREE.Vector3) {
  const b = bodyAt(t, _b)
  const s = Math.sin(b.heading), c = Math.cos(b.heading)
  out.set(b.x + lx * c + lz * s, 0, b.z - lx * s + lz * c)
  return out
}

/** Where a leg plants its foot on step n: under the hip as it will be at the middle of that stance. */
export function plantOf(leg: LegSpec, n: number, out = new THREE.Vector3()) {
  const tMid = (n - leg.phase + WALKER.duty / 2) * WALKER.cycle
  bodyPoint(tMid, leg.side * (WALKER.hipX + WALKER.splay), leg.fore * WALKER.hipZ, out)
  out.y = terrainHeight(out.x, out.z)
  return out
}

export interface FootState { pos: THREE.Vector3; planted: boolean; lift: number }

const _p0 = new THREE.Vector3()
const _p1 = new THREE.Vector3()
const smooth = (k: number) => k * k * (3 - 2 * k)

/** Sole position of a leg at time t. Planted feet are exactly stationary in the world. */
export function footAt(leg: LegSpec, t: number, out: FootState = { pos: new THREE.Vector3(), planted: true, lift: 0 }): FootState {
  const c = t / WALKER.cycle + leg.phase
  const n = Math.floor(c)
  const f = c - n
  if (f < WALKER.duty) {
    plantOf(leg, n, out.pos)
    out.planted = true
    out.lift = 0
    return out
  }
  const k = (f - WALKER.duty) / (1 - WALKER.duty)
  plantOf(leg, n, _p0)
  plantOf(leg, n + 1, _p1)
  out.pos.lerpVectors(_p0, _p1, smooth(k))
  out.lift = Math.sin(Math.PI * k) * WALKER.stepHeight
  out.pos.y += out.lift
  out.planted = false
  return out
}

/** World position of a hip joint at time t (before body bob). */
export function hipAt(leg: LegSpec, t: number, out = new THREE.Vector3()) {
  bodyPoint(t, leg.side * WALKER.hipX, leg.fore * WALKER.hipZ, out)
  out.y = WALKER.hipHeight
  return out
}

const _d = new THREE.Vector3()
const _n = new THREE.Vector3()

/**
 * Two-bone IK: knee position for a hip and an ankle, bending towards `forward`.
 * Returns false (and a straight leg) when the ankle is out of reach.
 */
export function solveKnee(hip: THREE.Vector3, ankle: THREE.Vector3, forward: THREE.Vector3, out: THREE.Vector3) {
  const L1 = WALKER.thigh, L2 = WALKER.shin
  _d.subVectors(ankle, hip)
  const raw = _d.length()
  const dist = Math.min(raw, L1 + L2 - 1e-3)
  _d.divideScalar(raw || 1)
  const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist)
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a))
  // bend direction: the part of `forward` that is perpendicular to the hip->ankle line
  _n.copy(forward).addScaledVector(_d, -forward.dot(_d))
  if (_n.lengthSq() < 1e-8) _n.set(0, 0, 1)
  _n.normalize()
  out.copy(hip).addScaledVector(_d, a).addScaledVector(_n, h)
  return raw <= L1 + L2
}

/** Vertical bob and roll of the hull from the gait (two bobs per cycle, a gentle weight shift). */
export function bodyMotion(t: number) {
  const c = (t / WALKER.cycle) * Math.PI * 2
  return { bob: Math.sin(c * 2) * 0.16, roll: Math.sin(c) * 0.022, pitch: Math.sin(c * 2 + 0.8) * 0.008 }
}

/** The route must stay on the flat ground between the wall and the plateau edge. */
export const ROUTE_CLEARANCE = { wall: WALKER.routeRadius - PERIMETER_RADIUS, plateau: PLATEAU_RADIUS - WALKER.routeRadius }

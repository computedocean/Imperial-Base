/**
 * The freighter's crew making a run for it: a smuggler in a dark vest and his tall, shaggy co-pilot
 * sprint across Pad 3 and up the boarding ramp just before the ship lifts off. Original figures
 * built from primitives; where they are comes from runnersAt() in aircraft/freighter.ts.
 * Simulated scenery — not AI agents, not real telemetry.
 */
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { runnersAt } from '../aircraft/freighter'
import { sim } from '../sim/world'

interface Look { height: number; shirt: string; vest: string | null; legs: string; boots: string; skin: string; hair: string; furry: boolean }
const SMUGGLER: Look = { height: 1.0, shirt: '#e6dfcf', vest: '#17171a', legs: '#27304a', boots: '#15110e', skin: '#d6a57f', hair: '#5a3b22', furry: false }
const COPILOT: Look = { height: 1.24, shirt: '#6b4526', vest: null, legs: '#5d3b20', boots: '#4a2e18', skin: '#7a5230', hair: '#5d3b20', furry: true }

const Y = new THREE.Vector3(0, 1, 0)
const _v = new THREE.Vector3()
function between(o: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  _v.subVectors(b, a)
  const len = _v.length()
  o.position.copy(a).addScaledVector(_v, 0.5)
  o.quaternion.setFromUnitVectors(Y, _v.divideScalar(len || 1))
  o.scale.set(1, len, 1)
}

interface Refs { root: THREE.Group | null; body: THREE.Group | null; limbs: (THREE.Mesh | null)[]; boots: (THREE.Mesh | null)[] }
const mkRefs = (): Refs => ({ root: null, body: null, limbs: [null, null, null, null], boots: [null, null] })

function Figure({ look, refs }: { look: Look; refs: Refs }) {
  const m = useMemo(() => ({
    shirt: new THREE.MeshStandardMaterial({ color: look.shirt, roughness: look.furry ? 1 : 0.85 }),
    vest: new THREE.MeshStandardMaterial({ color: look.vest ?? look.shirt, roughness: 0.8 }),
    legs: new THREE.MeshStandardMaterial({ color: look.legs, roughness: look.furry ? 1 : 0.85 }),
    boots: new THREE.MeshStandardMaterial({ color: look.boots, roughness: 0.6 }),
    skin: new THREE.MeshStandardMaterial({ color: look.skin, roughness: look.furry ? 1 : 0.7 }),
    hair: new THREE.MeshStandardMaterial({ color: look.hair, roughness: 1 }),
    dark: new THREE.MeshStandardMaterial({ color: '#141010', roughness: 0.7 }),
    white: new THREE.MeshStandardMaterial({ color: '#f1ede4', roughness: 0.4 }),
    strap: new THREE.MeshStandardMaterial({ color: '#2a2018', roughness: 0.6, metalness: 0.3 }),
  }), [look])
  const s = look.height
  return (
    <group ref={(o) => { refs.root = o }} visible={false}>
      {/* torso, hips and head lean with the body; limbs are posed separately every frame */}
      <group ref={(o) => { refs.body = o }} scale={s}>
        <mesh position={[0, 1.2, 0]} material={m.shirt} castShadow><cylinderGeometry args={[0.2, 0.17, 0.52, 10]} /></mesh>
        <mesh position={[0, 0.94, 0]} material={m.legs} castShadow><cylinderGeometry args={[0.17, 0.16, 0.2, 10]} /></mesh>
        {look.vest && <mesh position={[0, 1.22, -0.01]} scale={[1, 1, 0.9]} material={m.vest} castShadow><cylinderGeometry args={[0.215, 0.19, 0.46, 10, 1, true, Math.PI * 0.2, Math.PI * 1.6]} /></mesh>}
        {look.furry && <mesh position={[0, 1.2, 0]} rotation={[0, 0, 0.75]} scale={[1, 1, 1.02]} material={m.strap}><cylinderGeometry args={[0.215, 0.215, 0.09, 10]} /></mesh>}
        <mesh position={[0, 1.45, 0]} scale={[1.25, 0.5, 0.8]} material={m.shirt} castShadow><sphereGeometry args={[0.2, 10, 8]} /></mesh>
        <mesh position={[0, 1.66, 0.005]} scale={[0.92, 1.08, 1]} material={m.skin} castShadow><sphereGeometry args={[0.115, 14, 10]} /></mesh>
        {look.furry
          ? <mesh position={[0, 1.66, -0.02]} scale={[1.18, 1.3, 1.12]} material={m.hair} castShadow><sphereGeometry args={[0.118, 12, 10, Math.PI / 2 + 0.7, Math.PI * 2 - 1.4, 0, Math.PI]} /></mesh>
          : <mesh position={[0, 1.705, -0.02]} scale={[1, 0.9, 1.05]} material={m.hair}><sphereGeometry args={[0.118, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55]} /></mesh>}
        {[1, -1].map((sx) => (
          <group key={sx} position={[sx * 0.04, 1.685, 0.098]}>
            <mesh scale={[1.25, 0.8, 0.5]} material={m.white}><sphereGeometry args={[0.016, 8, 6]} /></mesh>
            <mesh position={[0, 0, 0.007]} scale={[1, 1, 0.5]} material={m.dark}><sphereGeometry args={[0.008, 6, 5]} /></mesh>
          </group>
        ))}
        <mesh position={[0, 1.655, 0.116]} rotation={[-0.25, 0, 0]} material={look.furry ? m.dark : m.skin}><boxGeometry args={[0.024, 0.04, 0.028]} /></mesh>
      </group>
      {/* arms then legs: unit-length cylinders stretched between joints */}
      {[0, 1].map((i) => <mesh key={`a${i}`} ref={(o) => { refs.limbs[i] = o }} material={m.shirt} castShadow><cylinderGeometry args={[0.055 * s, 0.07 * s, 1, 7]} /></mesh>)}
      {[0, 1].map((i) => <mesh key={`l${i}`} ref={(o) => { refs.limbs[2 + i] = o }} material={m.legs} castShadow><cylinderGeometry args={[0.06 * s, 0.085 * s, 1, 7]} /></mesh>)}
      {[0, 1].map((i) => <mesh key={`b${i}`} ref={(o) => { refs.boots[i] = o }} material={m.boots} castShadow><boxGeometry args={[0.11 * s, 0.1 * s, 0.3 * s]} /></mesh>)}
    </group>
  )
}

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()

/** Pose a runner. Limb joints are computed in the root's own frame (x = left, z = forward). */
function pose(r: Refs, look: Look, x: number, y: number, z: number, heading: number, speed: number, phase: number) {
  if (!r.root) return
  r.root.position.set(x, y, z)
  r.root.rotation.y = heading
  const s = look.height
  const run = Math.min(1, speed / 5)
  const bounce = Math.abs(Math.sin(phase)) * 0.07 * run
  if (r.body) {
    r.body.position.y = bounce
    r.body.rotation.x = 0.22 * run // leaning into the sprint
  }
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? 1 : -1
    const swing = Math.sin(phase + (i === 0 ? 0 : Math.PI))
    // arm: shoulder to fist, pumping opposite to the leg on the same side
    _a.set(side * 0.24 * s, (1.4 + bounce) * s, 0.06 * s)
    _b.set(side * 0.27 * s, (1.05 + bounce + Math.max(0, -swing) * 0.16) * s, (0.06 - swing * 0.36 * run) * s)
    if (r.limbs[i]) between(r.limbs[i]!, _b, _a)
    // leg: hip to ankle, long strides, the trailing foot kicking up behind
    const lift = Math.max(0, Math.cos(phase + (i === 0 ? 0 : Math.PI))) * 0.3 * run
    _a.set(side * 0.1 * s, (0.92 + bounce) * s, 0)
    _b.set(side * 0.1 * s, (0.07 + lift) * s, swing * 0.52 * run * s)
    if (r.limbs[2 + i]) between(r.limbs[2 + i]!, _b, _a)
    const boot = r.boots[i]
    if (boot) {
      boot.position.set(_b.x, _b.y - 0.02 * s, _b.z + 0.06 * s)
      boot.rotation.x = lift * 1.6
    }
  }
}

const _runners = [
  { x: 0, y: 0, z: 0, heading: 0, speed: 0, visible: false },
  { x: 0, y: 0, z: 0, heading: 0, speed: 0, visible: false },
]

export function Runners({ visible = true }: { visible?: boolean }) {
  const A = useMemo(mkRefs, [])
  const B = useMemo(mkRefs, [])
  useFrame(() => {
    const f = sim.freighter
    const on = f.phase === 'boarding'
    const t = sim.time - f.t0
    if (on) runnersAt(t, f.parkedYaw, _runners)
    ;[[A, SMUGGLER], [B, COPILOT]].forEach(([r, look], i) => {
      const refs = r as Refs
      const p = _runners[i]
      if (!refs.root) return
      refs.root.visible = on && p.visible
      // stride rate: a little slower for the taller one
      if (refs.root.visible) pose(refs, look as Look, p.x, p.y, p.z, p.heading, p.speed, t * (i === 0 ? 13 : 11.5) + i)
    })
  })
  return (
    <group name="runners" visible={visible}>
      <Figure look={SMUGGLER} refs={A} />
      <Figure look={COPILOT} refs={B} />
    </group>
  )
}

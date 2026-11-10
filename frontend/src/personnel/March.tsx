/**
 * The march on the Temple: a hooded dark knight leading a column of white-armoured clone troopers in
 * step along the approach and in through the great door. Original figures built from
 * primitives; where everyone is comes from marchPlan.ts.
 * Simulated scenery — not AI agents, not real telemetry.
 */
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { sim } from '../sim/world'
import { MARCH_FRAME, TROOPERS, createMarchState, marchAt, type Marcher } from './marchPlan'

const state = createMarchState()
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _d = new THREE.Vector3()
const Y = new THREE.Vector3(0, 1, 0)
const FACING = new THREE.Quaternion().setFromAxisAngle(Y, Math.PI) // everyone marches towards -Z
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0)

/** Matrix for a unit-height (+Y, centred) part stretched from a to b. */
function span(a: THREE.Vector3, b: THREE.Vector3, out: THREE.Matrix4) {
  _d.subVectors(b, a)
  const len = _d.length()
  _q.setFromUnitVectors(Y, _d.divideScalar(len || 1))
  _p.copy(a).addScaledVector(_d, len / 2)
  return out.compose(_p, _q, _s.set(1, len, 1))
}

/** Swing of a marching limb: stiff, precise, drill-ground stride. */
function limbs(m: Marcher, side: 1 | -1) {
  const swing = Math.sin(m.phase + (side === 1 ? 0 : Math.PI))
  const bob = Math.abs(Math.sin(m.phase)) * 0.03
  return { swing, bob, lift: Math.max(0, Math.cos(m.phase + (side === 1 ? 0 : Math.PI))) * 0.1 }
}

const PARTS = ['torso', 'belt', 'head', 'visor', 'armL', 'armR', 'legL', 'legR', 'rifle'] as const
type Part = (typeof PARTS)[number]

function Troopers() {
  const refs = useRef<Partial<Record<Part, THREE.InstancedMesh | null>>>({})
  const geo = useMemo(() => ({
    torso: new THREE.CylinderGeometry(0.21, 0.17, 0.56, 8),
    belt: new THREE.CylinderGeometry(0.185, 0.185, 0.16, 8),
    head: new THREE.SphereGeometry(0.15, 10, 8),
    visor: new THREE.BoxGeometry(0.2, 0.045, 0.06),
    limb: new THREE.CylinderGeometry(0.065, 0.075, 1, 6),
    rifle: new THREE.BoxGeometry(0.05, 0.09, 0.78),
  }), [])
  const mat = useMemo(() => ({
    armour: new THREE.MeshStandardMaterial({ color: '#e8e6df', roughness: 0.45, metalness: 0.1 }),
    dark: new THREE.MeshStandardMaterial({ color: '#16171a', roughness: 0.7, metalness: 0.3 }),
    blue: new THREE.MeshStandardMaterial({ color: '#2f5fb0', roughness: 0.6, metalness: 0.1 }),
  }), [])

  useFrame(() => {
    const r = refs.current
    const t = sim.march.elapsed(sim.time)
    const on = t >= 0
    for (const k of PARTS) { const im = r[k]; if (im) im.visible = on }
    if (!on) return
    marchAt(t, state)
    for (let i = 0; i < TROOPERS; i++) {
      const m = state.troopers[i]
      if (!m.visible) { for (const k of PARTS) r[k]?.setMatrixAt(i, HIDE); continue }
      const L = limbs(m, 1), R = limbs(m, -1)
      const y = m.y + L.bob
      r.torso?.setMatrixAt(i, _m.compose(_p.set(m.x, y + 1.2, m.z), FACING, _s.set(1, 1, 0.8)))
      r.belt?.setMatrixAt(i, _m.compose(_p.set(m.x, y + 0.92, m.z), FACING, _s.set(1, 1, 0.8)))
      r.head?.setMatrixAt(i, _m.compose(_p.set(m.x, y + 1.66, m.z), FACING, _s.set(1, 1.08, 1.05)))
      r.visor?.setMatrixAt(i, _m.compose(_p.set(m.x, y + 1.68, m.z - 0.135), FACING, _s.set(1, 1, 1)))
      // legs swing from the hip (forward is -Z); arms: the left swings, the right holds the rifle across the chest
      for (const [key, side, w] of [['legL', 1, L], ['legR', -1, R]] as const) {
        _a.set(m.x - side * 0.1, y + 0.9, m.z)
        _b.set(m.x - side * 0.1, m.y + 0.06 + w.lift, m.z - w.swing * 0.34)
        r[key]?.setMatrixAt(i, span(_b, _a, _m))
      }
      _a.set(m.x - 0.26, y + 1.42, m.z)
      _b.set(m.x - 0.28, y + 0.9, m.z + L.swing * 0.22)
      r.armL?.setMatrixAt(i, span(_b, _a, _m))
      _a.set(m.x + 0.26, y + 1.42, m.z)
      _b.set(m.x + 0.1, y + 1.08, m.z - 0.26)
      r.armR?.setMatrixAt(i, span(_b, _a, _m))
      _q.setFromAxisAngle(Y, Math.PI).multiply(_tilt)
      r.rifle?.setMatrixAt(i, _m.compose(_p.set(m.x + 0.02, y + 1.12, m.z - 0.3), _q, _s.set(1, 1, 1)))
    }
    for (const k of PARTS) { const im = r[k]; if (im) im.instanceMatrix.needsUpdate = true }
  })

  const inst = (k: Part, g: THREE.BufferGeometry, m: THREE.Material) => (
    <instancedMesh key={k} ref={(o) => { refs.current[k] = o }} args={[g, m, TROOPERS]} castShadow frustumCulled={false} visible={false} />
  )
  return (
    <>
      {inst('torso', geo.torso, mat.armour)}
      {inst('belt', geo.belt, mat.blue)}
      {inst('head', geo.head, mat.armour)}
      {inst('visor', geo.visor, mat.dark)}
      {inst('armL', geo.limb, mat.armour)}
      {inst('armR', geo.limb, mat.armour)}
      {inst('legL', geo.limb, mat.armour)}
      {inst('legR', geo.limb, mat.armour)}
      {inst('rifle', geo.rifle, mat.dark)}
    </>
  )
}
/** rifle held across the chest, muzzle up to the left */
const _tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, 0.9, 0))

function Leader() {
  const root = useRef<THREE.Group>(null)
  const legs = useRef<(THREE.Mesh | null)[]>([])
  const cloak = useRef<THREE.Mesh>(null)
  const blade = useRef<THREE.Group>(null)
  const m = useMemo(() => ({
    robe: new THREE.MeshStandardMaterial({ color: '#141110', roughness: 0.95, side: THREE.DoubleSide }),
    skin: new THREE.MeshStandardMaterial({ color: '#c99a76', roughness: 0.7 }),
    boots: new THREE.MeshStandardMaterial({ color: '#0a0908', roughness: 0.6 }),
    hilt: new THREE.MeshStandardMaterial({ color: '#8d9299', roughness: 0.35, metalness: 0.9 }),
    core: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
    halo: new THREE.MeshBasicMaterial({ color: '#3d8bff', toneMapped: false, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
  }), [])

  useFrame(() => {
    const o = root.current
    if (!o) return
    const t = sim.march.elapsed(sim.time)
    const l = state.leader
    o.visible = t >= 0 && l.visible
    if (!o.visible) return
    const bob = Math.abs(Math.sin(l.phase)) * 0.03
    o.position.set(l.x, l.y + bob, l.z)
    for (let i = 0; i < 2; i++) {
      const leg = legs.current[i]
      if (!leg) continue
      const swing = Math.sin(l.phase + i * Math.PI)
      const lift = Math.max(0, Math.cos(l.phase + i * Math.PI)) * 0.1
      // local frame: the group faces -Z, so "forward" for the legs is local +Z after the half turn
      _a.set((i ? -1 : 1) * 0.1, 0.9, 0)
      _b.set((i ? -1 : 1) * 0.1, 0.06 + lift - bob, swing * 0.36)
      span(_b, _a, _m).decompose(leg.position, leg.quaternion, leg.scale)
    }
    if (cloak.current) cloak.current.rotation.x = -0.1 - Math.abs(Math.sin(l.phase)) * 0.05 // trailing behind him
    const b = blade.current
    if (b) {
      b.visible = state.blade > 0.02
      b.scale.set(1, Math.max(0.02, state.blade), 1)
    }
  })

  return (
    <group ref={root} rotation={[0, Math.PI, 0]} visible={false}>
      {[0, 1].map((i) => <mesh key={i} ref={(o) => { legs.current[i] = o }} material={m.boots} castShadow><cylinderGeometry args={[0.06, 0.08, 1, 7]} /></mesh>)}
      {/* knee-length robe, long cloak hanging behind, deep hood shadowing the face */}
      <mesh position={[0, 0.82, 0]} material={m.robe} castShadow><cylinderGeometry args={[0.2, 0.3, 0.6, 12, 1, true]} /></mesh>
      <mesh position={[0, 1.24, 0]} material={m.robe} castShadow><cylinderGeometry args={[0.21, 0.2, 0.5, 12]} /></mesh>
      <mesh position={[0, 1.46, 0]} scale={[1.3, 0.5, 0.85]} material={m.robe} castShadow><sphereGeometry args={[0.2, 12, 8]} /></mesh>
      <mesh ref={cloak} position={[0, 0.82, -0.2]} material={m.robe} castShadow><boxGeometry args={[0.6, 1.45, 0.05]} /></mesh>
      <mesh position={[0, 1.66, 0.01]} scale={[0.9, 1.05, 0.95]} material={m.skin}><sphereGeometry args={[0.11, 12, 10]} /></mesh>
      <mesh position={[0, 1.68, -0.03]} scale={[1.3, 1.35, 1.45]} material={m.robe} castShadow><sphereGeometry args={[0.13, 16, 12, Math.PI / 2 + 0.8, Math.PI * 2 - 1.6, 0, Math.PI * 0.8]} /></mesh>
      {/* arms at his sides; the right hand carries the saber, point down and forward */}
      <mesh position={[0.27, 1.14, 0.02]} rotation={[0.08, 0, 0.1]} material={m.robe} castShadow><cylinderGeometry args={[0.075, 0.06, 0.62, 8]} /></mesh>
      <mesh position={[-0.27, 1.14, 0.02]} rotation={[0.08, 0, -0.1]} material={m.robe} castShadow><cylinderGeometry args={[0.075, 0.06, 0.62, 8]} /></mesh>
      <group position={[-0.3, 0.84, 0.06]} rotation={[2.25, 0, -0.12]}>
        <mesh material={m.hilt}><cylinderGeometry args={[0.022, 0.022, 0.26, 8]} /></mesh>
        <group ref={blade} position={[0, 0.13, 0]} visible={false}>
          <mesh position={[0, 0.575, 0]} material={m.core}><cylinderGeometry args={[0.018, 0.02, 1.15, 8]} /></mesh>
          <mesh position={[0, 0.575, 0]} material={m.halo}><cylinderGeometry args={[0.055, 0.06, 1.15, 10]} /></mesh>
        </group>
      </group>
    </group>
  )
}

export function March({ visible = true }: { visible?: boolean }) {
  return (
    <group name="march" visible={visible} position={MARCH_FRAME.position} rotation={[0, MARCH_FRAME.yaw, 0]}>
      {/* troopers first: their frame callback computes the shared state the leader then reads */}
      <Troopers />
      <Leader />
    </group>
  )
}

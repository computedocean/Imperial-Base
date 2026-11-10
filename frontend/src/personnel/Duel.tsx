/**
 * Lightsaber duel on Secondary Pad 2: a tan-robed master with a blue blade against a dark-robed
 * knight with a red one. Original figures built from primitives; the choreography lives in duelMoves.ts.
 * Simulated scenery — not AI agents, not real telemetry.
 */
import { Billboard, Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { sim } from '../sim/world'
import { useStore } from '../state/store'
import { DUEL, DUEL_PAD, createDuelState, duelAt, type Duellist } from './duelMoves'

/** Latest duel state, shared with the camera (cinematic tour) and QA. */
export const duelLive = createDuelState()

interface Look { robe: string; tunic: string; skin: string; hair: string; blade: string; hood: boolean }
const MASTER: Look = { robe: '#b9a27c', tunic: '#e3d6b8', skin: '#d9a982', hair: '#a8733c', blade: '#3d8bff', hood: false }
const KNIGHT: Look = { robe: '#1d1814', tunic: '#3a2a20', skin: '#cf9d78', hair: '#5a3a22', blade: '#ff2a1a', hood: true }

const Y = new THREE.Vector3(0, 1, 0)
const _v = new THREE.Vector3()
const _m = new THREE.Vector3()
const _q = new THREE.Quaternion()

/** Stretch a unit-height (+Y, centred) mesh between two points. */
function between(o: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, thickness = 1) {
  _v.subVectors(b, a)
  const len = _v.length()
  o.position.copy(a).addScaledVector(_v, 0.5)
  o.quaternion.setFromUnitVectors(Y, _v.divideScalar(len || 1))
  o.scale.set(thickness, len, thickness)
}

function glowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 96
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(48, 48, 0, 48, 48, 48)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.3, 'rgba(255,255,255,0.5)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 96, 96)
  return new THREE.CanvasTexture(c)
}

interface FigureRefs {
  root: THREE.Group | null; body: THREE.Group | null
  armL: THREE.Mesh | null; armR: THREE.Mesh | null
  hilt: THREE.Mesh | null; core: THREE.Mesh | null; halo: THREE.Mesh | null
  pool: THREE.Mesh | null
}
const emptyRefs = (): FigureRefs => ({ root: null, body: null, armL: null, armR: null, hilt: null, core: null, halo: null, pool: null })

function Figure({ look, refs, glow }: { look: Look; refs: FigureRefs; glow: THREE.Texture }) {
  const m = useMemo(() => ({
    robe: new THREE.MeshStandardMaterial({ color: look.robe, roughness: 0.92, metalness: 0 }),
    tunic: new THREE.MeshStandardMaterial({ color: look.tunic, roughness: 0.9, metalness: 0 }),
    skin: new THREE.MeshStandardMaterial({ color: look.skin, roughness: 0.7, metalness: 0 }),
    hair: new THREE.MeshStandardMaterial({ color: look.hair, roughness: 0.85, metalness: 0 }),
    hilt: new THREE.MeshStandardMaterial({ color: '#8d9299', roughness: 0.35, metalness: 0.9 }),
    core: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
    halo: new THREE.MeshBasicMaterial({ color: look.blade, toneMapped: false, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
    pool: new THREE.MeshBasicMaterial({ map: glow, color: look.blade, toneMapped: false, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
  }), [look, glow])
  return (
    <>
      <group ref={(o) => { refs.root = o }}>
        <group ref={(o) => { refs.body = o }}>
          {/* robe skirt, tunic, sash, shoulders, head */}
          <mesh position={[0, 0.5, 0]} material={m.robe} castShadow><cylinderGeometry args={[0.2, 0.36, 1.0, 12]} /></mesh>
          <mesh position={[0, 1.2, 0]} material={m.tunic} castShadow><cylinderGeometry args={[0.2, 0.19, 0.5, 12]} /></mesh>
          <mesh position={[0, 0.98, 0]} material={m.hair}><cylinderGeometry args={[0.205, 0.205, 0.07, 12]} /></mesh>
          <mesh position={[0, 1.2, -0.06]} material={m.robe} castShadow><cylinderGeometry args={[0.25, 0.3, 0.56, 12, 1, false, Math.PI * 0.62, Math.PI * 0.76]} /></mesh>
          <mesh position={[0, 1.44, 0]} scale={[1.25, 0.5, 0.8]} material={m.robe} castShadow><sphereGeometry args={[0.2, 12, 8]} /></mesh>
          <mesh position={[0, 1.52, 0]} material={m.skin}><cylinderGeometry args={[0.055, 0.06, 0.1, 8]} /></mesh>
          <mesh position={[0, 1.66, 0.01]} material={m.skin} castShadow><sphereGeometry args={[0.115, 14, 10]} /></mesh>
          {look.hood
            ? <mesh position={[0, 1.68, -0.035]} scale={[1.12, 1.15, 1.1]} material={m.robe} castShadow><sphereGeometry args={[0.13, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.72]} /></mesh>
            : <>
              <mesh position={[0, 1.7, -0.02]} scale={[1.04, 0.9, 1.04]} material={m.hair}><sphereGeometry args={[0.118, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55]} /></mesh>
              <mesh position={[0, 1.6, 0.085]} scale={[1, 0.8, 0.6]} material={m.hair}><sphereGeometry args={[0.075, 10, 6]} /></mesh>
            </>}
        </group>
      </group>
      {/* arms and weapon are posed in world space every frame */}
      <mesh ref={(o) => { refs.armL = o }} material={m.robe} castShadow><cylinderGeometry args={[0.075, 0.055, 1, 8]} /></mesh>
      <mesh ref={(o) => { refs.armR = o }} material={m.robe} castShadow><cylinderGeometry args={[0.075, 0.055, 1, 8]} /></mesh>
      <mesh ref={(o) => { refs.hilt = o }} material={m.hilt}><cylinderGeometry args={[0.022, 0.022, 1, 8]} /></mesh>
      <mesh ref={(o) => { refs.core = o }} material={m.core}><cylinderGeometry args={[0.018, 0.02, 1, 8]} /></mesh>
      <mesh ref={(o) => { refs.halo = o }} material={m.halo}><cylinderGeometry args={[0.055, 0.06, 1, 10]} /></mesh>
      <mesh ref={(o) => { refs.pool = o }} material={m.pool} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[1, 1]} /></mesh>
    </>
  )
}

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _sh = new THREE.Vector3()

function poseFigure(r: FigureRefs, d: Duellist, flicker: number) {
  if (r.root) {
    r.root.position.set(d.pos.x, d.pos.y + d.lift, d.pos.z)
    r.root.rotation.set(0, d.heading, 0)
  }
  if (r.body) r.body.rotation.x = d.lean
  const fx = Math.sin(d.heading), fz = Math.cos(d.heading)
  // shoulders (leaning with the torso), both hands on the hilt
  const shoulderY = d.pos.y + d.lift + 1.4
  for (const [mesh, side] of [[r.armL, 1], [r.armR, -1]] as const) {
    if (!mesh) continue
    _sh.set(d.pos.x + fz * 0.21 * side + fx * d.lean * 0.5, shoulderY, d.pos.z - fx * 0.21 * side + fz * d.lean * 0.5)
    between(mesh, _sh, d.hand)
  }
  _a.copy(d.hand).addScaledVector(d.bladeDir, -0.13)
  _b.copy(d.hand).addScaledVector(d.bladeDir, 0.13)
  if (r.hilt) between(r.hilt, _a, _b)
  _a.copy(d.hand).addScaledVector(d.bladeDir, 0.13)
  _b.copy(d.hand).addScaledVector(d.bladeDir, 0.13 + DUEL.blade)
  if (r.core) between(r.core, _a, _b)
  if (r.halo) between(r.halo, _a, _b, 0.92 + flicker * 0.16)
  if (r.pool) {
    // coloured light spilling on the deck under the blade
    _m.copy(_a).add(_b).multiplyScalar(0.5)
    r.pool.position.set(_m.x, d.pos.y + 0.04, _m.z)
    r.pool.scale.setScalar(4.2 + flicker * 0.5)
  }
}

export function Duel({ visible = true }: { visible?: boolean }) {
  const glow = useMemo(glowTexture, [])
  const A = useMemo(emptyRefs, [])
  const B = useMemo(emptyRefs, [])
  const spark = useRef<THREE.Sprite>(null)
  const sparkMat = useMemo(() => new THREE.SpriteMaterial({ map: glow, color: '#fff6d8', toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), [glow])
  const showLabels = useStore((s) => s.showLabels)
  const interior = useStore((s) => s.interior)
  const startTour = useStore((s) => s.startTour)

  useFrame(() => {
    const t = sim.time
    const d = duelAt(t, duelLive)
    const flicker = Math.sin(t * 47) * 0.5 + Math.sin(t * 31.7) * 0.5
    poseFigure(A, d.a, flicker)
    poseFigure(B, d.b, -flicker)
    const s = spark.current
    if (s) {
      // where the blades meet: between the two sword hands, a little above them
      _q.identity()
      s.position.copy(d.a.hand).add(d.b.hand).multiplyScalar(0.5)
      s.position.y += 0.45 + d.clashSide * 0.25
      s.scale.setScalar(0.5 + d.clash * 2.6)
      sparkMat.opacity = d.clash
      s.visible = d.clash > 0.03
    }
  })

  return (
    <group name="duel" visible={visible}>
      <Figure look={MASTER} refs={A} glow={glow} />
      <Figure look={KNIGHT} refs={B} glow={glow} />
      <sprite ref={spark} material={sparkMat} />
      {showLabels && !interior && (
        <Billboard position={[DUEL_PAD.x, DUEL_PAD.y + 16, DUEL_PAD.z]}>
          <Text fontSize={6} color="#9fd0ff" anchorX="center" anchorY="bottom" outlineWidth={0.2} outlineColor="#000" letterSpacing={0.15}
            onClick={(e) => { e.stopPropagation(); startTour('duel') }}>
            DUEL · PAD 2
          </Text>
        </Billboard>
      )}
    </group>
  )
}

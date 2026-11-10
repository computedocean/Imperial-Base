/**
 * Lightsaber duel on Secondary Pad 2: a tan-robed master with a blue blade against a horned,
 * red-faced challenger with a red double-bladed staff, staged as a sparring match (face-off, exchanges, blade lock, spin, leap, disarm). Original figures built from primitives; the choreography lives in duelMoves.ts.
 * Simulated scenery — not AI agents, not real telemetry.
 */
import { Billboard, Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { sim } from '../sim/world'
import { useStore } from '../state/store'
import { DUEL, DUEL_PAD, createDuelState, duelAt, type Duellist } from './duelMoves'
import { Footwork, LEG, kneeOf } from './footwork'

/** Latest duel state, shared with the camera (cinematic tour) and QA. */
export const duelLive = createDuelState()

interface Look { horned: boolean; double: boolean; braid: boolean; robe: string; tunic: string; skin: string; hair: string; blade: string; hood: boolean; legs: string; boots: string; eyes: string; beard: boolean }
const MASTER: Look = { robe: '#b9a27c', tunic: '#e3d6b8', skin: '#d9a982', hair: '#a8733c', blade: '#3d8bff', hood: false, legs: '#8f7c5c', boots: '#4a3524', eyes: '#3f6fa8', beard: true, braid: false, horned: false, double: false }
const SITH: Look = { robe: '#0c0b0b', tunic: '#171212', skin: '#b01f18', hair: '#0a0909', blade: '#ff2a1a', hood: false, legs: '#0c0b0b', boots: '#060505', eyes: '#f0c020', beard: false, braid: false, horned: true, double: true }

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
  core2: THREE.Mesh | null; halo2: THREE.Mesh | null; double: boolean
  thigh: (THREE.Mesh | null)[]; shin: (THREE.Mesh | null)[]; boot: (THREE.Group | null)[]
  feet: Footwork
}
const emptyRefs = (double = false): FigureRefs => ({ core2: null, halo2: null, double, root: null, body: null, armL: null, armR: null, hilt: null, core: null, halo: null, pool: null, thigh: [null, null], shin: [null, null], boot: [null, null], feet: new Footwork() })

function Figure({ look, refs, glow }: { look: Look; refs: FigureRefs; glow: THREE.Texture }) {
  const m = useMemo(() => ({
    robe: new THREE.MeshStandardMaterial({ color: look.robe, roughness: 0.92, metalness: 0 }),
    tunic: new THREE.MeshStandardMaterial({ color: look.tunic, roughness: 0.9, metalness: 0 }),
    skin: new THREE.MeshStandardMaterial({ color: look.skin, roughness: 0.7, metalness: 0 }),
    hair: new THREE.MeshStandardMaterial({ color: look.hair, roughness: 0.85, metalness: 0 }),
    hilt: new THREE.MeshStandardMaterial({ color: '#8d9299', roughness: 0.35, metalness: 0.9 }),
    hood: new THREE.MeshStandardMaterial({ color: look.robe, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }),
    legs: new THREE.MeshStandardMaterial({ color: look.legs, roughness: 0.9, metalness: 0 }),
    boots: new THREE.MeshStandardMaterial({ color: look.boots, roughness: 0.6, metalness: 0.05 }),
    white: new THREE.MeshStandardMaterial({ color: '#f1ede4', roughness: 0.4, metalness: 0 }),
    iris: new THREE.MeshStandardMaterial({ color: look.eyes, roughness: 0.3, metalness: 0, emissive: look.eyes, emissiveIntensity: look.horned ? 1.1 : 0.15 }),
    dark: new THREE.MeshStandardMaterial({ color: '#1a1210', roughness: 0.8, metalness: 0 }),
    lip: new THREE.MeshStandardMaterial({ color: '#8f5a4a', roughness: 0.7, metalness: 0 }),
    core: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
    halo: new THREE.MeshBasicMaterial({ color: look.blade, toneMapped: false, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
    pool: new THREE.MeshBasicMaterial({ map: glow, color: look.blade, toneMapped: false, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
  }), [look, glow])
  return (
    <>
      <group ref={(o) => { refs.root = o }}>
        <group ref={(o) => { refs.body = o }}>
          {/* knee-length robe (legs show below), tunic, sash, shoulders, neck */}
          <mesh position={[0, 0.76, 0]} material={m.robe} castShadow><cylinderGeometry args={[0.2, 0.29, 0.5, 12, 1, true]} /></mesh>
          <mesh position={[0, 0.76, 0]} material={m.hood}><cylinderGeometry args={[0.195, 0.285, 0.5, 12, 1, true]} /></mesh>
          <mesh position={[0, 0.93, 0]} material={m.legs}><cylinderGeometry args={[0.17, 0.17, 0.16, 10]} /></mesh>
          <mesh position={[0, 1.2, 0]} material={m.tunic} castShadow><cylinderGeometry args={[0.2, 0.19, 0.5, 12]} /></mesh>
          <mesh position={[0, 0.99, 0]} material={m.boots}><cylinderGeometry args={[0.205, 0.205, 0.07, 12]} /></mesh>
          <mesh position={[0, 1.21, 0]} scale={[1, 1, 0.82]} material={m.robe} castShadow><cylinderGeometry args={[0.215, 0.205, 0.44, 12, 1, true, Math.PI * 0.3, Math.PI * 1.4]} /></mesh>
          <mesh position={[0, 1.44, 0]} scale={[1.25, 0.5, 0.8]} material={m.robe} castShadow><sphereGeometry args={[0.2, 12, 8]} /></mesh>
          <mesh position={[0, 1.52, 0]} material={m.skin}><cylinderGeometry args={[0.055, 0.06, 0.1, 8]} /></mesh>
          {/* head: slightly long skull, jaw, ears */}
          <mesh position={[0, 1.665, 0.005]} scale={[0.92, 1.08, 1]} material={m.skin} castShadow><sphereGeometry args={[0.115, 18, 14]} /></mesh>
          <mesh position={[0, 1.6, 0.03]} scale={[0.8, 0.7, 0.85]} material={m.skin}><sphereGeometry args={[0.1, 14, 10]} /></mesh>
          {[1, -1].map((sx) => <mesh key={sx} position={[sx * 0.105, 1.66, 0.0]} scale={[0.4, 1, 0.7]} material={m.skin}><sphereGeometry args={[0.03, 8, 6]} /></mesh>)}
          {/* face: eyes (white, iris, pupil), brows, nose, mouth */}
          {[1, -1].map((sx) => (
            <group key={sx} position={[sx * 0.04, 1.685, 0.098]}>
              <mesh scale={[1.25, 0.8, 0.5]} material={m.white}><sphereGeometry args={[0.016, 10, 8]} /></mesh>
              <mesh position={[0, 0, 0.006]} scale={[1, 1, 0.5]} material={m.iris}><sphereGeometry args={[0.0095, 8, 6]} /></mesh>
              <mesh position={[0, 0, 0.0095]} scale={[1, 1, 0.5]} material={m.dark}><sphereGeometry args={[0.0048, 6, 5]} /></mesh>
              <mesh position={[0, 0.021, 0.002]} rotation={[0, 0, sx * (look.horned ? 0.34 : 0.1)]} material={m.hair}><boxGeometry args={[0.04, 0.008, 0.012]} /></mesh>
            </group>
          ))}
          <mesh position={[0, 1.655, 0.118]} rotation={[-0.25, 0, 0]} material={m.skin}><boxGeometry args={[0.022, 0.045, 0.028]} /></mesh>
          <mesh position={[0, 1.615, 0.106]} material={m.lip}><boxGeometry args={[0.042, 0.007, 0.01]} /></mesh>
          {look.hood
            ? <>
              {/* hair under a hood that is open at the front, so the face shows */}
              <mesh position={[0, 1.705, -0.02]} scale={[0.98, 0.9, 1.02]} material={m.hair}><sphereGeometry args={[0.118, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5]} /></mesh>
              <mesh position={[0, 1.675, -0.02]} scale={[1.22, 1.3, 1.3]} material={m.hood} castShadow><sphereGeometry args={[0.13, 16, 12, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, 0, Math.PI * 0.8]} /></mesh>
              <mesh position={[0, 1.46, -0.1]} scale={[1.2, 0.7, 0.9]} material={m.robe}><sphereGeometry args={[0.13, 10, 8]} /></mesh>
            </>
            : look.horned ? <>
              {/* bald, a crown of short horns, black markings across the red face */}
              {[0, 1, 2, 3, 4, 5, 6].map((i) => {
                const a = (i / 7) * Math.PI * 2 + 0.2
                return <mesh key={i} position={[Math.sin(a) * 0.075, 1.775, Math.cos(a) * 0.075 - 0.01]} rotation={[Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.4]} material={m.white}><coneGeometry args={[0.014, 0.05, 6]} /></mesh>
              })}
              <mesh position={[0, 1.79, 0]} material={m.white}><coneGeometry args={[0.014, 0.05, 6]} /></mesh>
              <mesh position={[0, 1.735, 0.092]} material={m.dark}><boxGeometry args={[0.03, 0.06, 0.012]} /></mesh>
              {[1, -1].map((sx) => <group key={sx}>
                <mesh position={[sx * 0.05, 1.725, 0.085]} rotation={[0, 0, sx * 0.5]} material={m.dark}><boxGeometry args={[0.014, 0.07, 0.012]} /></mesh>
                <mesh position={[sx * 0.062, 1.64, 0.088]} rotation={[0, sx * 0.4, sx * -0.3]} material={m.dark}><boxGeometry args={[0.016, 0.07, 0.012]} /></mesh>
                <mesh position={[sx * 0.028, 1.6, 0.098]} material={m.dark}><boxGeometry args={[0.012, 0.035, 0.012]} /></mesh>
              </group>)}
            </> : <>
              <mesh position={[0, 1.705, -0.02]} scale={[0.98, 0.9, 1.04]} material={m.hair}><sphereGeometry args={[0.118, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55]} /></mesh>
              <mesh position={[0, 1.66, -0.07]} scale={[0.95, 1, 0.7]} material={m.hair}><sphereGeometry args={[0.1, 10, 8]} /></mesh>
            </>}
          {look.braid && <mesh position={[-0.1, 1.55, 0.03]} rotation={[0.1, 0, 0.12]} material={m.hair}><cylinderGeometry args={[0.009, 0.006, 0.26, 5]} /></mesh>}
          {look.beard && <>
            <mesh position={[0, 1.585, 0.07]} scale={[1, 0.75, 0.6]} material={m.hair}><sphereGeometry args={[0.07, 10, 8]} /></mesh>
            <mesh position={[0, 1.63, 0.107]} material={m.hair}><boxGeometry args={[0.05, 0.008, 0.012]} /></mesh>
          </>}
        </group>
      </group>
      {/* legs and boots are posed in world space every frame (planted feet stay put) */}
      {[0, 1].map((i) => (
        <group key={i}>
          <mesh ref={(o) => { refs.thigh[i] = o }} material={m.legs} castShadow><cylinderGeometry args={[0.06, 0.075, 1, 8]} /></mesh>
          <mesh ref={(o) => { refs.shin[i] = o }} material={m.boots} castShadow><cylinderGeometry args={[0.05, 0.058, 1, 8]} /></mesh>
          <group ref={(o) => { refs.boot[i] = o }}>
            <mesh position={[0, 0.045, 0.045]} material={m.boots} castShadow><boxGeometry args={[0.1, 0.09, 0.27]} /></mesh>
            <mesh position={[0, 0.03, 0.17]} scale={[1, 0.6, 1]} material={m.boots}><sphereGeometry args={[0.05, 8, 6]} /></mesh>
          </group>
        </group>
      ))}
      {/* arms and weapon are posed in world space every frame */}
      <mesh ref={(o) => { refs.armL = o }} material={m.robe} castShadow><cylinderGeometry args={[0.075, 0.055, 1, 8]} /></mesh>
      <mesh ref={(o) => { refs.armR = o }} material={m.robe} castShadow><cylinderGeometry args={[0.075, 0.055, 1, 8]} /></mesh>
      <mesh ref={(o) => { refs.hilt = o }} material={m.hilt}><cylinderGeometry args={[0.022, 0.022, 1, 8]} /></mesh>
      <mesh ref={(o) => { refs.core = o }} material={m.core}><cylinderGeometry args={[0.018, 0.02, 1, 8]} /></mesh>
      <mesh ref={(o) => { refs.halo = o }} material={m.halo}><cylinderGeometry args={[0.055, 0.06, 1, 10]} /></mesh>
      {look.double && <>
        <mesh ref={(o) => { refs.core2 = o }} material={m.core}><cylinderGeometry args={[0.02, 0.018, 1, 8]} /></mesh>
        <mesh ref={(o) => { refs.halo2 = o }} material={m.halo}><cylinderGeometry args={[0.06, 0.055, 1, 10]} /></mesh>
      </>}
      <mesh ref={(o) => { refs.pool = o }} material={m.pool} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[1, 1]} /></mesh>
    </>
  )
}

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _sh = new THREE.Vector3()

const _hip = new THREE.Vector3()
const _ank = new THREE.Vector3()
const _knee = new THREE.Vector3()
const _fwd = new THREE.Vector3()

function poseLegs(r: FigureRefs, d: Duellist, dt: number) {
  r.feet.update(d.pos, d.heading, dt, d.lift, d.stance)
  _fwd.set(Math.sin(d.heading), 0, Math.cos(d.heading))
  r.feet.feet.forEach((f, i) => {
    const side = i === 0 ? 1 : -1
    _hip.set(d.pos.x + _fwd.z * LEG.hipHalf * side, d.pos.y + d.lift + LEG.hip - d.crouch, d.pos.z - _fwd.x * LEG.hipHalf * side)
    _ank.copy(f.pos)
    _ank.y += LEG.ankle
    kneeOf(_hip, _ank, _fwd, _knee)
    const th = r.thigh[i], sh = r.shin[i], boot = r.boot[i]
    // the meshes taper towards their -Y end, so run them from the lower joint up
    if (th) between(th, _knee, _hip)
    if (sh) between(sh, _ank, _knee)
    if (boot) {
      boot.position.copy(f.pos)
      // toes point down a little while the foot is in the air
      boot.rotation.set(f.k < 1 ? 0.35 * Math.sin(Math.PI * f.k) : 0, f.yaw, 0, 'YXZ')
    }
  })
}

function poseFigure(r: FigureRefs, d: Duellist, flicker: number) {
  if (r.root) {
    r.root.position.set(d.pos.x, d.pos.y + d.lift - d.crouch, d.pos.z)
    r.root.rotation.set(0, d.heading, 0)
  }
  if (r.body) r.body.rotation.x = d.lean
  const fx = Math.sin(d.heading), fz = Math.cos(d.heading)
  // shoulders (leaning with the torso), both hands on the hilt
  const shoulderY = d.pos.y + d.lift - d.crouch + 1.4
  for (const [mesh, side] of [[r.armL, 1], [r.armR, -1]] as const) {
    if (!mesh) continue
    _sh.set(d.pos.x + fz * 0.21 * side + fx * d.lean * 0.5, shoulderY, d.pos.z - fx * 0.21 * side + fz * d.lean * 0.5)
    between(mesh, _sh, d.hand)
  }
  // the weapon: in the hands, or wherever it has been knocked to
  const hl = r.double ? 0.26 : 0.13 // a double-bladed staff has a long hilt
  _a.copy(d.saber).addScaledVector(d.bladeDir, -hl)
  _b.copy(d.saber).addScaledVector(d.bladeDir, hl)
  if (r.hilt) between(r.hilt, _a, _b)
  const lit = d.bladeLen > 0.02
  if (r.core2 && r.halo2) {
    // the second blade runs the other way; it is cut short where it would meet the deck
    let len = 0.95 * Math.max(d.bladeLen, 0.02)
    if (d.bladeDir.y > 0.05) len = Math.max(0.05, Math.min(len, (d.saber.y - d.pos.y - 0.06) / d.bladeDir.y - hl))
    _a.copy(d.saber).addScaledVector(d.bladeDir, -hl)
    _b.copy(d.saber).addScaledVector(d.bladeDir, -hl - len)
    r.core2.visible = lit; between(r.core2, _b, _a)
    r.halo2.visible = lit; between(r.halo2, _b, _a, 0.92 - flicker * 0.16)
  }
  _a.copy(d.saber).addScaledVector(d.bladeDir, hl)
  _b.copy(d.saber).addScaledVector(d.bladeDir, hl + DUEL.blade * Math.max(d.bladeLen, 0.02))
  if (r.core) { r.core.visible = lit; between(r.core, _a, _b) }
  if (r.halo) { r.halo.visible = lit; between(r.halo, _a, _b, 0.92 + flicker * 0.16) }
  if (r.pool) {
    // coloured light spilling on the deck under the blade
    r.pool.visible = lit
    _m.copy(_a).add(_b).multiplyScalar(0.5)
    r.pool.position.set(_m.x, d.pos.y + 0.04, _m.z)
    r.pool.scale.setScalar((4.2 + flicker * 0.5) * d.bladeLen)
  }
}

export function Duel({ visible = true }: { visible?: boolean }) {
  const glow = useMemo(glowTexture, [])
  const A = useMemo(() => emptyRefs(), [])
  const B = useMemo(() => emptyRefs(true), [])
  const spark = useRef<THREE.Sprite>(null)
  const sparkMat = useMemo(() => new THREE.SpriteMaterial({ map: glow, color: '#fff6d8', toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), [glow])
  const showLabels = useStore((s) => s.showLabels)
  const interior = useStore((s) => s.interior)
  const watchTour = useStore((s) => s.watchTour)

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1)
    const t = sim.time
    const d = duelAt(t, duelLive)
    poseLegs(A, d.a, dt)
    poseLegs(B, d.b, dt)
    const flicker = Math.sin(t * 47) * 0.5 + Math.sin(t * 31.7) * 0.5
    poseFigure(A, d.a, flicker)
    poseFigure(B, d.b, -flicker)
    const s = spark.current
    if (s) {
      // where the blades meet: between the two sword hands, a little above them
      _q.identity()
      _a.copy(d.a.saber).addScaledVector(d.a.bladeDir, 0.6)
      _b.copy(d.b.saber).addScaledVector(d.b.bladeDir, 0.6)
      s.position.copy(_a).add(_b).multiplyScalar(0.5)
      s.position.y += d.clashSide * 0.12
      s.scale.setScalar(0.5 + d.clash * 2.6)
      sparkMat.opacity = d.clash
      s.visible = d.clash > 0.03 && d.a.bladeLen > 0.5
    }
  })

  return (
    <group name="duel" visible={visible}>
      <Figure look={MASTER} refs={A} glow={glow} />
      <Figure look={SITH} refs={B} glow={glow} />
      <sprite ref={spark} material={sparkMat} />
      {showLabels && !interior && (
        <Billboard position={[DUEL_PAD.x, DUEL_PAD.y + 16, DUEL_PAD.z]}>
          <Text fontSize={6} color="#9fd0ff" anchorX="center" anchorY="bottom" outlineWidth={0.2} outlineColor="#000" letterSpacing={0.15}
            onClick={(e) => { e.stopPropagation(); watchTour('duel') }}>
            DUEL · PAD 2
          </Text>
        </Billboard>
      )}
    </group>
  )
}

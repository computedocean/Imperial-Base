/**
 * Heavy assault walker — original interpretation of the four-legged armoured transport:
 * slab-sided hull, articulated neck, armoured head with a red viewport slit and chin cannons,
 * and four two-jointed legs on wide foot pads. It patrols the ground outside the perimeter wall.
 *
 * The gait lives in walkerGait.ts (pure, unit-tested); this file only builds the model and poses it.
 * Simulated scenery — not an AI agent, not real telemetry.
 */
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { aircraftObjects } from '../aircraft/AircraftLayer'
import { Baked, shipBind, type Bind } from '../aircraft/models/Baked'
import { GeoBatch, bevelBox, chamferRect, cylX, cylZ, loft, mat, type MatKey } from '../aircraft/models/materials'
import { sim } from '../sim/world'
import { useStore } from '../state/store'
import { LEGS, WALKER, bodyAt, bodyMotion, footAt, hipAt, solveKnee } from './walkerGait'

type Parts = Partial<Record<MatKey, THREE.BufferGeometry>>
let cache: { body: Parts; head: Parts; thigh: Parts; shin: Parts; foot: Parts } | null = null

/** Hull origin = centre of the belly line; the hip axles sit HIP_DROP below it. */
const HIP_DROP = 0.2
const NECK_Z = 9.4

function buildWalker() {
  if (cache) return cache
  const sec = (z: number, w: number, yb: number, yt: number, c: number) => ({ z, pts: chamferRect(w, yb, yt, c) })

  // ------------------------------------------------------------ hull
  const b = new GeoBatch(5)
  b.add('hull', loft([
    sec(-10.2, 5.0, 1.2, 5.6, 0.9),
    sec(-8.0, 6.6, 0.3, 6.9, 1.1),
    sec(6.2, 6.6, 0.3, 6.9, 1.1),
    sec(9.2, 4.8, 1.0, 5.8, 0.9),
  ]))
  // side armour slabs with seams, and the big side hatches
  for (const sx of [1, -1]) {
    b.add('gun', bevelBox(0.3, 4.4, 12.6, 0.08), { p: [sx * 3.36, 3.8, -0.9] })
    for (let i = 0; i < 4; i++) b.add('hull', bevelBox(0.18, 3.9, 2.8, 0.05), { p: [sx * 3.5, 3.8, -5.6 + i * 3.15] })
    b.add('dark', bevelBox(0.14, 2.6, 2.0, 0.04), { p: [sx * 3.62, 3.3, -2.45] })
    // drive housings over each hip
    for (const sz of [1, -1]) {
      b.add('gun', bevelBox(1.5, 2.6, 4.4, 0.25), { p: [sx * 3.5, 0.6, sz * WALKER.hipZ] })
      b.add('dark', cylX(1.75, 1.75, 0.5, 18), { p: [sx * 4.35, -HIP_DROP, sz * WALKER.hipZ] })
      b.add('gun', cylX(1.2, 1.2, 0.7, 14), { p: [sx * 4.45, -HIP_DROP, sz * WALKER.hipZ] })
    }
  }
  // belly keel, dorsal spine and rear drive block
  b.add('gun', bevelBox(3.6, 1.0, 15.0, 0.2), { p: [0, 0.1, -0.8] })
  b.add('dark', bevelBox(2.2, 0.7, 6.0, 0.15), { p: [0, -0.4, -0.8] })
  b.add('gun', bevelBox(2.6, 0.5, 13.0, 0.12), { p: [0, 7.0, -1.0] })
  for (let i = 0; i < 5; i++) b.add('dark', bevelBox(1.8, 0.3, 0.8, 0.06), { p: [0, 7.3, -6.0 + i * 2.6] })
  b.add('gun', bevelBox(3.8, 3.0, 1.0, 0.2), { p: [0, 3.4, -10.4] })
  b.add('dark', bevelBox(2.4, 1.6, 0.4, 0.08), { p: [0, 3.4, -10.9] })
  // neck: ribbed flexible tunnel
  b.add('dark', cylZ(1.25, 1.45, NECK_Z + 4.4 - 9.0, 14), { p: [0, 3.3, (NECK_Z + 4.4 + 9.0) / 2] })
  for (let i = 0; i < 5; i++) b.add('gun', cylZ(1.55, 1.55, 0.35, 14), { p: [0, 3.3, 9.5 + i * 0.95] })
  b.add('navRed', new THREE.SphereGeometry(0.22, 8, 6), { p: [0, 7.6, -9.4] })
  const body = b.build()

  // ------------------------------------------------------------ head (origin = neck joint)
  const h = new GeoBatch(4)
  h.add('hull', loft([
    sec(-0.4, 3.9, -1.9, 1.9, 0.7),
    sec(2.6, 4.5, -2.1, 2.2, 0.8),
    sec(5.0, 4.1, -1.8, 1.7, 0.7),
    sec(6.6, 2.9, -1.1, 0.7, 0.5),
  ]))
  h.add('dark', bevelBox(3.0, 0.5, 0.5, 0.08), { p: [0, 0.75, 5.9], r: [-0.42, 0, 0] }) // viewport recess
  h.add('navRed', bevelBox(2.5, 0.22, 0.12, 0.03), { p: [0, 0.78, 6.12], r: [-0.42, 0, 0] }) // glowing slit
  for (const sx of [1, -1]) {
    h.add('gun', bevelBox(0.4, 2.4, 3.4, 0.1), { p: [sx * 2.3, 0.1, 2.6] }) // cheek armour
    h.add('gun', cylZ(0.42, 0.42, 1.6, 10), { p: [sx * 2.55, -0.2, 3.9] }) // temple blaster housing
    h.add('dark', cylZ(0.17, 0.17, 2.6, 8), { p: [sx * 2.55, -0.2, 5.6] })
    h.add('gun', cylZ(0.34, 0.34, 2.6, 10), { p: [sx * 0.95, -2.2, 4.4] }) // chin cannon
    h.add('dark', cylZ(0.2, 0.2, 3.4, 8), { p: [sx * 0.95, -2.2, 7.2] })
    h.add('gun', cylZ(0.28, 0.28, 0.5, 8), { p: [sx * 0.95, -2.2, 8.7] })
  }
  h.add('gun', bevelBox(2.8, 0.7, 2.6, 0.12), { p: [0, -2.05, 3.6] })
  h.add('gun', bevelBox(2.4, 0.4, 3.4, 0.1), { p: [0, 2.25, 2.4] })
  const head = h.build()

  // ------------------------------------------------------------ leg segments: built along +Y, centred, far end at +Y
  const t = new GeoBatch(4)
  t.add('hull', bevelBox(1.7, WALKER.thigh - 1.0, 2.2, 0.2))
  t.add('gun', bevelBox(1.9, WALKER.thigh * 0.45, 1.5, 0.12), { p: [0, -0.6, 0] })
  t.add('dark', bevelBox(0.5, WALKER.thigh - 2.4, 2.5, 0.08))
  t.add('gun', cylX(1.45, 1.45, 2.3, 16), { p: [0, WALKER.thigh / 2, 0] }) // knee
  t.add('dark', cylX(0.9, 0.9, 2.5, 12), { p: [0, WALKER.thigh / 2, 0] })
  const thigh = t.build()

  const s = new GeoBatch(4)
  s.add('hull', bevelBox(1.4, WALKER.shin - 1.2, 1.8, 0.16), { p: [0, -0.1, 0] })
  s.add('gun', bevelBox(1.6, WALKER.shin * 0.4, 1.2, 0.1), { p: [0, 1.0, 0] })
  s.add('dark', bevelBox(0.4, WALKER.shin - 2.6, 2.1, 0.06))
  s.add('gun', cylX(1.0, 1.0, 1.9, 14), { p: [0, WALKER.shin / 2, 0] }) // ankle
  const shin = s.build()

  // foot: origin at the sole
  const f = new GeoBatch(4)
  f.add('gun', new THREE.CylinderGeometry(2.3, 2.6, 0.9, 20), { p: [0, 0.45, 0] })
  f.add('hull', new THREE.CylinderGeometry(1.5, 2.25, 0.7, 20), { p: [0, 1.2, 0] })
  f.add('dark', new THREE.CylinderGeometry(2.62, 2.62, 0.25, 20), { p: [0, 0.14, 0] })
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4
    f.add('gun', bevelBox(0.8, 0.6, 1.4, 0.1), { p: [Math.sin(a) * 2.1, 0.75, Math.cos(a) * 2.1], r: [0, a, 0] })
  }
  const foot = f.build()

  cache = { body, head, thigh, shin, foot }
  return cache
}

type PartName = 'body' | 'head' | 'thigh' | 'shin' | 'foot'
const PART_NAMES: PartName[] = ['body', 'head', 'thigh', 'shin', 'foot']

/** One part: the Blender-built model (tools/blender/walker.py), with the code-built one as the fallback. */
function PartMeshes({ parts, name, bind }: { parts: Parts; name: PartName; bind: Bind }) {
  return (
    <Baked name={`walker_${name}`} bind={bind} fallback={
      <>{(Object.keys(parts) as MatKey[]).map((k) => <mesh key={k} geometry={parts[k]} material={mat(k)} castShadow receiveShadow />)}</>
    } />
  )
}

/** Live world position of the hull (camera follow + QA). */
export const walkerObject = { current: null as THREE.Object3D | null }

const _hip = new THREE.Vector3()
const _ankle = new THREE.Vector3()
const _knee = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _body = { x: 0, z: 0, heading: 0 }
const _foot = { pos: new THREE.Vector3(), planted: true, lift: 0 }

/** Place a +Y-built segment so it runs from `from` to `to`, keeping its X axis across the walker. */
function span(o: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, across: THREE.Vector3) {
  o.position.copy(from).add(to).multiplyScalar(0.5)
  _dir.subVectors(to, from).normalize()
  const z = new THREE.Vector3().crossVectors(across, _dir).normalize()
  const x = new THREE.Vector3().crossVectors(_dir, z)
  o.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, _dir, z))
}

export function Walker({ visible = true }: { visible?: boolean }) {
  const geo = useMemo(buildWalker, [])
  const hull = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  const thighs = useRef<(THREE.Group | null)[]>([])
  const shins = useRef<(THREE.Group | null)[]>([])
  const feet = useRef<(THREE.Group | null)[]>([])
  const select = useStore((s) => s.select)
  const across = useMemo(() => new THREE.Vector3(), [])
  // each part has its own baked shadow map, so each gets its own material copies
  const binds = useMemo(() => Object.fromEntries(PART_NAMES.map((n) => [n, shipBind(['hull', 'gun', 'dark', 'navRed'])])) as Record<PartName, Bind>, [])

  useFrame(() => {
    const t = sim.time
    const b = bodyAt(t, _body)
    const m = bodyMotion(t)
    _fwd.set(Math.sin(b.heading), 0, Math.cos(b.heading))
    across.set(Math.cos(b.heading), 0, -Math.sin(b.heading))
    if (hull.current) {
      hull.current.position.set(b.x, WALKER.hipHeight + HIP_DROP + m.bob, b.z)
      hull.current.rotation.set(m.pitch, b.heading, m.roll, 'YXZ')
    }
    if (head.current) {
      // the head sweeps slowly from side to side, scanning the desert
      head.current.rotation.set(Math.sin(t * 0.21) * 0.05 - 0.04, Math.sin(t * 0.13) * 0.32, 0, 'YXZ')
    }
    LEGS.forEach((leg, i) => {
      hipAt(leg, t, _hip)
      _hip.y += m.bob
      const f = footAt(leg, t, _foot)
      const ft = feet.current[i]
      if (ft) {
        ft.position.copy(f.pos)
        // toe dips a little while the foot is in the air
        ft.rotation.set(f.planted ? 0 : -Math.sin((f.lift / WALKER.stepHeight) * Math.PI) * 0.12, b.heading, 0, 'YXZ')
      }
      _ankle.copy(f.pos)
      _ankle.y += WALKER.ankle
      solveKnee(_hip, _ankle, _fwd, _knee)
      const th = thighs.current[i]
      const sh = shins.current[i]
      if (th) span(th, _hip, _knee, across)
      if (sh) span(sh, _knee, _ankle, across)
    })
  })

  return (
    <group name="walker" visible={visible} onClick={(e) => { e.stopPropagation(); select({ kind: 'aircraft', id: 'walker' }) }}>
      <group ref={(o) => { (hull as any).current = o; walkerObject.current = o; if (o) aircraftObjects.set('walker', o); else aircraftObjects.delete('walker') }}>
        <PartMeshes parts={geo.body} name="body" bind={binds.body} />
        <group ref={head} position={[0, 3.3, NECK_Z + 4.4]}>
          <PartMeshes parts={geo.head} name="head" bind={binds.head} />
        </group>
      </group>
      {LEGS.map((leg, i) => (
        <group key={leg.id}>
          <group ref={(o) => { thighs.current[i] = o }}><PartMeshes parts={geo.thigh} name="thigh" bind={binds.thigh} /></group>
          <group ref={(o) => { shins.current[i] = o }}><PartMeshes parts={geo.shin} name="shin" bind={binds.shin} /></group>
          <group ref={(o) => { feet.current[i] = o }}><PartMeshes parts={geo.foot} name="foot" bind={binds.foot} /></group>
        </group>
      ))}
    </group>
  )
}

/**
 * Visiting ships in the scene: the bounty hunter's gunship on its stand, the Hutt sail barge out on
 * the dunes, and the star destroyer high overhead. All motion comes from visitors.ts / destroyer.ts;
 * this file only draws. Simulated scenery — not AI agents, not real telemetry.
 */
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { sim } from '../sim/world'
import { useStore } from '../state/store'
import { puffTexture } from './Combat'
import { DESTROYER } from './destroyer'
import { Gunship } from './models/Gunship'
import { SailBarge } from './models/SailBarge'
import { StarDestroyer } from './models/StarDestroyer'
import { GUNSHIP, bargeAt } from './visitors'

type Register = (id: string) => (o: THREE.Object3D | null) => void

export function GunshipActor({ register }: { register: Register }) {
  const g = useRef<THREE.Group>(null)
  const reg = register('gunship')
  const [props, setProps] = useState({ gear: 0, thrust: 0 })
  const last = useRef(props)
  const select = useStore((s) => s.select)
  useFrame(() => {
    const s = sim.gunship.state
    const o = g.current
    if (!o) return
    o.visible = s.visible
    o.position.copy(s.pos)
    o.quaternion.copy(s.quat)
    const q = (v: number) => Math.round(v * 40) / 40
    const n = { gear: q(s.gear), thrust: q(s.thrust) }
    if (n.gear !== last.current.gear || n.thrust !== last.current.thrust) { last.current = n; setProps(n) }
  })
  return (
    <>
      <group ref={(o) => { (g as any).current = o; reg(o) }} onClick={(e) => { e.stopPropagation(); select({ kind: 'aircraft', id: 'gunship' }) }}>
        <Gunship gear={props.gear} thrust={props.thrust} />
      </group>
      {/* painted visitor stand */}
      <mesh position={[GUNSHIP.stand.x, GUNSHIP.stand.y + 0.06, GUNSHIP.stand.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[15, 15.8, 48]} />
        <meshStandardMaterial color="#c9b458" roughness={0.9} />
      </mesh>
      <mesh position={[GUNSHIP.stand.x, GUNSHIP.stand.y + 0.06, GUNSHIP.stand.z]} rotation={[-Math.PI / 2, 0, Math.PI / 4]} receiveShadow>
        <ringGeometry args={[3.2, 3.8, 4]} />
        <meshStandardMaterial color="#c9b458" roughness={0.9} />
      </mesh>
    </>
  )
}

const _pose = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 }

export function BargeActor({ register }: { register: Register }) {
  const g = useRef<THREE.Group>(null)
  const reg = register('barge')
  const select = useStore((s) => s.select)
  useFrame(() => {
    const o = g.current
    if (!o) return
    const b = bargeAt(sim.time, _pose)
    o.position.set(b.x, b.y, b.z)
    o.rotation.set(-b.pitch, b.heading, b.roll, 'YXZ')
  })
  return (
    <group ref={(o) => { (g as any).current = o; reg(o) }} onClick={(e) => { e.stopPropagation(); select({ kind: 'aircraft', id: 'barge' }) }}>
      <SailBarge />
    </group>
  )
}

const _look = new THREE.Vector3()

export function DestroyerActor({ register }: { register: Register }) {
  const g = useRef<THREE.Group>(null)
  const flash = useRef<THREE.Sprite>(null)
  const reg = register('destroyer')
  const [thrust, setThrust] = useState(0.4)
  const select = useStore((s) => s.select)
  const flashMat = useMemo(() => new THREE.SpriteMaterial({ map: puffTexture(), color: '#dff0ff', toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), [])
  useFrame(() => {
    const s = sim.destroyer.state
    const o = g.current
    if (!o) return
    o.visible = s.visible
    o.position.copy(s.pos)
    o.lookAt(_look.copy(s.pos).add(DESTROYER.heading))
    o.scale.set(1, 1, s.stretch) // at light speed the hull is a streak along its course
    const q = Math.round(s.thrust * 20) / 20
    if (q !== thrust) setThrust(q)
    const f = flash.current
    if (f) {
      f.visible = s.visible && s.flash > 0.01
      f.position.copy(s.pos)
      f.scale.setScalar(1800 + 5200 * s.flash)
      flashMat.opacity = Math.min(1, s.flash)
    }
  })
  return (
    <>
      <group ref={(o) => { (g as any).current = o; reg(o) }} onClick={(e) => { e.stopPropagation(); select({ kind: 'aircraft', id: 'destroyer' }) }}>
        <StarDestroyer thrust={thrust} />
      </group>
      <sprite ref={flash} material={flashMat} visible={false} frustumCulled={false} />
    </>
  )
}

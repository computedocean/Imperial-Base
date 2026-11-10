import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Explosion, LaserBolts, PicketActor } from './Combat'
import { Freighter } from './models/Freighter'
import { Shuttle } from './models/Shuttle'
import { TieFighter } from './models/TieFighter'
import { XWing } from './models/XWing'
import { sim } from '../sim/world'
import { useStore } from '../state/store'
import { HANGAR } from '../world/Structures'

/** Live object registry so cameras can follow aircraft. */
export const aircraftObjects = new Map<string, THREE.Object3D>()

function useRegister(id: string) {
  return (o: THREE.Object3D | null) => {
    if (o) aircraftObjects.set(id, o)
    else aircraftObjects.delete(id)
  }
}

function ShuttleActor() {
  const g = useRef<THREE.Group>(null)
  const [props, setProps] = useState({ wingFold: 0, gear: 0, ramp: 0, thrust: 0 })
  const last = useRef(props)
  const reg = useRegister('shuttle')
  const select = useStore((s) => s.select)
  useFrame(() => {
    const s = sim.shuttle.state
    const o = g.current
    if (!o) return
    o.visible = s.visible
    o.position.copy(s.pos)
    o.quaternion.copy(s.quat)
    // only re-render React when animation params actually move (quantised)
    const q = (v: number) => Math.round(v * 60) / 60
    const n = { wingFold: q(s.wingFold), gear: q(s.gear), ramp: q(s.ramp), thrust: q(s.thrust) }
    const l = last.current
    if (n.wingFold !== l.wingFold || n.gear !== l.gear || n.ramp !== l.ramp || n.thrust !== l.thrust) {
      last.current = n
      setProps(n)
    }
  })
  return (
    <group ref={(o) => { (g as any).current = o; reg(o) }} onClick={(e) => { e.stopPropagation(); select({ kind: 'aircraft', id: 'shuttle' }) }}>
      <Shuttle wingFold={props.wingFold} gear={props.gear} ramp={props.ramp} thrust={props.thrust} />
    </group>
  )
}

function FighterActor({ idx }: { idx: number }) {
  const g = useRef<THREE.Group>(null)
  const f = sim.patrol.fighters[idx]
  const reg = useRegister(f.id)
  const select = useStore((s) => s.select)
  useFrame(() => {
    const o = g.current
    if (!o) return
    o.visible = f.pose.visible
    o.position.copy(f.pose.pos)
    o.quaternion.copy(f.pose.quat)
  })
  return (
    <group ref={(o) => { (g as any).current = o; reg(o) }} onClick={(e) => { e.stopPropagation(); select({ kind: 'aircraft', id: f.id }) }}>
      <TieFighter thrust={0.85} />
    </group>
  )
}

function XWingActor() {
  const g = useRef<THREE.Group>(null)
  const reg = useRegister('xwing')
  const [foil, setFoil] = useState(0)
  const select = useStore((s) => s.select)
  useFrame(() => {
    const p = sim.xwing.pose
    const o = g.current
    if (!o) return
    o.visible = p.visible
    o.position.copy(p.pos)
    o.quaternion.copy(p.quat)
    const q = Math.round(p.sFoil * 30) / 30
    if (q !== foil) setFoil(q)
  })
  return (
    <group ref={(o) => { (g as any).current = o; reg(o) }} onClick={(e) => { e.stopPropagation(); select({ kind: 'aircraft', id: 'xwing' }) }}>
      <XWing sFoil={foil} thrust={0.9} />
    </group>
  )
}

function FreighterActor() {
  const g = useRef<THREE.Group>(null)
  const reg = useRegister('freighter')
  const [props, setProps] = useState({ gear: 1, thrust: 0 })
  const last = useRef(props)
  const select = useStore((s) => s.select)
  useFrame(() => {
    const s = sim.freighter.state
    const o = g.current
    if (!o) return
    o.visible = s.visible
    o.position.copy(s.pos)
    o.quaternion.copy(s.quat)
    const q = (v: number) => Math.round(v * 40) / 40
    const n = { gear: q(s.gear), thrust: q(s.thrust) }
    if (n.gear !== last.current.gear || n.thrust !== last.current.thrust) {
      last.current = n
      setProps(n)
    }
  })
  return (
    <group ref={(o) => { (g as any).current = o; reg(o) }} onClick={(e) => { e.stopPropagation(); select({ kind: 'aircraft', id: 'freighter' }) }}>
      <Freighter gear={props.gear} thrust={props.thrust} />
    </group>
  )
}

function Picket() {
  const reg = useRegister('picket')
  return <PicketActor register={reg} />
}

function Interceptor({ i }: { i: number }) {
  const g = useRef<THREE.Group>(null)
  const reg = useRegister(`intercept-${i}`)
  useFrame(() => {
    const p = sim.xwing.interceptors[i]
    const o = g.current
    if (!o) return
    o.visible = p.visible
    o.position.copy(p.pos)
    o.quaternion.copy(p.quat)
  })
  return <group ref={(o) => { (g as any).current = o; reg(o) }}><TieFighter thrust={0.95} /></group>
}

/** Fighters parked inside Hangar Alpha (static scenery, hidden when that slot is airborne). */
function ParkedFighters() {
  const refs = useRef<(THREE.Group | null)[]>([])
  const slots = Array.from({ length: 6 }, (_, i) => [HANGAR.x0 + 45 + (i % 3) * 26, 7, HANGAR.z0 + 40 + Math.floor(i / 3) * 70] as const)
  useFrame(() => {
    sim.patrol.fighters.forEach((f, i) => {
      const r = refs.current[i]
      if (r) r.visible = f.state === 'parked'
    })
  })
  return (
    <group>
      {slots.map((p, i) => (
        <group key={i} ref={(o) => (refs.current[i] = o)} position={p as unknown as [number, number, number]} rotation={[0, Math.PI / 2, 0]}>
          <TieFighter thrust={0} />
        </group>
      ))}
    </group>
  )
}

/** Animated great doors of Hangar Alpha: two panels slide apart along the east face. */
export function HangarDoors() {
  const a = useRef<THREE.Mesh>(null)
  const b = useRef<THREE.Mesh>(null)
  const W = (HANGAR.doorZ1 - HANGAR.doorZ0) / 2
  const zc = (HANGAR.doorZ0 + HANGAR.doorZ1) / 2
  useFrame(() => {
    const k = sim.hangarDoor
    if (a.current) a.current.position.z = zc - W / 2 - k * (W - 2)
    if (b.current) b.current.position.z = zc + W / 2 + k * (W - 2)
  })
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#7d838a', roughness: 0.55, metalness: 0.6 }), [])
  return (
    <group position={[HANGAR.x1 + 4.2, HANGAR.doorH / 2, 0]}>
      <mesh ref={a} material={mat} castShadow><boxGeometry args={[1.5, HANGAR.doorH, W]} /></mesh>
      <mesh ref={b} material={mat} castShadow><boxGeometry args={[1.5, HANGAR.doorH, W]} /></mesh>
    </group>
  )
}

export function AircraftLayer() {
  return (
    <group name="aircraft">
      <ShuttleActor />
      {sim.patrol.fighters.map((_, i) => <FighterActor key={i} idx={i} />)}
      <XWingActor />
      <FreighterActor />
      <Picket />
      <LaserBolts />
      <Explosion />
      <Explosion kind="strike" />
      <Interceptor i={0} />
      <Interceptor i={1} />
      <ParkedFighters />
      <HangarDoors />
    </group>
  )
}

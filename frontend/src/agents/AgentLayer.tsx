import { Billboard, Html, Line, Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { HeroCharacter } from '../personnel/HeroCharacter'
import { useStore } from '../state/store'
import type { AgentInfo, AgentStatus } from '../state/types'
import { FACILITIES } from '../world/layout'
import { actorSystem } from './actors'

export const STATUS_COLOR: Record<AgentStatus, string> = {
  active: '#5cc8ff',
  working: '#47d16c',
  delegating: '#c38bff',
  waiting: '#ffb02e',
  idle: '#9fb3c8',
  completed: '#2fbf9f',
  failed: '#ff4a3d',
  disconnected: '#5c6670',
}

/** Live object registry for camera follow. */
export const agentObjects = new Map<string, THREE.Object3D>()

function AgentBody({ id }: { id: string }) {
  const g = useRef<THREE.Group>(null)
  const agent = useStore((s) => s.agents[id])
  const selected = useStore((s) => s.selection?.kind === 'agent' && s.selection.id === id)
  const interior = useStore((s) => s.interior)
  const select = useStore((s) => s.select)
  const [motion, setMotion] = useState<{ action: 'walk' | 'idle' | 'work' | 'talk'; speed: number }>({ action: 'idle', speed: 0 })
  useEffect(() => {
    const o = g.current
    if (o) agentObjects.set(id, o)
    return () => { agentObjects.delete(id) }
  }, [id])
  useFrame(() => {
    const act = actorSystem.actors.get(id)
    const o = g.current
    if (!act || !o) return
    o.position.copy(act.pos)
    o.rotation.y = act.heading
    const action = act.speed > 0 ? 'walk' : act.action
    if (action !== motion.action || act.speed !== motion.speed) setMotion({ action, speed: act.speed })
  })
  if (!agent) return null
  const color = STATUS_COLOR[agent.status]
  const inside = interior === agent.department
  return (
    <group ref={g} onClick={(e) => { e.stopPropagation(); select({ kind: 'agent', id }) }}>
      <HeroCharacter action={motion.action} speed={motion.speed} accent={color} selected={selected} status={agent.status} phase={id.length} />
      {(inside || selected) && (
        <Html position={[0, 2.35, 0]} center distanceFactor={6} zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`nameplate ${selected ? 'sel' : ''}`} style={{ borderColor: color }}>
            <div className="np-live">● LIVE AGENT</div>
            <div className="np-name">{agent.name}</div>
            <div className="np-role">{agent.role}</div>
            <div className="np-status" style={{ color }}>{agent.status.toUpperCase()}{agent.active_tool ? ` · ${agent.active_tool}` : ''}{agent.stale ? ' · ACTIVITY UNKNOWN' : ''}</div>
          </div>
        </Html>
      )}
    </group>
  )
}

/** Delegation handoff: a glowing arc from parent to child with a travelling data packet. */
function DelegationArc({ parent, child, active }: { parent: string; child: string; active: boolean }) {
  const packet = useRef<THREE.Mesh>(null)
  const [pts, setPts] = useState<THREE.Vector3[] | null>(null)
  const curve = useRef<THREE.QuadraticBezierCurve3 | null>(null)
  const tick = useRef(0)
  useFrame((_, dt) => {
    const a = actorSystem.actors.get(parent)
    const b = actorSystem.actors.get(child)
    if (!a || !b) { if (pts) setPts(null); return }
    tick.current += dt
    const p0 = a.pos.clone().setY(a.pos.y + 2.2)
    const p2 = b.pos.clone().setY(b.pos.y + 2.2)
    const dist = p0.distanceTo(p2)
    const mid = p0.clone().lerp(p2, 0.5)
    mid.y = Math.max(p0.y, p2.y) + Math.min(120, 4 + dist * 0.35)
    curve.current = new THREE.QuadraticBezierCurve3(p0, mid, p2)
    if (!pts || tick.current > 0.5) {
      tick.current = 0
      setPts(curve.current.getPoints(32))
    }
    if (packet.current && curve.current) {
      const t = (performance.now() / 1600) % 1
      packet.current.position.copy(curve.current.getPoint(t))
      packet.current.visible = active
    }
  })
  if (!pts) return null
  return (
    <group>
      <Line points={pts} color={active ? '#c38bff' : '#5c4d78'} lineWidth={active ? 2.2 : 1} transparent opacity={active ? 0.85 : 0.35} dashed={!active} dashSize={1.5} gapSize={1} />
      <mesh ref={packet}>
        <sphereGeometry args={[0.6, 10, 8]} />
        <meshBasicMaterial color="#e2c8ff" toneMapped={false} />
      </mesh>
    </group>
  )
}

const beaconRefs = new Set<THREE.Object3D>()

/** Hides beacons the camera is too close to (world-size text would fill the screen). */
function BeaconFade() {
  useFrame(({ camera }) => {
    for (const o of beaconRefs) {
      if (!o.parent) { beaconRefs.delete(o); continue }
      o.visible = camera.position.distanceTo(o.position) > 260
    }
  })
  return null
}

/** Exterior department beacons: show which buildings have live agents and their status mix. */
function DepartmentBeacons({ agents }: { agents: AgentInfo[] }) {
  const showLabels = useStore((s) => s.showLabels)
  const interior = useStore((s) => s.interior)
  const select = useStore((s) => s.select)
  const byDept = useMemo(() => {
    const m: Record<string, AgentInfo[]> = {}
    for (const a of agents) (m[a.department] ??= []).push(a)
    return m
  }, [agents])
  if (interior) return null
  return (
    <group>
      {FACILITIES.map((f) => {
        const list = byDept[f.id] ?? []
        if (!list.length && !showLabels) return null
        const y = f.id === 'command' ? 175 : f.sy + 16
        return (
          <Billboard key={f.id} position={[f.x, y, f.z]} userData={{ beacon: true }} ref={(o) => { if (o) beaconRefs.add(o) }}>
            {showLabels && (
              <Text fontSize={9} color={f.accent} anchorX="center" anchorY="bottom" outlineWidth={0.25} outlineColor="#000" letterSpacing={0.15}
                onClick={(e) => { e.stopPropagation(); select({ kind: 'facility', id: f.id }) }}>
                {f.short}
              </Text>
            )}
            {list.length > 0 && (
              <group position={[0, -1.5, 0]}>
                <Text fontSize={5.5} color="#e8f4ff" anchorX="center" anchorY="top" outlineWidth={0.2} outlineColor="#000">
                  {`${list.length} LIVE AGENT${list.length > 1 ? 'S' : ''}`}
                </Text>
                {list.slice(0, 12).map((a, i) => (
                  <mesh key={a.id} position={[(i - (Math.min(12, list.length) - 1) / 2) * 3.2, -6.4, 0]}>
                    <circleGeometry args={[1.1, 16]} />
                    <meshBasicMaterial color={STATUS_COLOR[a.status]} toneMapped={false} />
                  </mesh>
                ))}
              </group>
            )}
          </Billboard>
        )
      })}
    </group>
  )
}

export function AgentLayer() {
  const agents = useStore((s) => s.agents)
  const [ids, setIds] = useState<string[]>([])
  // sync the motion system whenever confirmed agent state changes (and once a second for expiry)
  useEffect(() => {
    const sync = () => {
      actorSystem.sync(useStore.getState().agents, Date.now() / 1000)
      const next = [...actorSystem.actors.keys()].sort()
      setIds((prev) => (prev.join() === next.join() ? prev : next))
    }
    sync()
    const t = window.setInterval(sync, 1000)
    return () => window.clearInterval(t)
  }, [agents])
  useFrame((_, dt) => actorSystem.update(Math.min(dt, 0.1)))
  const present = ids.map((id) => agents[id]).filter(Boolean)
  const arcs = present.filter((a) => a.parent_id && actorSystem.actors.has(a.parent_id))
  return (
    <group name="agents">
      {ids.map((id) => <AgentBody key={id} id={id} />)}
      {arcs.map((a) => (
        <DelegationArc key={a.id} parent={a.parent_id!} child={a.id}
          active={(a.status === 'active' || a.status === 'working' || a.status === 'waiting' || a.status === 'delegating')} />
      ))}
      <DepartmentBeacons agents={present} />
      <BeaconFade />
    </group>
  )
}

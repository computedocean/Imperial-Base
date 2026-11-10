import { useFrame, type ThreeElements } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { actorSystem } from '../agents/actors'
import { sim } from '../sim/world'
import { useStore } from '../state/store'
import { STATUS_COLOR } from '../agents/AgentLayer'
import { FACILITIES, perimeterVertices } from '../world/layout'

const S = 1 / 190 // world metres -> table metres

/** Live miniature of the installation: buildings, perimeter, aircraft and real agent positions. */
export function HoloTactical(props: ThreeElements['group']) {
  const air = useRef<THREE.InstancedMesh>(null)
  const ag = useRef<THREE.InstancedMesh>(null)
  const spin = useRef<THREE.Group>(null)
  const holo = useMemo(() => new THREE.MeshBasicMaterial({ color: '#4cb8ff', transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false }), [])
  const holoEdge = useMemo(() => new THREE.LineBasicMaterial({ color: '#8fd6ff', transparent: true, opacity: 0.8, toneMapped: false }), [])
  const buildings = useMemo(() => FACILITIES.map((f) => {
    const g = new THREE.BoxGeometry(f.sx * S, Math.max(0.04, f.sy * S * 1.6), f.sz * S)
    return { f, g, e: new THREE.EdgesGeometry(g) }
  }), [])
  const wall = useMemo(() => {
    const v = perimeterVertices()
    return new THREE.BufferGeometry().setFromPoints([...v, v[0]].map(([x, z]) => new THREE.Vector3(x * S, 0.02, z * S)))
  }, [])
  const o = useMemo(() => new THREE.Object3D(), [])
  const col = useMemo(() => new THREE.Color(), [])
  useFrame((_, dt) => {
    if (spin.current) spin.current.rotation.y += dt * 0.02
    // aircraft blips (simulated)
    const m = air.current
    if (m) {
      let n = 0
      const put = (p: THREE.Vector3, vis: boolean) => {
        if (!vis || n >= 16) return
        const d = Math.hypot(p.x, p.z) * S
        if (d > 3.1) return
        o.position.set(p.x * S, 0.15 + Math.min(1.4, p.y * S * 0.6), p.z * S)
        o.scale.setScalar(1)
        o.updateMatrix()
        m.setMatrixAt(n++, o.matrix)
      }
      put(sim.shuttle.state.pos, sim.shuttle.state.visible)
      for (const f of sim.patrol.fighters) put(f.pose.pos, f.pose.visible)
      put(sim.xwing.pose.pos, sim.xwing.pose.visible)
      put(sim.freighter.state.pos, sim.freighter.state.visible)
      put(sim.xwing.picket.pos, sim.xwing.picket.visible)
      m.count = n
      m.instanceMatrix.needsUpdate = true
    }
    // real agent positions
    const a = ag.current
    if (a) {
      const agents = useStore.getState().agents
      let n = 0
      for (const act of actorSystem.actors.values()) {
        if (n >= 64) break
        o.position.set(act.pos.x * S, 0.12, act.pos.z * S)
        o.scale.setScalar(1)
        o.updateMatrix()
        a.setMatrixAt(n, o.matrix)
        col.set(STATUS_COLOR[agents[act.id]?.status ?? 'idle'])
        a.setColorAt(n, col)
        n++
      }
      a.count = n
      a.instanceMatrix.needsUpdate = true
      if (a.instanceColor) a.instanceColor.needsUpdate = true
    }
  })
  return (
    <group {...props}>
      <group ref={spin}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} material={holo}>
          <circleGeometry args={[2.9, 48]} />
        </mesh>
        <lineLoop geometry={wall} material={holoEdge} />
        {buildings.map(({ f, g, e }) => (
          <group key={f.id} position={[f.x * S, Math.max(0.04, f.sy * S * 1.6) / 2 + 0.01, f.z * S]}>
            <mesh geometry={g} material={holo} />
            <lineSegments geometry={e} material={holoEdge} />
          </group>
        ))}
        <instancedMesh ref={air} args={[undefined, undefined, 16]} frustumCulled={false}>
          <octahedronGeometry args={[0.05]} />
          <meshBasicMaterial color="#ffd27a" toneMapped={false} />
        </instancedMesh>
        <instancedMesh ref={ag} args={[undefined, undefined, 64]} frustumCulled={false}>
          <sphereGeometry args={[0.035, 8, 6]} />
          <meshBasicMaterial toneMapped={false} />
        </instancedMesh>
      </group>
      <pointLight position={[0, 1, 0]} intensity={30} distance={10} color="#4cb8ff" />
    </group>
  )
}

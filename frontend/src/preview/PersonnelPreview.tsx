// ?preview=personnel — lineup of every uniform in different actions, a ring of
// walkers and two hero characters. Add &sim=1 to run the full 150-person
// base simulation instead (camera over the hangar apron / landing pad).

import { useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Crowd, PERSONNEL_VARIANTS, type CrowdMember, type PersonnelVariant } from '../personnel/Crowd'
import { HeroCharacter } from '../personnel/HeroCharacter'
import { createCrowdSim } from '../personnel/sim'
import { PADS } from '../world/layout'

const params = new URLSearchParams(location.search)
const SIM = params.get('sim') === '1'
const vec = (k: string): [number, number, number] | null => {
  const v = params.get(k)?.split(',').map(Number)
  return v && v.length === 3 && v.every(Number.isFinite) ? [v[0], v[1], v[2]] : null
}
const CAM = vec('cam')
const TGT = vec('tgt')

const ROW_ACTIONS: Record<PersonnelVariant, CrowdMember['action']> = {
  officer: 'talk',
  trooper: 'guard',
  engineer: 'work',
  technician: 'work',
  scientist: 'talk',
  pilot: 'salute',
  crew: 'inspect',
  analyst: 'idle',
}

function useLineup() {
  return useMemo(() => {
    const list: CrowdMember[] = []
    const n = PERSONNEL_VARIANTS.length
    PERSONNEL_VARIANTS.forEach((v, i) => {
      const x = (i - (n - 1) / 2) * 1.25
      list.push({ x, y: 0, z: 0, heading: 0, speed: 0, action: 'idle', variant: v, phase: i * 17.3, visible: true })
      list.push({ x, y: 0, z: -2.6, heading: 0, speed: 0, action: ROW_ACTIONS[v], variant: v, phase: i * 5.1 + 3, visible: true })
    })
    // extra: officer saluting, trooper saluting, crew working, analyst at console
    const extra: [PersonnelVariant, CrowdMember['action']][] = [
      ['officer', 'salute'], ['trooper', 'salute'], ['crew', 'work'], ['analyst', 'work'], ['engineer', 'inspect'], ['officer', 'idle'],
    ]
    extra.forEach(([v, a], i) => {
      list.push({ x: (i - 2.5) * 1.3, y: 0, z: -5.2, heading: 0, speed: 0, action: a, variant: v, phase: i * 9.7, visible: true })
    })
    // walkers on a loop
    for (let i = 0; i < 12; i++) {
      list.push({ x: 0, y: 0, z: 0, heading: 0, speed: 1.15 + (i % 4) * 0.13, action: 'walk', variant: PERSONNEL_VARIANTS[i % n], phase: i * 0.37, visible: true })
    }
    return list
  }, [])
}

function LineupScene() {
  const list = useLineup()
  const members = useRef(list)
  const walkerStart = list.length - 12
  const angles = useRef(Array.from({ length: 12 }, (_, i) => (i / 12) * Math.PI * 2))
  useFrame((_, dt) => {
    const d = Math.min(dt, 0.1)
    for (let i = 0; i < 12; i++) {
      const m = members.current[walkerStart + i]
      const R = 9 + (i % 3) * 1.1
      angles.current[i] += (m.speed / R) * d
      const a = angles.current[i]
      m.x = Math.cos(a) * R
      m.z = -2.5 + Math.sin(a) * R
      m.heading = Math.atan2(-Math.sin(a), Math.cos(a)) // tangent (counter-clockwise)
    }
  })
  return (
    <>
      <Crowd members={members} capacity={64} castShadow />
      {/* consoles for the 'work' row */}
      {[[-1.875, -2.6], [-0.625, -2.6], [-0.65, -5.2], [0.65, -5.2]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.47, z + 0.6]} castShadow receiveShadow>
          <boxGeometry args={[0.9, 0.94, 0.42]} />
          <meshStandardMaterial color="#3a3e44" metalness={0.5} roughness={0.45} />
        </mesh>
      ))}
      <HeroCharacter position={[-1.6, 0, 3]} action="idle" speed={0} selected />
      <HeroCharacter position={[1.6, 0, 3]} rotation={[0, -0.5, 0]} action="talk" speed={0} accent="#62d0c8" status="working" phase={4} />
    </>
  )
}

function SimScene() {
  const sim = useMemo(() => createCrowdSim({ count: 150, seed: 1977 }), [])
  const members = useRef(sim.members)
  const t = useRef(0)
  useFrame((_, dt) => {
    t.current += dt
    const want = Math.floor(t.current / 60) % 2 === 0
    sim.update(dt, { shuttleLanded: want, shuttlePad: { x: PADS[0].x, z: PADS[0].z, y: PADS[0].y } })
  })
  return (
    <>
      <Crowd members={members} capacity={160} />
      <mesh position={[PADS[0].x, PADS[0].y / 2, PADS[0].z]} receiveShadow>
        <cylinderGeometry args={[PADS[0].radius, PADS[0].radius, PADS[0].y, 32]} />
        <meshStandardMaterial color="#3c4046" />
      </mesh>
    </>
  )
}

function Stats() {
  const gl = useThree((s) => s.gl)
  const el = useRef<HTMLDivElement | null>(null)
  if (!el.current && typeof document !== 'undefined') {
    const d = document.createElement('div')
    d.style.cssText = 'position:fixed;left:12px;bottom:10px;color:#9fb3c8;font:12px monospace;z-index:10;pointer-events:none'
    d.id = 'personnel-stats'
    document.body.appendChild(d)
    el.current = d
  }
  const acc = useRef({ f: 0, t: 0 })
  useFrame((_, dt) => {
    const a = acc.current
    a.f++
    a.t += dt
    if (a.t > 0.5 && el.current) {
      el.current.textContent = `${(a.f / a.t).toFixed(0)} fps · ${gl.info.render.calls} draw calls · ${gl.info.render.triangles} tris`
      a.f = 0
      a.t = 0
    }
  })
  return null
}

export default function PersonnelPreview() {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0d0f12' }}>
      <Canvas
        shadows="percentage"
        dpr={[1, 1.5]}
        camera={CAM ? { position: CAM, fov: 40, near: 0.05, far: 3000 } : SIM ? { position: [-60, 45, 70], fov: 45, near: 0.1, far: 3000 } : { position: [0.5, 2.1, 8.6], fov: 40, near: 0.05, far: 500 }}
      >
        <color attach="background" args={['#14171b']} />
        <fog attach="fog" args={['#14171b', 30, SIM ? 900 : 60]} />
        <hemisphereLight args={['#c8d4e0', '#2a2622', 0.9]} />
        <directionalLight
          position={[6, 10, 7]}
          intensity={2.2}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-14}
          shadow-camera-right={14}
          shadow-camera-top={14}
          shadow-camera-bottom={-14}
          shadow-bias={-0.0005}
        />
        <directionalLight position={[-6, 4, -5]} intensity={0.6} color="#8fb4ff" />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[SIM ? 1200 : 80, SIM ? 1200 : 80]} />
          <meshStandardMaterial color="#2b2e33" roughness={0.85} metalness={0.15} />
        </mesh>
        <gridHelper args={[SIM ? 1200 : 40, SIM ? 120 : 40, '#3a4048', '#262a30']} position={[0, 0.002, 0]} />
        {SIM ? <SimScene /> : <LineupScene />}
        <OrbitControls target={TGT ?? (SIM ? [-150, 0, 20] : [0, 1.0, -1.5])} makeDefault />
        <Stats />
      </Canvas>
    </div>
  )
}

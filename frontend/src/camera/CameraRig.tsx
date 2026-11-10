import { MapControls, OrbitControls, PointerLockControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { aircraftObjects } from '../aircraft/AircraftLayer'
import { DESTROYER } from '../aircraft/destroyer'
import { FUEL_DUMP } from '../aircraft/flight'
import { agentObjects } from '../agents/AgentLayer'
import { actorSystem } from '../agents/actors'
import { INTERIORS } from '../interiors/layouts'
import { createDuelState, duelAt } from '../personnel/duelMoves'
import { MARCH, toWorld } from '../personnel/marchPlan'
import { HeroCharacter } from '../personnel/HeroCharacter'
import { sim } from '../sim/world'
import { useStore, type TourId } from '../state/store'
import { FACILITIES, PADS, facilityById, obstacleBoxes, terrainHeight, type DepartmentId } from '../world/layout'

// ------------------------------------------------------------------ keyboard
const keys = new Set<string>()
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => { if (!(e.target instanceof HTMLInputElement)) keys.add(e.code) })
  window.addEventListener('keyup', (e) => keys.delete(e.code))
  window.addEventListener('blur', () => keys.clear())
}

/** Commander position (first/third person), shared so the UI can show prompts. */
export const commander = { pos: new THREE.Vector3(0, 0, 90), yaw: Math.PI, nearDoor: null as DepartmentId | null, exitPrompt: false }
export const doorPrompt = { listeners: new Set<(d: string | null) => void>() }
function setPrompt(p: string | null) { doorPrompt.listeners.forEach((f) => f(p)) }

const boxes = obstacleBoxes().filter((b) => b.id !== 'command-spire')
const exteriorInteriorIds = new Set(FACILITIES.filter((f) => f.interior && INTERIORS[f.id]).map((f) => f.id))

function groundAt(x: number, z: number, interior: DepartmentId | null) {
  if (interior && INTERIORS[interior]) return INTERIORS[interior]!.origin[1]
  const pad = PADS[0]
  if (Math.hypot(x - pad.x, z - pad.z) < pad.radius) return pad.y
  return terrainHeight(x, z)
}

/** Resolve horizontal collisions: buildings outside, room walls inside. */
function collide(p: THREE.Vector3, interior: DepartmentId | null) {
  const R = 0.5
  if (interior && INTERIORS[interior]) {
    const l = INTERIORS[interior]!
    p.x = Math.min(l.origin[0] + l.w / 2 - 1, Math.max(l.origin[0] - l.w / 2 + 1, p.x))
    p.z = Math.min(l.origin[2] + l.d / 2 - 1, Math.max(l.origin[2] - l.d / 2 + 1, p.z))
    return
  }
  for (const b of boxes) {
    if (b.id === 'hangar') {
      // hangar is walkable through its open door: collide with its three solid walls only
      const inX = p.x > b.min[0] - R && p.x < b.max[0] + R
      const inZ = p.z > b.min[2] - R && p.z < b.max[2] + R
      if (!inX || !inZ) continue
      if (p.x < b.min[0] + 3.5) p.x = b.min[0] + 3.5
      if (p.z < b.min[2] + 3.5) p.z = b.min[2] + 3.5
      if (p.z > b.max[2] - 3.5) p.z = b.max[2] - 3.5
      if (p.x > b.max[0] - 4 && (p.z < -38 || p.z > 78) && p.x < b.max[0] + R) p.x = b.max[0] - 4
      continue
    }
    if (p.x > b.min[0] - R && p.x < b.max[0] + R && p.z > b.min[2] - R && p.z < b.max[2] + R) {
      const dx = Math.min(p.x - (b.min[0] - R), b.max[0] + R - p.x)
      const dz = Math.min(p.z - (b.min[2] - R), b.max[2] + R - p.z)
      if (dx < dz) p.x = p.x - (b.min[0] - R) < b.max[0] + R - p.x ? b.min[0] - R : b.max[0] + R
      else p.z = p.z - (b.min[2] - R) < b.max[2] + R - p.z ? b.min[2] - R : b.max[2] + R
    }
  }
}

/** Shared door logic: near a facility door → offer entry; near an interior entry → offer exit. */
function doorCheck(p: THREE.Vector3, interior: DepartmentId | null) {
  commander.nearDoor = null
  commander.exitPrompt = false
  if (interior && INTERIORS[interior]) {
    const l = INTERIORS[interior]!
    if (Math.hypot(p.x - (l.origin[0] + l.entry[0]), p.z - (l.origin[2] + l.entry[1])) < 4) {
      commander.exitPrompt = true
      setPrompt(`[E] Exit ${facilityById[interior].name}`)
      return
    }
    setPrompt(null)
    return
  }
  for (const f of FACILITIES) {
    if (!exteriorInteriorIds.has(f.id)) continue
    if (Math.hypot(p.x - f.door[0], p.z - f.door[1]) < 9) {
      commander.nearDoor = f.id
      setPrompt(`[E] Enter ${f.name}`)
      return
    }
  }
  setPrompt(null)
}

export function enterAt(id: DepartmentId) {
  const l = INTERIORS[id]
  const st = useStore.getState()
  if (!l) return
  st.enterInterior(id)
  commander.pos.set(l.origin[0] + l.entry[0], l.origin[1], l.origin[2] + l.entry[1])
  commander.yaw = Math.atan2(-l.entry[0], -l.entry[1])
}

export function exitInterior() {
  const st = useStore.getState()
  const id = st.interior
  if (!id) return
  const f = facilityById[id]
  st.enterInterior(null)
  const dir = new THREE.Vector3(f.door[0] - f.x, 0, f.door[1] - f.z).normalize()
  commander.pos.set(f.door[0] + dir.x * 6, 0, f.door[1] + dir.z * 6)
  commander.yaw = Math.atan2(dir.x, dir.z)
}

function useDoorKey() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyE') return
      if (commander.exitPrompt) exitInterior()
      else if (commander.nearDoor) enterAt(commander.nearDoor)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

// ------------------------------------------------------------------ first person
function FirstPerson() {
  const { camera } = useThree()
  const interior = useStore((s) => s.interior)
  useDoorKey()
  useEffect(() => {
    camera.position.set(commander.pos.x, groundAt(commander.pos.x, commander.pos.z, interior) + 1.7, commander.pos.z)
    // the camera looks down its -Z axis while character headings are +Z, hence the half turn
    camera.rotation.set(0, commander.yaw + Math.PI, 0, 'YXZ')
    return () => setPrompt(null)
  }, [camera, interior])
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame((_, dt) => {
    const speed = (keys.has('ShiftLeft') ? 14 : 5) * Math.min(dt, 0.1)
    const fwd = new THREE.Vector3()
    camera.getWorldDirection(fwd)
    fwd.y = 0
    fwd.normalize()
    const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize()
    v.set(0, 0, 0)
    if (keys.has('KeyW') || keys.has('ArrowUp')) v.add(fwd)
    if (keys.has('KeyS') || keys.has('ArrowDown')) v.sub(fwd)
    if (keys.has('KeyD') || keys.has('ArrowRight')) v.add(right)
    if (keys.has('KeyA') || keys.has('ArrowLeft')) v.sub(right)
    if (v.lengthSq() > 0) camera.position.addScaledVector(v.normalize(), speed)
    collide(camera.position, interior)
    const gy = groundAt(camera.position.x, camera.position.z, interior) + 1.7
    camera.position.y += (gy - camera.position.y) * Math.min(1, dt * 10)
    commander.pos.set(camera.position.x, gy - 1.7, camera.position.z)
    commander.yaw = camera.rotation.y - Math.PI
    doorCheck(commander.pos, interior)
  })
  return <PointerLockControls />
}

// ------------------------------------------------------------------ third person
function ThirdPerson() {
  const { camera, gl } = useThree()
  const interior = useStore((s) => s.interior)
  const body = useRef<THREE.Group>(null)
  const [moving, setMoving] = useState(false)
  const orbit = useRef({ yaw: commander.yaw + Math.PI, pitch: 0.35, dist: 7 })
  useDoorKey()
  useEffect(() => {
    const el = gl.domElement
    let drag = false
    const down = () => (drag = true)
    const up = () => (drag = false)
    const move = (e: PointerEvent) => {
      if (!drag) return
      orbit.current.yaw -= e.movementX * 0.005
      orbit.current.pitch = Math.max(0.05, Math.min(1.2, orbit.current.pitch + e.movementY * 0.004))
    }
    const wheel = (e: WheelEvent) => { orbit.current.dist = Math.max(3, Math.min(30, orbit.current.dist * (1 + Math.sign(e.deltaY) * 0.1))) }
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointermove', move)
    el.addEventListener('wheel', wheel, { passive: true })
    return () => {
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointermove', move)
      el.removeEventListener('wheel', wheel)
      setPrompt(null)
    }
  }, [gl])
  useFrame((_, dt) => {
    const o = orbit.current
    const camFwd = new THREE.Vector3(-Math.sin(o.yaw), 0, -Math.cos(o.yaw))
    const right = new THREE.Vector3(-camFwd.z, 0, camFwd.x)
    const v = new THREE.Vector3()
    if (keys.has('KeyW') || keys.has('ArrowUp')) v.add(camFwd)
    if (keys.has('KeyS') || keys.has('ArrowDown')) v.sub(camFwd)
    if (keys.has('KeyD') || keys.has('ArrowRight')) v.add(right)
    if (keys.has('KeyA') || keys.has('ArrowLeft')) v.sub(right)
    const mv = v.lengthSq() > 0
    if (mv !== moving) setMoving(mv)
    const sp = keys.has('ShiftLeft') ? 9 : 3.2
    if (mv) {
      v.normalize()
      commander.pos.addScaledVector(v, sp * Math.min(dt, 0.1))
      const want = Math.atan2(v.x, v.z)
      let d = want - commander.yaw
      while (d > Math.PI) d -= Math.PI * 2
      while (d < -Math.PI) d += Math.PI * 2
      commander.yaw += d * Math.min(1, dt * 10)
    }
    collide(commander.pos, interior)
    commander.pos.y = groundAt(commander.pos.x, commander.pos.z, interior)
    doorCheck(commander.pos, interior)
    if (body.current) {
      body.current.position.copy(commander.pos)
      body.current.rotation.y = commander.yaw
    }
    const dist = interior ? Math.min(o.dist, 6) : o.dist
    const target = commander.pos.clone().add(new THREE.Vector3(0, 1.6, 0))
    const want = target.clone().add(new THREE.Vector3(Math.sin(o.yaw) * Math.cos(o.pitch) * dist, Math.sin(o.pitch) * dist, Math.cos(o.yaw) * Math.cos(o.pitch) * dist))
    if (interior && INTERIORS[interior]) want.y = Math.min(want.y, INTERIORS[interior]!.origin[1] + INTERIORS[interior]!.h - 0.8)
    camera.position.lerp(want, Math.min(1, dt * 8))
    camera.lookAt(target)
  })
  return (
    <group ref={body}>
      <HeroCharacter action={moving ? 'walk' : 'idle'} speed={moving ? (keys.has('ShiftLeft') ? 9 : 3.2) : 0} accent="#d8b45a" />
    </group>
  )
}

// ------------------------------------------------------------------ follow
function Follow() {
  const { camera } = useThree()
  const target = useStore((s) => s.followTarget)
  const interior = useStore((s) => s.interior)
  const agent = useStore((s) => (target?.kind === 'agent' ? s.agents[target.id] : undefined))
  const last = useRef(new THREE.Vector3())
  useEffect(() => {
    // following an agent takes the commander inside that agent's department
    if (target?.kind === 'agent' && agent && INTERIORS[agent.department as DepartmentId] && interior !== agent.department) {
      useStore.getState().enterInterior(agent.department as DepartmentId)
    }
    if (target?.kind === 'aircraft' && interior) useStore.getState().enterInterior(null)
  }, [target, agent?.department]) // eslint-disable-line react-hooks/exhaustive-deps
  useFrame((_, dt) => {
    if (!target) return
    const o = target.kind === 'aircraft' ? aircraftObjects.get(target.id) : target.kind === 'agent' ? agentObjects.get(target.id) : null
    if (!o) return
    const p = o.getWorldPosition(new THREE.Vector3())
    if (target.kind === 'aircraft') {
      if (!o.visible) return
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()))
      const scale = target.id === 'shuttle' ? 55 : target.id === 'freighter' ? 70 : target.id === 'walker' ? 62 : target.id === 'barge' ? 85 : target.id === 'gunship' ? 52 : target.id === 'destroyer' ? 2700 : 30
      const want = p.clone().addScaledVector(fwd, -scale).add(new THREE.Vector3(0, scale * 0.35, 0))
      want.y = Math.max(want.y, terrainHeight(want.x, want.z) + 4)
      camera.position.lerp(want, Math.min(1, dt * 3))
      camera.lookAt(p)
    } else {
      const l = INTERIORS[(agent?.department ?? 'engineering') as DepartmentId]
      const head = p.clone().add(new THREE.Vector3(0, 1.5, 0))
      const yaw = o.rotation.y
      const want = head.clone().add(new THREE.Vector3(-Math.sin(yaw) * 5 + 2, 2.2, -Math.cos(yaw) * 5 + 2))
      if (l) want.y = Math.min(want.y, l.origin[1] + l.h - 0.8)
      camera.position.lerp(want, Math.min(1, dt * 2.5))
      last.current.lerp(head, Math.min(1, dt * 5))
      camera.lookAt(last.current)
    }
  })
  return null
}

// ------------------------------------------------------------------ cinematic tours
interface Shot { from: THREE.Vector3[]; look: THREE.Vector3[] | (() => THREE.Vector3); dur: number; interior?: DepartmentId | null; dynamic?: (t: number) => { pos: THREE.Vector3; look: THREE.Vector3 } }
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

const duelScratch = createDuelState()

function tourShots(id: TourId): Shot[] {
  const pad = PADS[0]
  switch (id) {
    case 'flyover':
      return [
        { from: [V(1400, 420, 1300), V(700, 260, 760), V(260, 160, 420)], look: [V(0, 40, 0), V(0, 50, 0), V(-60, 30, 40)], dur: 22, interior: null },
        { from: [V(260, 110, -420), V(-60, 90, -380), V(-380, 120, -200)], look: [V(100, 20, -200), V(-60, 20, -200), V(-250, 30, 20)], dur: 18, interior: null },
        { from: [V(-600, 300, 500), V(-150, 200, 650), V(350, 260, 560)], look: [V(-250, 30, 60), V(0, 60, 100), V(200, 30, 100)], dur: 20, interior: null },
        { from: [V(900, 90, 40), V(560, 40, 20), V(470, 30, 0)], look: [V(400, 20, 0), V(200, 30, 0), V(0, 80, 0)], dur: 14, interior: null },
      ]
    case 'shuttle':
      return [{
        from: [], look: [], dur: 9999, interior: null,
        dynamic: () => {
          const s = sim.shuttle.state
          const look = s.visible ? s.pos.clone().add(V(0, 6, 0)) : V(pad.x, pad.y + 10, pad.z)
          const near = s.visible && (s.phase === 'descent' || s.phase === 'landed' || s.phase === 'liftoff')
          const pos = near ? V(pad.x + 55, pad.y + 14, pad.z + 48) : V(pad.x + 150, 60, pad.z - 160)
          return { pos, look }
        },
      }]
    case 'hangar':
      return [
        { from: [V(-60, 30, 90), V(-150, 16, 60), V(-195, 12, 30)], look: [V(-205, 18, 20), V(-230, 12, 20), V(-280, 10, 20)], dur: 16, interior: null },
        { from: [V(-215, 22, 100), V(-300, 30, 60), V(-320, 20, -60)], look: [V(-270, 6, 20), V(-260, 6, -10), V(-230, 10, 20)], dur: 18, interior: null },
      ]
    case 'command':
      return [
        { from: [V(-24, 108, 10), V(0, 109, 11), V(24, 108, 8)], look: [V(0, 103, 0), V(0, 103, -2), V(-60, 60, -400)], dur: 20, interior: 'command' },
        { from: [V(20, 107.5, -12), V(-20, 107.5, -12)], look: [V(-200, 20, -300), V(300, 20, -300)], dur: 16, interior: 'command' },
      ]
    case 'bunker': {
      const l = INTERIORS.bunker!
      const [x, y, z] = l.origin
      return [
        { from: [V(x - 38, y + 6, z + 24), V(x - 10, y + 4, z + 10), V(x + 24, y + 5, z - 20)], look: [V(x, y + 2, z - 10), V(x - 10, y + 1, z - 20), V(x + 26, y + 2, z + 10)], dur: 22, interior: 'bunker' },
      ]
    }
    case 'march':
      return [{
        from: [], look: [], dur: 9999, interior: null,
        // three set-ups, as in the film: low in front of the column as it comes on, then from behind
        // and above with the temple filling the frame, then at the steps as they go in
        dynamic: () => {
          const t = Math.max(0, sim.march.elapsed(sim.time))
          const head = MARCH.startZ - MARCH.speed * t
          const L = (x: number, y: number, z: number) => { const [wx, wz] = toWorld(x, z); return V(wx, y, wz) }
          if (head > 58) return { pos: L(3.5, 0.9, head - 13), look: L(0, 1.5, head + 4) }
          if (head > 24) return { pos: L(-9, 11, head + 42), look: L(0, 7, head - 20) }
          return { pos: L(15, 2.2, 20), look: L(0, 1.6, Math.max(head, 3) + 4) }
        },
      }]
    case 'destroyer':
      return [{
        from: [], look: [], dur: 9999, interior: null,
        // from the parade ground, looking up past the citadel at the ship on station
        dynamic: () => {
          const d = sim.destroyer.state
          const at = d.visible && d.stretch < 3 ? d.pos : DESTROYER.station
          return { pos: V(330, 16, 470), look: V(at.x, at.y, at.z) }
        },
      }]
    case 'duel':
      return [{
        from: [], look: [], dur: 9999, interior: null,
        // a slow orbit around the fight, a little above head height so the whole pad is in view
        dynamic: (t) => {
          // work the fight's position out here, from the clock: never depend on another component having run
          const duel = duelAt(sim.time, duelScratch)
          const f = duel.focus
          const ang = t * 0.11
          const r = 5 + duel.gap * 0.9 + Math.sin(t * 0.07) * 0.8 // wider when they stand apart
          return { pos: V(f.x + Math.cos(ang) * r, f.y + 1.9 + Math.sin(t * 0.05) * 0.6, f.z + Math.sin(ang) * r), look: V(f.x, f.y, f.z) }
        },
      }]
    case 'agents':
      return [{
        from: [], look: [], dur: 9999, interior: undefined,
        dynamic: (t) => {
          const list = [...actorSystem.actors.values()]
          if (!list.length) {
            const l = INTERIORS.engineering!
            return { pos: V(l.origin[0] - 40, 12, l.origin[2] + 30), look: V(l.origin[0], 5, l.origin[2]) }
          }
          const a = list[Math.floor(t / 12) % list.length]
          const st = useStore.getState()
          if (st.interior !== a.dept) st.enterInterior(a.dept)
          const ang = t * 0.15
          return { pos: a.pos.clone().add(V(Math.cos(ang) * 6, 3.2, Math.sin(ang) * 6)), look: a.pos.clone().add(V(0, 1.3, 0)) }
        },
      }]
  }
}

function Cinematic() {
  const { camera } = useThree()
  const tour = useStore((s) => s.tour) ?? 'flyover'
  const shots = useMemo(() => tourShots(tour), [tour])
  const t = useRef(0)
  const look = useRef(new THREE.Vector3())
  const shotIdx = useRef(-1)
  const cut = useRef(true)
  useEffect(() => { t.current = 0; shotIdx.current = -1; cut.current = true }, [tour])
  useFrame((_, dt) => {
    t.current += Math.min(dt, 0.1)
    const total = shots.reduce((s, x) => s + x.dur, 0)
    let tt = t.current % total
    let i = 0
    while (tt > shots[i].dur) { tt -= shots[i].dur; i++ }
    const s = shots[i]
    if (i !== shotIdx.current) {
      shotIdx.current = i
      if (s.interior !== undefined && useStore.getState().interior !== s.interior) useStore.getState().enterInterior(s.interior)
    }
    if (s.dynamic) {
      const r = s.dynamic(t.current)
      if (camera.position.distanceTo(r.pos) > 30) cut.current = true // the tour changed set-up: cut, don't fly
      if (cut.current) {
        // starting a tour is a cut: go straight to the subject instead of drifting there through the buildings
        cut.current = false
        camera.position.copy(r.pos)
        look.current.copy(r.look)
      }
      camera.position.lerp(r.pos, Math.min(1, dt * 1.5))
      look.current.lerp(r.look, Math.min(1, dt * 3))
      camera.lookAt(look.current)
      return
    }
    const k = tt / s.dur
    const e = k * k * (3 - 2 * k)
    const pc = new THREE.CatmullRomCurve3(s.from)
    camera.position.copy(pc.getPoint(e))
    const lk = Array.isArray(s.look) ? new THREE.CatmullRomCurve3(s.look).getPoint(e) : s.look()
    if (k < 0.02) look.current.copy(lk)
    look.current.lerp(lk, 0.2)
    camera.lookAt(look.current)
  })
  return null
}

// ------------------------------------------------------------------ orbit / tactical
function Orbit() {
  const interior = useStore((s) => s.interior)
  const selection = useStore((s) => s.selection)
  const ctl = useRef<any>(null)
  const { camera } = useThree()
  useEffect(() => {
    const c = ctl.current
    if (!c) return
    if (interior && INTERIORS[interior]) {
      const l = INTERIORS[interior]!
      c.target.set(l.origin[0], l.origin[1] + 1.5, l.origin[2])
      camera.position.set(l.origin[0] - l.w * 0.32, l.origin[1] + l.h * 0.8, l.origin[2] + l.d * 0.4)
    } else if (camera.position.y < 30 || camera.position.length() > 9000 || camera.getWorldDirection(new THREE.Vector3()).y < -0.985) {
      // too low, too far, or still looking straight down from the tactical view: back to the establishing shot
      c.target.set(-40, 20, 20)
      camera.position.set(620, 330, 760)
    }
    c.update()
  }, [interior]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const c = ctl.current
    if (c && !interior && selection?.kind === 'aircraft' && selection.id === 'freighter' && sim.freighter.phase === 'impounded') {
      // the parked freighter is scenery you can walk up to: frame it on its pad
      const p = sim.freighter.state.pos
      c.target.set(p.x, p.y, p.z)
      camera.position.set(p.x + 46, p.y + 20, p.z + 44)
      c.update()
      return
    }
    if (c && !interior && selection?.kind === 'aircraft' && selection.id === 'dump') {
      c.target.set(FUEL_DUMP.x, 6, FUEL_DUMP.z)
      camera.position.set(FUEL_DUMP.x - 78, 34, FUEL_DUMP.z + 62) // from inside the base, the wall behind it
      c.update()
      return
    }
    if (!c || interior || selection?.kind !== 'facility') return
    const f = facilityById[selection.id]
    c.target.set(f.x, f.sy * 0.4, f.z)
    camera.position.set(f.x + f.sx * 1.4 + 60, f.sy * 1.8 + 40, f.z + f.sz * 1.4 + 60)
    c.update()
  }, [selection]) // eslint-disable-line react-hooks/exhaustive-deps
  const l = interior ? INTERIORS[interior] : undefined
  return (
    <OrbitControls ref={ctl} makeDefault enableDamping dampingFactor={0.08}
      minDistance={l ? 2 : 15} maxDistance={l ? Math.max(l.w, l.d) * 0.8 : 7000}
      maxPolarAngle={l ? Math.PI * 0.62 : Math.PI * 0.485} />
  )
}

function Tactical() {
  const { camera } = useThree()
  const ctl = useRef<any>(null)
  useEffect(() => {
    if (useStore.getState().interior) useStore.getState().enterInterior(null)
    camera.position.set(0, 1250, 1)
    if (ctl.current) { ctl.current.target.set(0, 0, 0); ctl.current.update() }
  }, [camera])
  return <MapControls ref={ctl} makeDefault enableRotate={false} screenSpacePanning={false} minDistance={150} maxDistance={2600} />
}

export function CameraRig() {
  const mode = useStore((s) => s.cameraMode)
  switch (mode) {
    case 'firstperson': return <FirstPerson />
    case 'thirdperson': return <ThirdPerson />
    case 'cinematic': return <Cinematic />
    case 'follow': return <Follow />
    case 'tactical': return <Tactical />
    default: return <Orbit />
  }
}

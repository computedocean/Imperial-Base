import { Billboard, Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Kit } from '../world/kit'
import { KitMesh } from '../world/Structures'
import { INTERIORS, type InteriorLayout, type Station } from './layouts'
import { useStore } from '../state/store'
import { HoloTactical } from './HoloTactical'
import { SystemWall } from './SystemWall'
import { InteriorCrew } from './InteriorCrew'

function stationProps(k: Kit, s: Station, ox: number, oy: number, oz: number) {
  const x = ox + s.x
  const z = oz + s.z
  const r = s.rot
  const c = Math.cos(r)
  const sn = Math.sin(r)
  // local (lx, lz) -> world, rotated by station rot
  const P = (lx: number, ly: number, lz: number): [number, number, number] => [x + lx * c + lz * sn, oy + ly, z - lx * sn + lz * c]
  switch (s.type) {
    case 'console':
      k.boxR('dark', [3.2, 0.9, 1.3], P(0, 0.45, -0.6), [0, r, 0], 2)
      k.boxR('black', [3.4, 0.08, 1.4], P(0, 0.94, -0.6), [0, r, 0], 2)
      k.boxR('holo', [1.3, 0.75, 0.04], P(-0.75, 1.5, -1.0), [-0.25, r, 0], 2)
      k.boxR('holo', [1.3, 0.75, 0.04], P(0.75, 1.5, -1.0), [-0.25, r, 0], 2)
      k.boxR('black', [0.7, 0.5, 0.7], P(0, 0.25, 0.7), [0, r, 0], 2)
      k.boxR('black', [0.7, 0.7, 0.12], P(0, 0.85, 1.0), [0, r, 0], 2)
      break
    case 'terminal':
      k.boxR('dark', [1.1, 1.3, 0.7], P(0, 0.65, -0.4), [0, r, 0], 2)
      k.boxR('holo', [1.0, 0.7, 0.04], P(0, 1.65, -0.55), [-0.35, r, 0], 2)
      k.boxR('amber', [0.9, 0.04, 0.04], P(0, 1.31, -0.05), [0, r, 0], 2)
      break
    case 'holotable':
      k.cyl('dark', 3.2, 3.6, 0.9, [x, oy, z], 24)
      k.cyl('black', 3.0, 3.0, 0.08, [x, oy + 0.9, z], 24)
      k.add('holo', new THREE.TorusGeometry(3.05, 0.05, 4, 48), [x, oy + 0.95, z], [Math.PI / 2, 0, 0])
      break
    case 'rack':
      k.boxR('black', [1.2, 2.6, 1.1], P(0, 1.3, 0), [0, r, 0], 2)
      for (let i = 0; i < 6; i++) k.boxR(i % 2 ? 'holo' : 'whiteLight', [0.9, 0.04, 0.02], P(0, 0.4 + i * 0.38, -0.56), [0, r, 0], 2)
      break
    case 'archive':
      k.boxR('dark', [3.4, 2.6, 0.8], P(0, 1.3, 0), [0, r, 0], 2)
      for (let i = 0; i < 4; i++) k.boxR('light', [3.2, 0.05, 0.7], P(0, 0.4 + i * 0.6, 0), [0, r, 0], 2)
      k.boxR('amber', [3.2, 0.04, 0.03], P(0, 2.5, -0.41), [0, r, 0], 2)
      break
    case 'briefing':
      k.cyl('dark', 3.4, 3.4, 0.08, [x, oy + 0.85, z], 24)
      k.cyl('black', 0.6, 0.9, 0.85, [x, oy, z], 12)
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        k.box('black', [0.6, 0.9, 0.6], [x + Math.cos(a) * 4.3, oy, z + Math.sin(a) * 4.3])
      }
      break
    case 'lab':
      k.boxR('light', [3.6, 0.95, 1.4], P(0, 0.475, 0), [0, r, 0], 2)
      k.cyl('glass', 0.3, 0.3, 0.7, P(-1.1, 0.95, 0), 10)
      k.cyl('holo', 0.12, 0.12, 0.5, P(-0.4, 0.95, 0.2), 8)
      k.boxR('dark', [1.0, 0.6, 0.6], P(0.9, 1.25, -0.2), [0, r, 0], 2)
      k.boxR('holo', [0.8, 0.4, 0.03], P(0.9, 1.3, 0.11), [0, r, 0], 2)
      break
    case 'security':
      k.boxR('dark', [6, 0.9, 1.3], P(0, 0.45, -0.6), [0, r, 0], 2)
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) k.boxR('holo', [1.8, 1.0, 0.05], P(-2 + i * 2, 2 + j * 1.1, -2), [0, r, 0], 2)
      break
    case 'lounge':
      break
  }
}

function buildRoom(l: InteriorLayout) {
  const k = new Kit()
  const [ox, oy, oz] = l.origin
  const { w, d, h } = l
  const T = 0.6
  k.box('dark', [w, 0.3, d], [ox, oy - 0.3, oz], 0, 6)
  // walls (with an entry gap on the entry side)
  const [ex, ez] = l.entry
  const wall = (mat: 'hull' | 'glassClear', cx: number, cz: number, sx: number, sz: number) => k.box(mat, [sx, h, sz], [ox + cx, oy, oz + cz], 0, 6)
  const sides: { axis: 'x' | 'z'; at: number; len: number }[] = [
    { axis: 'z', at: -d / 2, len: w }, { axis: 'z', at: d / 2, len: w }, { axis: 'x', at: -w / 2, len: d }, { axis: 'x', at: w / 2, len: d },
  ]
  for (const s of sides) {
    const isEntry = s.axis === 'z' ? Math.abs(ez - s.at) < 4 : Math.abs(ex - s.at) < 4
    const mat = l.windows ? 'glassClear' : 'hull'
    const along = s.axis === 'z' ? ex : ez
    const segs: [number, number][] = isEntry ? [[-s.len / 2, along - 3], [along + 3, s.len / 2]] : [[-s.len / 2, s.len / 2]]
    for (const [a, b] of segs) {
      const c = (a + b) / 2
      const L = b - a
      if (L <= 0.1) continue
      if (s.axis === 'z') wall(mat, c, s.at, L, T)
      else wall(mat, s.at, c, T, L)
    }
    if (isEntry) {
      if (s.axis === 'z') k.box('amber', [6, 0.25, 0.8], [ox + ex, oy + 3.4, oz + s.at])
      else k.box('amber', [0.8, 0.25, 6], [ox + s.at, oy + 3.4, oz + ez])
    }
  }
  // ceiling + light strips + structural ribs
  k.box('dark', [w, 0.4, d], [ox, oy + h, oz], 0, 6)
  for (let zz = -d / 2 + 6; zz < d / 2; zz += 10) {
    k.box('whiteLight', [w - 8, 0.12, 0.6], [ox, oy + h - 0.15, oz + zz])
    k.box('black', [w, 0.8, 0.8], [ox, oy + h - 0.8, oz + zz + 3])
  }
  if (!l.windows) {
    for (let xx = -w / 2 + 8; xx < w / 2 - 4; xx += 12) {
      k.box('dark', [1.6, h, 1.6], [ox + xx, oy, oz - d / 2 + 1.1])
      k.box('dark', [1.6, h, 1.6], [ox + xx, oy, oz + d / 2 - 1.1])
      k.box(l.id === 'security' ? 'red' : 'amber', [0.2, 0.2, 1.2], [ox + xx, oy + h * 0.75, oz - d / 2 + 2])
    }
  } else {
    // command bridge: window mullions, raised walkway, crew pits rim
    for (let xx = -w / 2; xx <= w / 2; xx += 6.2) {
      k.box('black', [0.4, h, 0.8], [ox + xx, oy, oz - d / 2])
      k.box('black', [0.4, h, 0.8], [ox + xx, oy, oz + d / 2])
    }
    k.box('black', [w, 0.6, 0.9], [ox, oy + 1.0, oz - d / 2 + 0.2])
    k.box('dark', [w - 4, 0.25, 4], [ox, oy, oz])
    k.box('stripe', [w - 4, 0.05, 0.2], [ox, oy + 0.26, oz - 2])
    k.box('stripe', [w - 4, 0.05, 0.2], [ox, oy + 0.26, oz + 2])
  }
  // floor guide lines toward the entry
  k.box('holo', [l.id === 'command' ? 0.2 : 0.15, 0.02, 0.15], [ox, oy + 0.01, oz])
  for (const s of l.stations) stationProps(k, s, ox, oy, oz)
  return k
}

function InteriorLights({ l }: { l: InteriorLayout }) {
  const [ox, oy, oz] = l.origin
  const pts = useMemo(() => {
    const out: [number, number, number][] = []
    const nx = l.w > 60 ? 3 : 2
    for (let i = 0; i < nx; i++) out.push([ox - l.w / 2 + ((i + 0.5) * l.w) / nx, oy + l.h - 1.5, oz])
    return out
  }, [l, ox, oy, oz])
  return (
    <group>
      {pts.map((p, i) => <pointLight key={i} position={p} intensity={l.windows ? 200 : 650} distance={l.w * 0.9} decay={2} color={i === 1 ? l.accent : '#dfe8ff'} />)}
      <pointLight position={[ox, oy + 2.5, oz]} intensity={140} distance={20} color="#5cbcff" />
    </group>
  )
}

function ZoneLabels({ l }: { l: InteriorLayout }) {
  const [ox, oy, oz] = l.origin
  return (
    <group>
      {l.zones.map((z) => (
        <Billboard key={z.label} position={[ox + z.x, oy + l.h - 2.6, oz + z.z]}>
          <Text fontSize={0.42} color={l.accent} anchorX="center" outlineWidth={0.02} outlineColor="#000" letterSpacing={0.12}>
            {z.label}
          </Text>
        </Billboard>
      ))}
    </group>
  )
}

/** Holographic rotating projection for non-command holo tables. */
function HoloProjector({ x, y, z }: { x: number; y: number; z: number }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((_, dt) => { if (ref.current) ref.current.rotation.y += dt * 0.4 })
  return (
    <mesh ref={ref} position={[x, y + 2.2, z]}>
      <icosahedronGeometry args={[1.3, 1]} />
      <meshBasicMaterial color="#58c4ff" wireframe transparent opacity={0.55} depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

export function Interior({ id }: { id: keyof typeof INTERIORS }) {
  const l = INTERIORS[id]!
  const build = useMemo(() => () => buildRoom(l), [l])
  const [ox, oy, oz] = l.origin
  return (
    <group name={`interior-${id}`}>
      <KitMesh build={build} />
      <InteriorLights l={l} />
      <ZoneLabels l={l} />
      {l.stations.filter((s) => s.type === 'holotable').map((s, i) =>
        id === 'command' && i === 0
          ? <HoloTactical key={s.id} position={[ox + s.x, oy + 1.0, oz + s.z]} />
          : <HoloProjector key={s.id} x={ox + s.x} y={oy} z={oz + s.z} />)}
      {id === 'bunker' && <SystemWall position={[ox + 26, oy + 1, oz - l.d / 2 + 0.8]} />}
      {id === 'research' && <SystemWall position={[ox - 10, oy + 0.6, oz + l.d / 2 - 0.8]} rotationY={Math.PI} compact />}
    </group>
  )
}

/** Renders the interior the commander is currently inside (only one at a time, for performance). */
export function ActiveInterior() {
  const interior = useStore((s) => s.interior)
  if (!interior || !INTERIORS[interior]) return null
  return <><Interior key={interior} id={interior} /><InteriorCrew /></>
}

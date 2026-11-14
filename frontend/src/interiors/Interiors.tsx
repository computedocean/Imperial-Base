import { Billboard, Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Kit } from '../world/kit'
import { KitMesh } from '../world/Structures'
import type { MatKey } from '../world/materials'
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
  // A part tilted about the station's own left-right axis (positive = the edge facing the operator drops),
  // then turned with the station. Kit's own rotation tilts about the world axis, which is wrong for turned stations.
  const tilted = (mat: MatKey, g: THREE.BufferGeometry, lx: number, ly: number, lz: number, tilt: number) => {
    g.rotateX(tilt)
    k.add(mat, g, P(lx, ly, lz), [0, r, 0])
  }
  // steady pseudo-random pick so every station gets its own pattern of lit controls
  let seed = Math.abs(Math.round(s.x * 7 + s.z * 13)) + s.id.length * 31
  const pick = <T,>(list: T[]) => list[(seed = (seed * 1103515245 + 12345) & 0x7fffffff) % list.length]
  const LIT: MatKey[] = ['red', 'whiteLight', 'whiteLight', 'amber', 'holo', 'black', 'black']
  /**
   * Sloped control deck: a black panel angled towards the operator, covered in rows of small lit keys,
   * with a round scope in the middle. The deck is `width` wide; its centre is at (cx, cy, cz).
   */
  const controlDeck = (width: number, cx: number, cy: number, cz: number, depth = 0.95, tilt = 0.3) => {
    const sn2 = Math.sin(tilt)
    const cs2 = Math.cos(tilt)
    const on = (d: number, lift: number): [number, number] => [cy + lift * cs2 - d * sn2, cz + lift * sn2 + d * cs2]
    tilted('black', new THREE.BoxGeometry(width, 0.08, depth), cx, cy, cz, tilt)
    const rows = [-0.3, -0.12, 0.06, 0.24]
    for (const d of rows) {
      for (let x = -width / 2 + 0.2; x <= width / 2 - 0.2 + 1e-6; x += 0.2) {
        if (Math.abs(x) < 0.42 && d < 0.2) continue // room for the scope
        const mat = pick(LIT)
        const [y, z] = on(d, 0.05)
        tilted(mat, new THREE.BoxGeometry(0.13, 0.025, 0.1), cx + x, y, z, tilt)
      }
    }
    const [sy, sz] = on(-0.1, 0.05)
    tilted('dark', new THREE.CylinderGeometry(0.33, 0.36, 0.05, 20), cx, sy, sz, tilt)
    const [gy, gz] = on(-0.1, 0.085)
    tilted('holo', new THREE.CylinderGeometry(0.27, 0.27, 0.02, 20), cx, gy, gz, tilt)
    tilted('red', new THREE.BoxGeometry(0.5, 0.012, 0.012), cx, gy + 0.012, gz, tilt)
    tilted('red', new THREE.BoxGeometry(0.012, 0.012, 0.5), cx, gy + 0.012, gz, tilt)
  }
  /** Upright indicator bank: a grid of small lights on a vertical face at local z. */
  const lightBank = (cx: number, y0: number, lz: number, cols: number, rowsN: number, dx = 0.16, dy = 0.14) => {
    for (let i = 0; i < cols; i++) for (let j = 0; j < rowsN; j++) {
      const mat = pick(LIT)
      if (mat === 'black') continue
      k.boxR(mat, [0.1, 0.07, 0.03], P(cx + (i - (cols - 1) / 2) * dx, y0 + j * dy, lz), [0, r, 0], 2)
    }
  }
  switch (s.type) {
    case 'console': {
      // Imperial duty console: the operator stands at a sloped key deck under an upright bank of scopes and
      // indicator lights, flanked by two light pylons. No chair: crew stand their watch.
      k.boxR('black', [3.6, 0.2, 1.8], P(0, 0.1, -0.6), [0, r, 0], 2)
      k.boxR('dark', [3.2, 0.8, 1.0], P(0, 0.6, -0.85), [0, r, 0], 2)
      k.boxR('black', [3.0, 0.5, 0.06], P(0, 0.55, -0.33), [0, r, 0], 2)
      k.boxR('amber', [2.6, 0.03, 0.02], P(0, 0.82, -0.29), [0, r, 0], 2)
      controlDeck(3.2, 0, 1.06, -0.5)
      // upright back panel
      k.boxR('dark', [3.2, 1.15, 0.3], P(0, 1.6, -1.3), [0, r, 0], 2)
      k.boxR('black', [3.3, 0.12, 0.42], P(0, 2.22, -1.26), [0, r, 0], 2)
      for (const sx of [-1, 1]) {
        k.boxR('black', [0.95, 0.62, 0.04], P(sx * 0.98, 1.68, -1.14), [0, r, 0], 2)
        k.boxR('holo', [0.85, 0.52, 0.03], P(sx * 0.98, 1.68, -1.12), [0, r, 0], 2)
        // light pylons
        k.boxR('black', [0.22, 2.3, 0.55], P(sx * 1.75, 1.15, -1.2), [0, r, 0], 2)
        k.boxR('whiteLight', [0.05, 1.3, 0.03], P(sx * 1.75, 1.35, -0.91), [0, r, 0], 2)
        k.boxR('red', [0.12, 0.08, 0.03], P(sx * 1.75, 2.15, -0.91), [0, r, 0], 2)
      }
      lightBank(0, 1.42, -1.13, 5, 5)
      k.boxR('whiteLight', [2.9, 0.04, 0.03], P(0, 1.2, -1.13), [0, r, 0], 2)
      break
    }
    case 'terminal': {
      // data terminal: a slim black column with a round scope, a short key shelf and a light ladder
      k.boxR('black', [1.3, 0.16, 1.0], P(0, 0.08, -0.4), [0, r, 0], 2)
      k.boxR('dark', [1.1, 2.0, 0.6], P(0, 1.16, -0.5), [0, r, 0], 2)
      k.boxR('black', [1.2, 0.1, 0.7], P(0, 2.2, -0.48), [0, r, 0], 2)
      controlDeck(1.0, 0, 1.05, -0.02, 0.5, 0.45)
      tilted('black', new THREE.CylinderGeometry(0.36, 0.36, 0.05, 20), 0, 1.72, -0.19, Math.PI / 2)
      tilted('holo', new THREE.CylinderGeometry(0.3, 0.3, 0.02, 20), 0, 1.72, -0.16, Math.PI / 2)
      k.boxR('amber', [0.9, 0.04, 0.03], P(0, 1.3, -0.19), [0, r, 0], 2)
      lightBank(0, 0.4, -0.19, 4, 4, 0.18, 0.13)
      break
    }
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
      // watch desk: a long key deck under a wall of surveillance scopes
      k.boxR('black', [6.4, 0.2, 1.8], P(0, 0.1, -0.6), [0, r, 0], 2)
      k.boxR('dark', [6, 0.8, 1.0], P(0, 0.6, -0.85), [0, r, 0], 2)
      controlDeck(6, 0, 1.06, -0.5)
      k.boxR('black', [6.2, 2.6, 0.2], P(0, 2.5, -2.12), [0, r, 0], 2)
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) k.boxR('holo', [1.8, 1.0, 0.05], P(-2 + i * 2, 2 + j * 1.1, -2), [0, r, 0], 2)
      k.boxR('red', [6.0, 0.05, 0.03], P(0, 1.3, -2.0), [0, r, 0], 2)
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

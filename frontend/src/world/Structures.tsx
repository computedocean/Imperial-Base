import { useMemo } from 'react'
import * as THREE from 'three'
import { Hero } from './HeroModels'
import { Kit, materialFor } from './kit'
import { FACILITIES, GATES, PADS, PERIMETER_RADIUS, WALL_HEIGHT, facilityById, perimeterVertices } from './layout'
import { padTexture } from './textures'

type V3 = [number, number, number]

/** Render the merged output of a kit build. */
export function KitMesh({ build, castShadow = true, name }: { build: () => Kit; castShadow?: boolean; name?: string }) {
  const parts = useMemo(() => build().build(), []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group name={name}>
      {parts.map((p) => {
        const m = materialFor(p.mat)
        const emissive = (m as THREE.MeshStandardMaterial).toneMapped === false || p.mat === 'windows'
        return <mesh key={p.mat} geometry={p.geometry} material={m} castShadow={castShadow && !emissive} receiveShadow={!emissive} />
      })}
    </group>
  )
}

/** Horizontal window band wrapped around a w×d block at height y. */
function windowBand(k: Kit, cx: number, cz: number, w: number, d: number, y: number, h: number, inset = 0.25) {
  k.box('windows', [w + inset, h, 0.4], [cx, y, cz + d / 2], 0, 8)
  k.box('windows', [w + inset, h, 0.4], [cx, y, cz - d / 2], 0, 8)
  k.box('windows', [0.4, h, d + inset], [cx + w / 2, y, cz], 0, 8)
  k.box('windows', [0.4, h, d + inset], [cx - w / 2, y, cz], 0, 8)
}

function accentStrip(k: Kit, mat: 'red' | 'amber' | 'holo' | 'whiteLight', cx: number, cz: number, w: number, d: number, y: number) {
  k.box(mat, [w + 0.3, 0.35, 0.3], [cx, y, cz + d / 2], 0)
  k.box(mat, [w + 0.3, 0.35, 0.3], [cx, y, cz - d / 2], 0)
  k.box(mat, [0.3, 0.35, d + 0.3], [cx + w / 2, y, cz], 0)
  k.box(mat, [0.3, 0.35, d + 0.3], [cx - w / 2, y, cz], 0)
}

// ------------------------------------------------------------------ COMMAND CITADEL
function buildCitadel() {
  const f = facilityById.command
  const k = new Kit()
  const { x, z } = f
  // three-tier podium
  k.taper('hull', [96, 96], [86, 86], 14, [x, 0, z])
  windowBand(k, x, z, 91, 91, 5.5, 2.6)
  accentStrip(k, 'amber', x, z, 86.4, 86.4, 13.8)
  k.taper('dark', [72, 72], [62, 62], 18, [x, 14, z])
  windowBand(k, x, z, 67, 67, 22, 3)
  // corner buttresses
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    k.taper('dark', [14, 14], [6, 6], 26, [x + sx * 44, 0, z + sz * 44])
    k.box('red', [0.8, 0.8, 0.8], [x + sx * 44, 26, z + sz * 44])
  }
  // tower shaft
  k.taper('hull', [34, 30], [22, 19], 69.5, [x, 32, z])
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2
    const ox = Math.sin(a) * 15.6
    const oz = Math.cos(a) * 14.1
    k.boxR('windows', i % 2 ? [0.5, 60, 2.2] : [2.2, 60, 0.5], [x + ox * 0.86, 66, z + oz * 0.86], [0, 0, 0])
  }
  // main entrance (south +Z face)
  k.box('black', [20, 10, 3], [x, 0, z + 48])
  k.box('dark', [26, 3, 6], [x, 10, z + 49])
  k.box('amber', [20, 0.4, 0.4], [x, 9.8, z + 50.2])
  k.box('dark', [3, 13, 6], [x - 13, 0, z + 49])
  k.box('dark', [3, 13, 6], [x + 13, 0, z + 49])
  // steps / plaza
  k.box('concrete', [40, 0.6, 14], [x, 0, z + 56], 0, 12)
  return k
}

function buildCitadelCrown() {
  const f = facilityById.command
  const k = new Kit()
  const { x, z } = f
  // command bridge (T-shaped crown) + observation deck
  k.box('dark', [70, 4, 20], [x, 102, z])
  k.box('hull', [66, 9, 18], [x, 106, z])
  k.box('hull', [18, 9, 44], [x, 106, z])
  k.box('glass', [66.6, 3.2, 18.6], [x, 108.6, z])
  k.box('windows', [66.8, 1.4, 18.8], [x, 109.6, z])
  k.box('glass', [18.6, 3.2, 44.6], [x, 108.6, z])
  k.box('dark', [60, 2, 16], [x, 115, z])
  k.taper('dark', [16, 16], [8, 8], 6, [x, 117, z])
  // antennae
  k.cyl('black', 0.5, 0.9, 40, [x + 6, 123, z], 8)
  k.cyl('black', 0.4, 0.7, 30, [x - 7, 123, z + 3], 8)
  k.box('red', [1.4, 1.4, 1.4], [x + 6, 163, z])
  k.box('red', [1.2, 1.2, 1.2], [x - 7, 153, z + 3])
  k.box('red', [1, 1, 1], [x + 33.5, 110, z])
  k.box('red', [1, 1, 1], [x - 33.5, 110, z])
  return k
}

// ------------------------------------------------------------------ HANGAR
export const HANGAR = { x0: -335, x1: -205, z0: -85, z1: 125, h: 52, doorZ0: -40, doorZ1: 80, doorH: 38 }

/** Outer shell only (walls, door portal, roof, buttresses) — replaced by the Blender hero model when available. */
function buildHangarShell() {
  const k = new Kit()
  const H = HANGAR
  const cx = (H.x0 + H.x1) / 2
  const cz = (H.z0 + H.z1) / 2
  const T = 3
  // walls
  k.box('hull', [T, H.h, H.z1 - H.z0], [H.x0, 0, cz]) // back (west)
  k.box('hull', [H.x1 - H.x0, H.h, T], [cx, 0, H.z0]) // south
  k.box('hull', [H.x1 - H.x0, H.h, T], [cx, 0, H.z1]) // north
  // east wall with the great door opening
  k.box('hull', [T * 2, H.h, H.doorZ0 - H.z0], [H.x1, 0, (H.z0 + H.doorZ0) / 2])
  k.box('hull', [T * 2, H.h, H.z1 - H.doorZ1], [H.x1, 0, (H.doorZ1 + H.z1) / 2])
  k.box('dark', [T * 2.5, H.h - H.doorH, H.doorZ1 - H.doorZ0 + 2], [H.x1, H.doorH, (H.doorZ0 + H.doorZ1) / 2])
  // door frame + warning lights
  k.box('stripe', [T * 2.6, 1.2, H.doorZ1 - H.doorZ0], [H.x1 + 0.2, H.doorH - 1.2, (H.doorZ0 + H.doorZ1) / 2])
  for (let zz = H.doorZ0; zz <= H.doorZ1; zz += 12) k.box('amber', [0.6, 0.6, 1.4], [H.x1 + T + 0.4, H.doorH + 1.5, zz])
  k.box('black', [T * 2.4, H.doorH, 2.5], [H.x1, 0, H.doorZ0 - 1.25])
  k.box('black', [T * 2.4, H.doorH, 2.5], [H.x1, 0, H.doorZ1 + 1.25])
  // roof + raised spine
  k.box('dark', [H.x1 - H.x0 + 4, 3, H.z1 - H.z0 + 4], [cx, H.h, cz])
  k.taper('hull', [40, H.z1 - H.z0 - 10], [22, H.z1 - H.z0 - 20], 9, [cx, H.h + 3, cz])
  for (let zz = H.z0 + 20; zz < H.z1; zz += 30) k.box('black', [10, 2, 6], [cx - 40, H.h + 3, zz])
  // external buttress fins (north & south walls)
  for (let xx = H.x0 + 10; xx < H.x1 - 5; xx += 24) {
    k.taper('dark', [6, 8], [3, 3], H.h - 4, [xx, 0, H.z0 - 4])
    k.taper('dark', [6, 8], [3, 3], H.h - 4, [xx, 0, H.z1 + 4])
  }
  return k
}

/** Floor + interior fit-out (always procedural: walkable bays, racks, gantries). */
function buildHangar() {
  const k = new Kit()
  const H = HANGAR
  const cx = (H.x0 + H.x1) / 2
  const cz = (H.z0 + H.z1) / 2
  const T = 3
  // floor
  k.box('concrete', [H.x1 - H.x0, 0.3, H.z1 - H.z0], [cx, 0, cz], 0, 16)
  // interior: gantry beams, ceiling lights, fuel tanks, crates
  for (let zz = H.z0 + 15; zz < H.z1; zz += 22) {
    k.box('black', [H.x1 - H.x0 - 6, 2.2, 1.6], [cx, H.h - 6, zz])
    k.box('whiteLight', [H.x1 - H.x0 - 20, 0.3, 0.8], [cx, H.h - 6.4, zz])
  }
  for (let i = 0; i < 4; i++) {
    k.cyl('dark', 3, 3, 14, [H.x0 + 8, 0, H.z0 + 30 + i * 14], 16)
    k.box('stripe', [6.4, 0.6, 6.4], [H.x0 + 8, 10, H.z0 + 30 + i * 14])
  }
  // maintenance bay walkways (mezzanine along back wall)
  k.box('dark', [12, 1, H.z1 - H.z0 - 10], [H.x0 + 9, 14, cz])
  k.box('black', [0.4, 1.4, H.z1 - H.z0 - 10], [H.x0 + 15, 15, cz])
  // TIE hanging racks (ceiling rails over the parked fighters)
  for (let i = 0; i < 6; i++) k.box('black', [14, 1.2, 1.2], [H.x0 + 45 + (i % 3) * 26, H.h - 10, H.z0 + 40 + Math.floor(i / 3) * 70])
  // crates / service equipment
  const crates: V3[] = [[-320, 0, 100], [-316, 0, 106], [-310, 0, 100], [-230, 0, -70], [-238, 0, -74], [-226, 0, 110]]
  crates.forEach((p, i) => k.box(i % 2 ? 'rust' : 'dark', [5, 3 + (i % 3), 5], p))
  // floor markings (bay outlines)
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      const bx = H.x0 + 45 + i * 26
      const bz = H.z0 + 40 + j * 70
      k.box('stripe', [18, 0.05, 0.5], [bx, 0.3, bz - 9])
      k.box('stripe', [18, 0.05, 0.5], [bx, 0.3, bz + 9])
    }
  }
  return k
}

// ------------------------------------------------------------------ landing platform
function buildLanding() {
  const k = new Kit()
  const p = PADS[0]
  const oct = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8
    return [Math.cos(a) * p.radius, Math.sin(a) * p.radius] as [number, number]
  })
  k.prism('dark', oct, 1.6, [p.x, p.y - 1.6, p.z])
  k.prism('hull', oct.map(([a, b]) => [a * 0.82, b * 0.82] as [number, number]), 2.5, [p.x, p.y - 4.1, p.z])
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    k.taper('dark', [5, 5], [3, 3], p.y - 4.1, [p.x + Math.cos(a) * 18, 0, p.z + Math.sin(a) * 18])
  }
  oct.forEach(([a, b], i) => {
    const [c, d] = oct[(i + 1) % 8]
    k.box('amber', [0.7, 0.4, 0.7], [p.x + a * 0.98, p.y, p.z + b * 0.98])
    k.box('whiteLight', [0.4, 0.25, 0.4], [p.x + ((a + c) / 2) * 0.97, p.y, p.z + ((b + d) / 2) * 0.97])
  })
  // access ramp down to the hangar apron (west)
  const len = 30
  const ang = Math.atan2(p.y, len)
  k.boxR('concrete', [len / Math.cos(ang), 0.8, 10], [p.x - p.radius * 0.92 - len / 2 + 2, p.y / 2 - 0.2, p.z], [0, 0, -ang], 10)
  // personnel stair tower (east)
  k.box('dark', [6, p.y + 3, 6], [p.x + p.radius + 2, 0, p.z - 12])
  k.box('glass', [6.2, 2.5, 6.2], [p.x + p.radius + 2, p.y + 0.3, p.z - 12])
  // secondary pads
  for (const s of PADS.slice(1)) {
    k.cyl('dark', s.radius, s.radius + 1.5, s.y, [s.x, 0, s.z], 32)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      k.box('amber', [0.5, 0.3, 0.5], [s.x + Math.cos(a) * s.radius, s.y, s.z + Math.sin(a) * s.radius])
    }
  }
  return k
}

function PadMarkings() {
  const tex = useMemo(() => padTexture(), [])
  return (
    <group>
      {PADS.map((p) => (
        <mesh key={p.id} position={[p.x, p.y + 0.03, p.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <circleGeometry args={[p.radius * 0.96, 48]} />
          <meshStandardMaterial map={tex} roughness={0.8} metalness={0.2} polygonOffset polygonOffsetFactor={-2} />
        </mesh>
      ))}
    </group>
  )
}

// ------------------------------------------------------------------ divisions
function buildIntelligence() {
  const f = facilityById.intelligence
  const k = new Kit()
  k.taper('hull', [f.sx, f.sz], [f.sx * 0.78, f.sz * 0.72], 24, [f.x, 0, f.z])
  windowBand(k, f.x, f.z, f.sx * 0.93, f.sz * 0.91, 6, 2.4)
  windowBand(k, f.x, f.z, f.sx * 0.86, f.sz * 0.82, 14, 2.4)
  k.box('dark', [50, 10, 38], [f.x, 24, f.z])
  windowBand(k, f.x, f.z, 50, 38, 28, 2.2)
  accentStrip(k, 'holo', f.x, f.z, 50.2, 38.2, 33.8)
  // sensor tower + dish array
  k.cyl('dark', 2.4, 3.4, 30, [f.x + 12, 34, f.z], 12)
  k.sphere('light', 2.6, [f.x + 12, 66, f.z], 14)
  for (let i = 0; i < 3; i++) {
    const g = new THREE.SphereGeometry(7, 20, 8, 0, Math.PI * 2, 0, Math.PI / 3.2)
    k.add('light', g, [f.x - 14 + i * 9, 38, f.z - 10 + i * 4], [-0.9, 0.6 * i, 0])
    k.cyl('black', 0.5, 0.8, 4, [f.x - 14 + i * 9, 34, f.z - 10 + i * 4], 6)
  }
  for (let i = 0; i < 6; i++) k.cyl('black', 0.25, 0.4, 14 + (i % 3) * 4, [f.x - 20 + i * 4, 34, f.z + 15], 6)
  k.box('red', [0.9, 0.9, 0.9], [f.x + 12, 69, f.z])
  // entrance (west face)
  k.box('black', [3, 8, 14], [f.x - f.sx / 2 - 1, 0, f.z])
  k.box('holo', [0.3, 0.3, 14], [f.x - f.sx / 2 - 2.6, 8.2, f.z])
  return k
}

function buildEngineering() {
  const f = facilityById.engineering
  const k = new Kit()
  k.box('hull', [f.sx, 22, f.sz], [f.x, 0, f.z])
  windowBand(k, f.x, f.z, f.sx, f.sz, 5, 2.6)
  windowBand(k, f.x, f.z, f.sx, f.sz, 12, 2.6)
  accentStrip(k, 'amber', f.x, f.z, f.sx, f.sz, 21.8)
  // ribbed side fins
  for (let xx = f.x - f.sx / 2 + 6; xx < f.x + f.sx / 2; xx += 9) {
    k.box('dark', [1.6, 20, 2.2], [xx, 0, f.z + f.sz / 2 + 1])
    k.box('dark', [1.6, 20, 2.2], [xx, 0, f.z - f.sz / 2 - 1])
  }
  // upper deck + roof plant
  k.box('dark', [f.sx * 0.6, 8, f.sz * 0.55], [f.x + 8, 22, f.z])
  windowBand(k, f.x + 8, f.z, f.sx * 0.6, f.sz * 0.55, 25, 2.4)
  for (let i = 0; i < 4; i++) {
    k.cyl('light', 4, 4, 5, [f.x - 38 + (i % 2) * 12, 22, f.z - 20 + Math.floor(i / 2) * 40], 16)
    k.cyl('black', 3.4, 3.4, 0.6, [f.x - 38 + (i % 2) * 12, 27, f.z - 20 + Math.floor(i / 2) * 40], 16)
  }
  k.cyl('dark', 1.6, 2, 18, [f.x + 40, 22, f.z + 30], 10)
  k.cyl('dark', 1.6, 2, 15, [f.x + 44, 22, f.z + 26], 10)
  k.box('red', [0.8, 0.8, 0.8], [f.x + 40, 40.2, f.z + 30])
  // entrance (west)
  k.box('black', [3, 8, 16], [f.x - f.sx / 2 - 1, 0, f.z])
  k.box('amber', [0.3, 0.3, 16], [f.x - f.sx / 2 - 2.6, 8.2, f.z])
  return k
}

function hexOutline(w: number, d: number): [number, number][] {
  const c = Math.min(w, d) * 0.28
  return [[-w / 2 + c, -d / 2], [w / 2 - c, -d / 2], [w / 2, 0], [w / 2 - c, d / 2], [-w / 2 + c, d / 2], [-w / 2, 0]]
}

function buildOperations() {
  const f = facilityById.operations
  const k = new Kit()
  k.prism('hull', hexOutline(f.sx, f.sz), 18, [f.x, 0, f.z], 0.6)
  k.prism('windows', hexOutline(f.sx + 0.6, f.sz + 0.6), 2.6, [f.x, 6, f.z])
  k.prism('windows', hexOutline(f.sx + 0.6, f.sz + 0.6), 2.6, [f.x, 12, f.z])
  {
    const o = hexOutline(f.sx + 0.8, f.sz + 0.8)
    o.forEach(([ax, az], i) => {
      const [bx, bz] = o[(i + 1) % o.length]
      const L = Math.hypot(bx - ax, bz - az)
      k.box('red', [L, 0.35, 0.3], [f.x + (ax + bx) / 2, 18, f.z + (az + bz) / 2], -Math.atan2(bz - az, bx - ax))
    })
  }
  k.cyl('dark', 12, 14, 10, [f.x, 18, f.z], 24)
  k.cyl('glass', 10, 10, 3, [f.x, 28, f.z], 24)
  const torus = new THREE.TorusGeometry(9, 0.35, 6, 48)
  k.add('holo', torus, [f.x, 33, f.z], [Math.PI / 2, 0, 0])
  k.add('holo', new THREE.TorusGeometry(6, 0.25, 6, 40), [f.x, 35.5, f.z], [Math.PI / 2, 0, 0])
  // entrance (south face, toward the hub)
  k.box('black', [16, 8, 3], [f.x, 0, f.z - f.sz / 2 - 1])
  k.box('red', [16, 0.3, 0.3], [f.x, 8.2, f.z - f.sz / 2 - 2.6])
  return k
}

function buildResearch() {
  const f = facilityById.research
  const k = new Kit()
  k.box('dark', [f.sx, 6, f.sz], [f.x, 0, f.z])
  windowBand(k, f.x, f.z, f.sx, f.sz, 2, 2)
  const domes: [number, number, number][] = [[-14, 6, 19], [18, -10, 15], [16, 18, 12]]
  for (const [dx, dz, r] of domes) {
    k.sphere('light', r, [f.x + dx, 6, f.z + dz], 28, true)
    k.add('holo', new THREE.TorusGeometry(r + 0.2, 0.3, 6, 48), [f.x + dx, 6.6, f.z + dz], [Math.PI / 2, 0, 0])
    k.cyl('glass', r * 0.25, r * 0.25, 2, [f.x + dx, 6 + r - 0.8, f.z + dz], 12)
  }
  k.boxR('hull', [24, 4, 4], [f.x + 2, 9, f.z - 2], [0, -0.5, 0])
  k.boxR('hull', [22, 4, 4], [f.x + 1, 9, f.z + 13], [0, 0.4, 0])
  // entrance (north face)
  k.box('black', [14, 6, 3], [f.x, 0, f.z + f.sz / 2 + 1])
  k.box('holo', [14, 0.3, 0.3], [f.x, 6.2, f.z + f.sz / 2 + 2.6])
  return k
}

function buildSecurity() {
  const f = facilityById.security
  const k = new Kit()
  k.taper('dark', [f.sx, f.sz], [f.sx * 0.78, f.sz * 0.78], 16, [f.x, 0, f.z])
  k.box('hull', [30, 8, 30], [f.x, 16, f.z])
  windowBand(k, f.x, f.z, 30, 30, 19, 1.6)
  accentStrip(k, 'red', f.x, f.z, 44.4, 44.4, 15.9)
  // roof turret
  k.cyl('dark', 5, 6, 3, [f.x, 24, f.z], 16)
  k.boxR('black', [1, 1, 14], [f.x - 1.4, 28.5, f.z + 6], [-0.25, 0, 0])
  k.boxR('black', [1, 1, 14], [f.x + 1.4, 28.5, f.z + 6], [-0.25, 0, 0])
  k.box('hull', [6, 3, 6], [f.x, 27, f.z])
  k.box('red', [0.8, 0.8, 0.8], [f.x + 12, 24.4, f.z + 12])
  k.box('red', [0.8, 0.8, 0.8], [f.x - 12, 24.4, f.z - 12])
  // blast walls + entrance (west)
  k.box('concrete', [2, 4, 30], [f.x - f.sx / 2 - 10, 0, f.z], 0, 6)
  k.box('black', [3, 7, 10], [f.x - f.sx / 2 - 1, 0, f.z])
  return k
}

function buildBunker() {
  const f = facilityById.bunker
  const k = new Kit()
  k.taper('dark', [f.sx, f.sz], [f.sx * 0.8, f.sz * 0.7], 7, [f.x, 0, f.z])
  // descending ramp into the ground (north side)
  k.box('black', [14, 7, 4], [f.x, 0, f.z + f.sz / 2 - 1])
  k.box('stripe', [14.4, 0.6, 0.6], [f.x, 7, f.z + f.sz / 2 + 1])
  k.box('concrete', [3, 3, 18], [f.x - 9, 0, f.z + f.sz / 2 + 8], 0, 6)
  k.box('concrete', [3, 3, 18], [f.x + 9, 0, f.z + f.sz / 2 + 8], 0, 6)
  // ventilation stacks + radiator fins (server heat)
  for (let i = 0; i < 6; i++) {
    const vx = f.x - 18 + i * 7
    k.cyl('hull', 1.6, 2, 5 + (i % 2) * 2, [vx, 7, f.z - 8], 12)
    k.cyl('black', 1.3, 1.3, 0.4, [vx, 12 + (i % 2) * 2, f.z - 8], 12)
  }
  for (let i = 0; i < 10; i++) k.box('light', [0.4, 4, 10], [f.x - 12 + i * 2.6, 7, f.z + 4])
  k.box('amber', [0.8, 0.8, 0.8], [f.x - f.sx * 0.4, 7.2, f.z + f.sz * 0.35])
  k.box('amber', [0.8, 0.8, 0.8], [f.x + f.sx * 0.4, 7.2, f.z + f.sz * 0.35])
  return k
}

function buildQuarters() {
  const f = facilityById.quarters
  const k = new Kit()
  k.box('light', [f.sx, 14, f.sz], [f.x, 0, f.z])
  for (let y = 2; y < 13; y += 4) windowBand(k, f.x, f.z, f.sx, f.sz, y, 1.8)
  k.box('hull', [f.sx * 0.7, 10, f.sz * 0.6], [f.x - 10, 14, f.z + 4])
  for (let y = 16; y < 23; y += 4) windowBand(k, f.x - 10, f.z + 4, f.sx * 0.7, f.sz * 0.6, y, 1.6)
  // medical wing
  k.box('light', [26, 10, 24], [f.x + 50, 0, f.z - 22])
  k.box('whiteLight', [26.4, 0.35, 0.3], [f.x + 50, 10, f.z - 34])
  k.box('black', [12, 5, 3], [f.x, 0, f.z - f.sz / 2 - 1])
  return k
}

function buildTransport() {
  const f = facilityById.transport
  const k = new Kit()
  k.box('hull', [f.sx, 14, f.sz], [f.x, 0, f.z])
  for (let i = 0; i < 5; i++) {
    k.box('black', [13, 10, 1], [f.x - 36 + i * 18, 0, f.z - f.sz / 2 - 0.2])
    k.box('stripe', [13.4, 0.6, 0.8], [f.x - 36 + i * 18, 10, f.z - f.sz / 2 - 0.4])
  }
  accentStrip(k, 'amber', f.x, f.z, f.sx, f.sz, 13.9)
  // crane gantry over the cargo yard
  k.box('dark', [1.6, 18, 1.6], [f.x - 30, 0, f.z - 60])
  k.box('dark', [1.6, 18, 1.6], [f.x + 30, 0, f.z - 60])
  k.box('stripe', [62, 1.6, 2], [f.x, 18, f.z - 60])
  // cargo containers
  for (let i = 0; i < 14; i++) {
    const cx = f.x - 28 + (i % 7) * 9
    const cz = f.z - 52 - Math.floor(i / 7) * 14 + ((i * 7) % 3)
    k.box(i % 3 === 0 ? 'rust' : i % 3 === 1 ? 'dark' : 'light', [7, 3.2, 3.2], [cx, (i % 4 === 0 ? 3.2 : 0), cz])
  }
  return k
}

// ------------------------------------------------------------------ perimeter
function buildPerimeter() {
  const k = new Kit()
  const v = perimeterVertices()
  const gateHalf = 18
  for (let i = 0; i < 8; i++) {
    const [ax, az] = v[i]
    const [bx, bz] = v[(i + 1) % 8]
    const mx = (ax + bx) / 2
    const mz = (az + bz) / 2
    const len = Math.hypot(bx - ax, bz - az)
    const rot = -Math.atan2(bz - az, bx - ax)
    const hasGate = GATES.some((g) => Math.hypot(g.x - mx, g.z - mz) < 30)
    const pieces: [number, number][] = hasGate ? [[-len / 2, -gateHalf], [gateHalf, len / 2]] : [[-len / 2, len / 2]]
    for (const [s0, s1] of pieces) {
      const c = (s0 + s1) / 2
      const L = s1 - s0
      const px = mx + Math.cos(-rot) * c
      const pz = mz + Math.sin(-rot) * c
      k.box('dark', [L, WALL_HEIGHT, 5], [px, 0, pz], rot)
      k.box('hull', [L, 1.6, 6.4], [px, WALL_HEIGHT, pz], rot)
      // inner walkway rail
      const ix = px - Math.cos(-rot + Math.PI / 2) * 2.8
      const iz = pz - Math.sin(-rot + Math.PI / 2) * 2.8
      k.box('black', [L, 1.2, 0.3], [ix, WALL_HEIGHT + 1.6, iz], rot)
    }
    // wall buttresses every 40 m
    for (let s = -len / 2 + 20; s < len / 2 - 10; s += 40) {
      if (hasGate && Math.abs(s) < gateHalf + 6) continue
      const px = mx + Math.cos(-rot) * s
      const pz = mz + Math.sin(-rot) * s
      const ox = Math.cos(-rot - Math.PI / 2) * 3.5
      const oz = Math.sin(-rot - Math.PI / 2) * 3.5
      k.taper('dark', [4, 4], [2, 2.5], WALL_HEIGHT - 1, [px - ox, 0, pz - oz], rot)
    }
  }
  // corner guard towers
  for (const [x, z] of v) {
    k.taper('dark', [12, 12], [8, 8], 30, [x, 0, z], Math.atan2(z, x))
    k.box('hull', [12, 5, 12], [x, 30, z], Math.atan2(z, x))
    k.box('windows', [12.3, 1.6, 12.3], [x, 31.5, z], Math.atan2(z, x))
    k.box('dark', [13, 1, 13], [x, 35, z], Math.atan2(z, x))
    k.cyl('black', 0.25, 0.35, 8, [x, 36, z], 6)
    k.box('red', [0.9, 0.9, 0.9], [x, 44, z])
  }
  // gates
  for (const g of GATES) {
    const rot = g.rotY
    const ux = Math.cos(rot)
    const uz = -Math.sin(rot)
    for (const s of [-1, 1]) {
      const px = g.x + ux * (gateHalf + 4) * s
      const pz = g.z + uz * (gateHalf + 4) * s
      k.taper('hull', [10, 10], [8, 8], 26, [px, 0, pz], rot)
      k.box('red', [0.8, 0.8, 0.8], [px, 26.2, pz])
    }
    k.box('dark', [gateHalf * 2 + 16, 6, 8], [g.x, 22, g.z], rot)
    k.box('amber', [gateHalf * 2, 0.4, 0.4], [g.x - uz * 4.3, 21.8, g.z + ux * 4.3], rot)
    // checkpoint booth beside the road, just inside the gate (the boom barrier is animated in vehicles/GateBooms)
    const r0 = Math.hypot(g.x, g.z)
    const nx = -g.x / r0
    const nz = -g.z / r0
    k.box('light', [5, 4, 5], [g.x + nx * 12 + ux * 14, 0, g.z + nz * 12 + uz * 14], rot)
  }
  // anti-air turret emplacements just inside the wall
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8 + 0.22
    const r = PERIMETER_RADIUS - 30
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    k.cyl('dark', 5, 6.5, 3, [x, 0, z], 12)
    k.cyl('hull', 3, 3.4, 3, [x, 3, z], 12)
    k.boxR('black', [0.7, 0.7, 9], [x - 0.8, 7.5, z + 3], [-0.6, 0, 0])
    k.boxR('black', [0.7, 0.7, 9], [x + 0.8, 7.5, z + 3], [-0.6, 0, 0])
  }
  return k
}

/** Concrete base slab (octagon) under the whole installation. */
function buildSlab() {
  const k = new Kit()
  const oct = perimeterVertices(PERIMETER_RADIUS + 6)
  k.prism('concrete', oct, 0.05, [0, -0.02, 0])
  return k
}

export function Structures({ hidden }: { hidden?: string | null }) {
  const sealed = !!hidden && hidden !== 'command' && hidden !== 'hangar'
  return (
    <group name="structures" visible={!sealed}>
      {/* ground slab: rendered by world/Apron.tsx (textured ferrocrete) */}
      <Hero name="citadel" group="command" fallback={<KitMesh build={buildCitadel} name="command" />} />
      <group visible={hidden !== 'command'}>
        <Hero name="citadel_crown" group="command-crown" fallback={<KitMesh build={buildCitadelCrown} name="command-crown" />} />
      </group>
      <KitMesh build={buildHangar} name="hangar" />
      <Hero name="hangar" group="hangar-shell" fallback={<KitMesh build={buildHangarShell} name="hangar-shell" />} />
      <KitMesh build={buildLanding} name="landing" />
      <PadMarkings />
      <KitMesh build={buildIntelligence} name="intelligence" />
      <KitMesh build={buildEngineering} name="engineering" />
      <KitMesh build={buildOperations} name="operations" />
      <KitMesh build={buildResearch} name="research" />
      <KitMesh build={buildSecurity} name="security" />
      <KitMesh build={buildBunker} name="bunker" />
      <KitMesh build={buildQuarters} name="quarters" />
      <KitMesh build={buildTransport} name="transport" />
      <KitMesh build={buildPerimeter} name="perimeter" />
    </group>
  )
}

export { FACILITIES }

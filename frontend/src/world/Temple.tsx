/**
 * The Temple — original interpretation of the great ziggurat of the old order: a square stone podium,
 * two stepped tiers, a tall central spire and four corner spires, with a pillared entrance and broad
 * low steps on its east face. It stands in the north-west corner of the base.
 *
 * Built in the march's local frame (see marchPlan.ts): the door is at the origin, +Z points out of
 * the door across the plaza, the building extends to -Z. All parts are merged into one mesh per
 * material, with box-projected UVs so the stone courses run at the same scale on every face.
 */
import { Billboard, Text } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import { GeoBatch, type MatKey } from '../aircraft/models/materials'
import { MARCH_FRAME } from '../personnel/marchPlan'
import { useStore } from '../state/store'
import { TEMPLE } from './layout'
import { stoneTexture } from './surface'

const S = TEMPLE.size
const C = -S / 2 // centre of the building along local Z

// material slots (GeoBatch keys reused as names): stone, shadowed stone, bronze trim, paving, void, lamplight
const STONE: MatKey = 'hull', SHADE: MatKey = 'gun', TRIM: MatKey = 'stripe', PAVE: MatKey = 'xwhite', VOID: MatKey = 'dark', LAMP: MatKey = 'navRed'

type Parts = Partial<Record<MatKey, THREE.BufferGeometry>>
let cache: Parts | null = null

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
/** Truncated square pyramid with flat sides facing the axes. */
function tier(bottom: number, top: number, h: number) {
  const g = new THREE.CylinderGeometry(top * Math.SQRT1_2, bottom * Math.SQRT1_2, h, 4, 1)
  g.rotateY(Math.PI / 4)
  return g
}

function buildTemple() {
  if (cache) return cache
  const b = new GeoBatch(11) // one texture tile (8 courses) per 11 m

  // ------------------------------------------------------------ podium
  b.add(SHADE, box(S + 3, 2.2, S + 3), { p: [0, 1.1, C] }) // plinth
  b.add(STONE, box(S, 14, S), { p: [0, 9.2, C] })
  b.add(TRIM, box(S + 1.2, 0.5, S + 1.2), { p: [0, 2.45, C] })
  b.add(STONE, box(S + 2.4, 1.4, S + 2.4), { p: [0, 16.9, C] }) // cornice
  b.add(TRIM, box(S + 3.2, 0.5, S + 3.2), { p: [0, 17.85, C] })
  for (let side = 0; side < 4; side++) {
    const r: [number, number, number] = [0, side * Math.PI / 2, 0]
    const at = (x: number, y: number, z: number): [number, number, number] => {
      const c = Math.cos(r[1]), s = Math.sin(r[1])
      return [x * c + z * s, y, C - x * s + z * c]
    }
    for (const x of [-38, -26, -14, 14, 26, 38]) {
      // buttress: a tapering pier with a capstone
      b.add(SHADE, tier(3.0, 2.2, 14), { p: at(x, 9.2, S / 2 + 0.6), r })
      b.add(TRIM, box(2.8, 0.5, 2.2), { p: at(x, 16.2, S / 2 + 0.8), r })
      b.add(SHADE, box(3.6, 1.2, 2.6), { p: at(x, 2.8, S / 2 + 0.9), r })
    }
    for (const x of [-32, -20, 20, 32, ...(side === 0 ? [] : [-7, 7])]) {
      // tall recessed window with a lamp-lit slot, sill and hood
      b.add(VOID, box(3.2, 8.6, 0.3), { p: at(x, 9.6, S / 2 + 0.02), r })
      b.add(LAMP, box(1.0, 6.4, 0.2), { p: at(x, 9.4, S / 2 + 0.14), r })
      b.add(TRIM, box(3.8, 0.4, 0.9), { p: at(x, 5.1, S / 2 + 0.35), r })
      b.add(STONE, box(3.8, 0.7, 0.9), { p: at(x, 14.2, S / 2 + 0.35), r })
    }
  }

  // ------------------------------------------------------------ tiers
  b.add(STONE, tier(82, 64, 14), { p: [0, 25.1, C] })
  b.add(TRIM, box(65, 0.5, 65), { p: [0, 32.35, C] })
  b.add(SHADE, box(62, 2.2, 62), { p: [0, 33.7, C] })
  b.add(STONE, tier(58, 42, 12), { p: [0, 40.8, C] })
  b.add(TRIM, box(43, 0.5, 43), { p: [0, 47.05, C] })
  b.add(SHADE, box(40, 1.6, 40), { p: [0, 48.1, C] })
  // ribs running up the slope of each tier
  for (let side = 0; side < 4; side++) {
    const a = side * Math.PI / 2
    for (const x of [-22, -11, 0, 11, 22]) {
      const c = Math.cos(a), s = Math.sin(a)
      const z = 36.6
      b.add(SHADE, box(1.4, 15.4, 0.9), { p: [x * c + z * s, 25.1, C - x * s + z * c], r: [-0.571, a, 0] })
    }
  }

  // ------------------------------------------------------------ spires
  const spire = (x: number, z: number, y: number, h: number, r: number) => {
    b.add(SHADE, new THREE.CylinderGeometry(r * 1.25, r * 1.4, r * 0.9, 8), { p: [x, y + r * 0.45, z] })
    b.add(STONE, new THREE.CylinderGeometry(r * 0.62, r, h, 8), { p: [x, y + h / 2, z] })
    for (const k of [0.3, 0.55, 0.8]) {
      const rr = r - (r * 0.38) * k
      b.add(TRIM, new THREE.CylinderGeometry(rr * 1.08, rr * 1.1, h * 0.022, 8), { p: [x, y + h * k, z] })
    }
    // gallery with lit openings near the top
    b.add(STONE, new THREE.CylinderGeometry(r * 0.95, r * 0.64, r * 0.7, 8), { p: [x, y + h + r * 0.35, z] })
    b.add(LAMP, new THREE.CylinderGeometry(r * 0.78, r * 0.78, r * 0.34, 8), { p: [x, y + h + r * 0.92, z] })
    b.add(TRIM, new THREE.CylinderGeometry(r * 0.98, r * 0.98, r * 0.16, 8), { p: [x, y + h + r * 1.14, z] })
    b.add(STONE, new THREE.ConeGeometry(r * 0.9, r * 2.1, 8), { p: [x, y + h + r * 2.27, z] })
    b.add(TRIM, new THREE.CylinderGeometry(0.1, 0.22, r * 1.4, 5), { p: [x, y + h + r * 3.9, z] })
  }
  spire(0, C, 48.5, 38, 6.5)
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) spire(sx * 34, C + sz * 34, 17.5, 34, 3.7)

  // ------------------------------------------------------------ entrance
  b.add(VOID, box(18, 13, 3), { p: [0, 6.5, -1.2] })
  b.add(STONE, box(22, 2.0, 1.6), { p: [0, 14.2, 0.6] }) // door lintel
  b.add(TRIM, box(22.6, 0.5, 2.0), { p: [0, 15.4, 0.6] })
  for (const x of [-10.2, 10.2]) b.add(SHADE, box(2.4, 13.4, 1.8), { p: [x, 6.7, 0.5] }) // door jambs
  for (const x of [-13.5, -8.2, 8.2, 13.5]) {
    b.add(SHADE, box(3.4, 1.3, 3.4), { p: [x, 1.3, 4.6] })
    b.add(TRIM, new THREE.CylinderGeometry(1.5, 1.6, 0.5, 14), { p: [x, 2.2, 4.6] })
    b.add(STONE, new THREE.CylinderGeometry(1.1, 1.32, 13.2, 14), { p: [x, 9.0, 4.6] })
    b.add(TRIM, new THREE.CylinderGeometry(1.45, 1.15, 0.6, 14), { p: [x, 15.9, 4.6] })
    b.add(STONE, box(3.2, 0.7, 3.2), { p: [x, 16.5, 4.6] })
  }
  b.add(STONE, box(33, 2.6, 7.4), { p: [0, 18.1, 3.4] }) // entablature
  b.add(TRIM, box(34, 0.6, 8.2), { p: [0, 19.7, 3.4] })
  b.add(SHADE, box(30, 1.2, 0.5), { p: [0, 18.1, 7.2] })
  const pediment = new THREE.CylinderGeometry(0.01, 17, 5, 3, 1)
  pediment.rotateY(Math.PI / 6)
  b.add(STONE, pediment, { p: [0, 22.5, 3.4], s: [1, 1, 0.42] })
  for (const x of [-17.5, 17.5]) { // braziers flanking the steps
    b.add(SHADE, new THREE.CylinderGeometry(0.9, 1.4, 2.8, 8), { p: [x, 1.4, 15.5] })
    b.add(TRIM, new THREE.CylinderGeometry(1.3, 0.9, 0.5, 8), { p: [x, 3.0, 15.5] })
    b.add(LAMP, new THREE.SphereGeometry(0.75, 10, 8), { p: [x, 3.5, 15.5] })
  }

  // ------------------------------------------------------------ steps (heights match plazaHeight) and approach
  b.add(PAVE, box(44, 0.22, 16), { p: [0, 0.11, 8] })
  b.add(PAVE, box(40, 0.22, 13.5), { p: [0, 0.33, 6.75] })
  b.add(PAVE, box(36, 0.22, 11), { p: [0, 0.55, 5.5] })
  b.add(PAVE, box(12, 0.06, 76), { p: [0, 0.04, 54] })
  for (const sx of [-1, 1]) b.add(TRIM, box(0.5, 0.08, 76), { p: [sx * 6.2, 0.05, 54] })
  cache = b.build()
  return cache
}

export function Temple({ visible = true }: { visible?: boolean }) {
  const showLabels = useStore((s) => s.showLabels)
  const interior = useStore((s) => s.interior)
  const geo = useMemo(buildTemple, [])
  const m = useMemo(() => {
    const map = stoneTexture()
    const stone = (color: string) => new THREE.MeshStandardMaterial({ color, map, bumpMap: map, bumpScale: 2.4, roughness: 0.92, metalness: 0.02 })
    return {
      [STONE]: stone('#d9c6a0'),
      [SHADE]: stone('#a8946f'),
      [PAVE]: stone('#b6a686'),
      [TRIM]: new THREE.MeshStandardMaterial({ color: '#7a5f33', roughness: 0.45, metalness: 0.65 }),
      [VOID]: new THREE.MeshStandardMaterial({ color: '#050505', roughness: 1 }),
      [LAMP]: new THREE.MeshStandardMaterial({ color: '#3a2a12', emissive: '#ffb45a', emissiveIntensity: 2.4, roughness: 1, toneMapped: false }),
    } as Partial<Record<MatKey, THREE.Material>>
  }, [])
  return (
    <group name="temple" visible={visible} position={MARCH_FRAME.position} rotation={[0, MARCH_FRAME.yaw, 0]}>
      {(Object.keys(geo) as MatKey[]).map((key) => (
        <mesh key={key} geometry={geo[key]} material={m[key]} castShadow receiveShadow />
      ))}
      {showLabels && !interior && (
        <Billboard position={[0, 120, C]}>
          <Text fontSize={9} color="#f0d9a8" anchorX="center" anchorY="bottom" outlineWidth={0.25} outlineColor="#000" letterSpacing={0.15}>TEMPLE</Text>
        </Billboard>
      )}
    </group>
  )
}

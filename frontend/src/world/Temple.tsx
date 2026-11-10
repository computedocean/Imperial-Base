/**
 * The Temple — original interpretation of the great ziggurat of the old order: a square stone podium,
 * two stepped tiers, a tall central spire and four corner spires, with a pillared entrance and broad
 * low steps on its east face. It stands in the north-west corner of the base.
 *
 * Built in the march's local frame (see marchPlan.ts): the door is at the origin, +Z points out of
 * the door across the plaza, the building extends to -Z.
 */
import { Billboard, Text } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import { MARCH_FRAME } from '../personnel/marchPlan'
import { useStore } from '../state/store'
import { TEMPLE } from './layout'

const S = TEMPLE.size
const C = -S / 2 // centre of the building along local Z

/** Truncated square pyramid: side lengths at the bottom and top. */
function Tier({ bottom, top, y, h, material }: { bottom: number; top: number; y: number; h: number; material: THREE.Material }) {
  return (
    <mesh position={[0, y + h / 2, C]} rotation={[0, Math.PI / 4, 0]} material={material} castShadow receiveShadow>
      <cylinderGeometry args={[top * Math.SQRT1_2, bottom * Math.SQRT1_2, h, 4, 1]} />
    </mesh>
  )
}

function Spire({ x, z, y, h, r, m }: { x: number; z: number; y: number; h: number; r: number; m: Record<string, THREE.Material> }) {
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, h / 2, 0]} material={m.stone} castShadow><cylinderGeometry args={[r * 0.62, r, h, 8]} /></mesh>
      <mesh position={[0, h * 0.55, 0]} material={m.trim}><cylinderGeometry args={[r * 0.82, r * 0.86, h * 0.05, 8]} /></mesh>
      <mesh position={[0, h + r * 0.35, 0]} material={m.trim} castShadow><cylinderGeometry args={[r * 0.95, r * 0.62, r * 0.7, 8]} /></mesh>
      <mesh position={[0, h + r * 1.6, 0]} material={m.stone} castShadow><coneGeometry args={[r * 0.8, r * 1.9, 8]} /></mesh>
      <mesh position={[0, h + r * 2.9, 0]} material={m.trim}><cylinderGeometry args={[0.12, 0.2, r * 1.2, 5]} /></mesh>
    </group>
  )
}

export function Temple({ visible = true }: { visible?: boolean }) {
  const showLabels = useStore((s) => s.showLabels)
  const interior = useStore((s) => s.interior)
  const m = useMemo(() => ({
    stone: new THREE.MeshStandardMaterial({ color: '#b9a98c', roughness: 0.9, metalness: 0.02 }),
    dark: new THREE.MeshStandardMaterial({ color: '#8d7f67', roughness: 0.9, metalness: 0.02 }),
    trim: new THREE.MeshStandardMaterial({ color: '#6f5a3a', roughness: 0.6, metalness: 0.35 }),
    black: new THREE.MeshStandardMaterial({ color: '#050505', roughness: 1 }),
    glow: new THREE.MeshStandardMaterial({ color: '#3a2a12', emissive: '#ffb45a', emissiveIntensity: 1.6, roughness: 1 }),
    paving: new THREE.MeshStandardMaterial({ color: '#9a8d76', roughness: 0.95 }),
  }), [])
  return (
    <group name="temple" visible={visible} position={MARCH_FRAME.position} rotation={[0, MARCH_FRAME.yaw, 0]}>
      {/* podium with a cornice, then the two tiers */}
      <mesh position={[0, 8, C]} material={m.stone} castShadow receiveShadow><boxGeometry args={[S, 16, S]} /></mesh>
      <mesh position={[0, 16.4, C]} material={m.trim}><boxGeometry args={[S + 1.6, 0.8, S + 1.6]} /></mesh>
      {/* buttress fins and lit window slots around the podium */}
      {[0, 1, 2, 3].map((side) => (
        <group key={side} position={[0, 0, C]} rotation={[0, side * Math.PI / 2, 0]}>
          {[-36, -24, -12, 12, 24, 36].map((x) => (
            <group key={x}>
              <mesh position={[x, 8, S / 2 + 0.5]} material={m.dark} castShadow><boxGeometry args={[2.2, 16, 1.6]} /></mesh>
              {(side !== 0 || Math.abs(x) > 14) && <mesh position={[x + (x > 0 ? -6 : 6), 9.5, S / 2 + 0.06]} material={m.glow}><boxGeometry args={[1.1, 6, 0.1]} /></mesh>}
            </group>
          ))}
        </group>
      ))}
      <Tier bottom={80} top={62} y={16.8} h={14} material={m.stone} />
      <mesh position={[0, 31.1, C]} material={m.trim}><boxGeometry args={[63, 0.6, 63]} /></mesh>
      <Tier bottom={56} top={40} y={31.4} h={12} material={m.dark} />
      <mesh position={[0, 43.7, C]} material={m.trim}><boxGeometry args={[41, 0.6, 41]} /></mesh>
      {/* the five spires */}
      <Spire x={0} z={C} y={44} h={40} r={6.5} m={m} />
      {[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz]) => <Spire key={`${sx}${sz}`} x={sx * 33} z={C + sz * 33} y={24} h={30} r={3.6} m={m} />)}
      {/* entrance: dark doorway, four great pillars, lintel, glowing braziers */}
      <mesh position={[0, 6.5, -1.2]} material={m.black}><boxGeometry args={[18, 13, 3]} /></mesh>
      <mesh position={[0, 13.4, 0.5]} material={m.trim}><boxGeometry args={[20, 0.8, 1]} /></mesh>
      {[-12.5, -7.2, 7.2, 12.5].map((x) => (
        <group key={x} position={[x, 0, 3.6]}>
          <mesh position={[0, 0.9, 0]} material={m.dark} castShadow><boxGeometry args={[3.2, 1.2, 3.2]} /></mesh>
          <mesh position={[0, 8.4, 0]} material={m.stone} castShadow><cylinderGeometry args={[1.15, 1.35, 13.8, 12]} /></mesh>
          <mesh position={[0, 15.6, 0]} material={m.trim}><boxGeometry args={[3.0, 0.7, 3.0]} /></mesh>
        </group>
      ))}
      <mesh position={[0, 17, 2.6]} material={m.stone} castShadow><boxGeometry args={[31, 2.2, 6.4]} /></mesh>
      <mesh position={[0, 18.4, 2.6]} material={m.trim}><boxGeometry args={[32, 0.6, 7.2]} /></mesh>
      {[-17, 17].map((x) => (
        <group key={x} position={[x, 0, 14]}>
          <mesh position={[0, 1.6, 0]} material={m.dark} castShadow><cylinderGeometry args={[0.9, 1.3, 2.6, 8]} /></mesh>
          <mesh position={[0, 3.1, 0]} material={m.glow}><sphereGeometry args={[0.7, 10, 8]} /></mesh>
        </group>
      ))}
      {/* three broad low steps (heights match plazaHeight in marchPlan.ts) and a paved approach */}
      <mesh position={[0, 0.11, 8]} material={m.paving} receiveShadow><boxGeometry args={[44, 0.22, 16]} /></mesh>
      <mesh position={[0, 0.33, 6.75]} material={m.paving} receiveShadow><boxGeometry args={[40, 0.22, 13.5]} /></mesh>
      <mesh position={[0, 0.55, 5.5]} material={m.paving} receiveShadow><boxGeometry args={[36, 0.22, 11]} /></mesh>
      <mesh position={[0, 0.04, 54]} material={m.paving} receiveShadow><boxGeometry args={[12, 0.06, 76]} /></mesh>
      {showLabels && !interior && (
        <Billboard position={[0, 104, C]}>
          <Text fontSize={9} color="#f0d9a8" anchorX="center" anchorY="bottom" outlineWidth={0.25} outlineColor="#000" letterSpacing={0.15}>TEMPLE</Text>
        </Billboard>
      )}
    </group>
  )
}

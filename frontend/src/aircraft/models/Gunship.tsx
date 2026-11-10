/**
 * Bounty hunter's gunship — original interpretation of the bare-metal ex-military patrol craft:
 * deep slab-sided fuselage, raised cockpit at the nose, two huge engine pods on stub wings, a rear
 * cargo ramp, and three landing legs.
 *
 * Conventions: metres, nose +Z, up +Y, ORIGIN = centre of the fuselage.
 * Standing on its gear the origin is 3.4 m above the ground (GUNSHIP.rest).
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { ThreeElements } from '@react-three/fiber'
import { GeoBatch, bevelBox, chamferRect, cylZ, engineGlowOrangeMat, loft, mat, plateXZ, type MatKey } from './materials'

export type GunshipProps = ThreeElements['group'] & {
  /** 0 = landing gear retracted .. 1 = down and locked */
  gear?: number
  /** 0..1 engine glow intensity */
  thrust?: number
}

const GROUND = 3.4
const POD = { x: 6.7, y: 0.5, r: 1.95, zFront: 2.4, zRear: -7.2 }

type Parts = Partial<Record<MatKey, THREE.BufferGeometry>>
let cache: { body: Parts; gear: Parts; glow: THREE.BufferGeometry } | null = null

function buildGunship() {
  if (cache) return cache
  const sec = (z: number, w: number, yb: number, yt: number, c: number) => ({ z, pts: chamferRect(w, yb, yt, c) })
  const b = new GeoBatch(4)
  // fuselage: blunt and deep, tapering to a snub nose
  b.add('hull', loft([
    sec(-11.4, 3.4, -1.3, 1.5, 0.5),
    sec(-7.0, 4.8, -1.9, 2.3, 0.7),
    sec(3.2, 4.8, -1.9, 2.5, 0.7),
    sec(8.0, 3.7, -1.5, 2.1, 0.6),
    sec(11.6, 1.7, -0.7, 0.9, 0.3),
  ]))
  // cockpit: a faceted canopy on top of the nose
  b.add('glass', loft([
    sec(4.6, 2.7, 2.3, 3.35, 0.45),
    sec(7.6, 2.5, 1.95, 3.1, 0.45),
    sec(10.4, 1.3, 0.8, 1.6, 0.25),
  ]))
  for (const z of [5.4, 7.0, 8.7]) b.add('gun', bevelBox(2.9, 0.1, 0.12, 0.02), { p: [0, 3.2 - (z - 5.4) * 0.16, z] })
  b.add('gun', bevelBox(0.12, 0.1, 5.6, 0.02), { p: [0, 3.05, 7.4], r: [0.3, 0, 0] })
  // dorsal spine, sensor mast and belly keel
  b.add('gun', bevelBox(1.5, 0.5, 9.5, 0.12), { p: [0, 2.55, -3.6] })
  for (let i = 0; i < 4; i++) b.add('dark', bevelBox(1.1, 0.3, 0.7, 0.05), { p: [0, 2.85, -6.6 + i * 1.9] })
  b.add('gun', new THREE.CylinderGeometry(0.06, 0.1, 2.2, 6), { p: [0.9, 3.5, -5.2] })
  b.add('gun', bevelBox(2.6, 0.6, 12, 0.15), { p: [0, -2.0, -1.2] })
  // side cargo hatches and plating seams
  for (const sx of [1, -1]) {
    b.add('gun', bevelBox(0.16, 2.9, 3.4, 0.05), { p: [sx * 2.42, 0.1, -3.3] })
    b.add('dark', bevelBox(0.12, 2.3, 0.14, 0.02), { p: [sx * 2.5, 0.1, -3.3] })
    for (let i = 0; i < 3; i++) b.add('gun', bevelBox(0.1, 3.4, 0.16, 0.02), { p: [sx * 2.43, 0.25, 0.4 + i * 2.2] })
    b.add('stripe', bevelBox(0.1, 0.5, 2.4, 0.02), { p: [sx * 2.44, 1.5, 4.6] })
    // nose cannons under the cockpit
    b.add('gun', cylZ(0.24, 0.24, 2.6, 8), { p: [sx * 1.05, -1.1, 9.2] })
    b.add('dark', cylZ(0.11, 0.11, 2.8, 6), { p: [sx * 1.05, -1.1, 11.4] })
    // stub wing carrying the engine pod
    b.add('hull', plateXZ([[2.2, -5.6], [5.2, -5.0], [5.2, 0.6], [2.2, 1.6]], 0.6, 0.1), { s: [sx, 1, 1], p: [0, POD.y, 0] })
    b.add('gun', plateXZ([[2.6, -4.6], [4.8, -4.2], [4.8, -0.4], [2.6, 0.2]], 0.72, 0.04), { s: [sx, 1, 1], p: [0, POD.y, 0] })
    // engine pod: intake collar, body with bands, exhaust nozzle
    const len = POD.zFront - POD.zRear
    const mid = (POD.zFront + POD.zRear) / 2
    b.add('hull', cylZ(POD.r, POD.r, len, 20), { p: [sx * POD.x, POD.y, mid] })
    b.add('gun', cylZ(POD.r * 1.07, POD.r * 1.07, 1.0, 20), { p: [sx * POD.x, POD.y, POD.zFront - 0.2] })
    b.add('dark', cylZ(POD.r * 0.86, POD.r * 0.86, 0.12, 18), { p: [sx * POD.x, POD.y, POD.zFront + 0.32] })
    b.add('gun', cylZ(0.25, POD.r * 0.5, 1.3, 12), { p: [sx * POD.x, POD.y, POD.zFront + 0.7] }) // intake spike
    b.add('stripe', cylZ(POD.r * 1.02, POD.r * 1.02, 0.5, 20), { p: [sx * POD.x, POD.y, POD.zFront - 2.2] })
    b.add('gun', cylZ(POD.r * 1.03, POD.r * 1.03, 0.4, 20), { p: [sx * POD.x, POD.y, mid - 1.6] })
    b.add('gun', cylZ(POD.r * 0.98, POD.r * 0.82, 1.5, 20), { p: [sx * POD.x, POD.y, POD.zRear - 0.6] })
    b.add('dark', cylZ(POD.r * 0.74, POD.r * 0.74, 0.5, 16), { p: [sx * POD.x, POD.y, POD.zRear - 1.15] })
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4
      b.add('gun', bevelBox(0.16, 0.3, len - 3.2, 0.03), { p: [sx * POD.x + Math.cos(a) * POD.r, POD.y + Math.sin(a) * POD.r, mid - 0.4], r: [0, 0, a] })
    }
  }
  // stern: ramp door and running lights
  b.add('gun', bevelBox(3.0, 2.5, 0.3, 0.08), { p: [0, 0, -11.45] })
  b.add('dark', bevelBox(2.3, 1.9, 0.2, 0.05), { p: [0, -0.05, -11.6] })
  b.add('navRed', new THREE.SphereGeometry(0.16, 8, 6), { p: [0, 2.95, -8.5] })
  b.add('navWhite', new THREE.SphereGeometry(0.14, 8, 6), { p: [0, -2.35, 5.5] })
  const body = b.build()

  // landing gear (origin = model origin; it slides up into the hull when retracted)
  const g = new GeoBatch(3)
  for (const [x, z] of [[0, 6.6], [2.0, -6.4], [-2.0, -6.4]] as const) {
    const top = -1.7
    const len = GROUND + top
    g.add('gun', new THREE.CylinderGeometry(0.2, 0.26, len, 8), { p: [x, top - len / 2, z] })
    g.add('dark', new THREE.CylinderGeometry(0.32, 0.32, 0.4, 8), { p: [x, top - 0.3, z] })
    g.add('gun', bevelBox(1.3, 0.22, 1.7, 0.06), { p: [x, -GROUND + 0.11, z] })
  }
  const gear = g.build()

  const glow = new THREE.CircleGeometry(POD.r * 0.7, 18)
  glow.rotateY(Math.PI)
  cache = { body, gear, glow }
  return cache
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export function Gunship({ gear = 1, thrust = 0, ...props }: GunshipProps) {
  const geo = useMemo(buildGunship, [])
  const glowMat = useMemo(() => engineGlowOrangeMat().clone(), [])
  useEffect(() => () => glowMat.dispose(), [glowMat])
  glowMat.emissiveIntensity = 0.1 + clamp01(thrust) * 3.6
  const k = clamp01(gear)
  return (
    <group {...props}>
      {(Object.keys(geo.body) as MatKey[]).map((key) => (
        <mesh key={key} geometry={geo.body[key]} material={mat(key)} castShadow receiveShadow />
      ))}
      {thrust > 0.02 && [1, -1].map((sx) => <mesh key={sx} geometry={geo.glow} material={glowMat} position={[sx * POD.x, POD.y, POD.zRear - 1.42]} />)}
      <group visible={k > 0.02} position={[0, (1 - k) * 1.9, 0]}>
        {(Object.keys(geo.gear) as MatKey[]).map((key) => (
          <mesh key={key} geometry={geo.gear[key]} material={mat(key)} castShadow />
        ))}
      </group>
    </group>
  )
}

export default Gunship

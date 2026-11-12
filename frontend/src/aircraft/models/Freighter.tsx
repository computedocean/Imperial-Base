/**
 * Light freighter — original interpretation of the famous Corellian saucer:
 * lens-shaped disc hull, twin forward mandibles, offset starboard cockpit tube,
 * round sensor dish, dorsal and ventral quad turrets, a wide engine band across
 * the stern, and three landing legs with a boarding ramp.
 *
 * Conventions: metres, nose +Z, up +Y, ORIGIN = centre of the disc.
 * Standing on its gear the origin is 4.3 m above the ground (FREIGHTER_REST).
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { ThreeElements } from '@react-three/fiber'
import { Baked, type Bind } from './Baked'
import { GeoBatch, bevelBox, cylX, cylZ, engineGlowBlueMat, mat, plateXZ, type MatKey, type V2 } from './materials'

export type FreighterProps = ThreeElements['group'] & {
  /** 0 = landing gear retracted .. 1 = down and locked */
  gear?: number
  /** 0..1 engine glow intensity */
  thrust?: number
}

const R = 12.4 // disc radius
const LEG = 2.05 // gear leg length below the belly

type Parts = Partial<Record<MatKey, THREE.BufferGeometry>>
let cache: { body: Parts; gear: Parts; glow: THREE.BufferGeometry } | null = null

/** Height of the upper hull surface at radius r (matches the lathe profile). */
function deckY(r: number) {
  if (r <= 3) return 2.3 - (r / 3) * 0.1
  if (r <= 6.5) return 2.2 - ((r - 3) / 3.5) * 0.5
  return 1.7 - ((r - 6.5) / 5.3) * 1.15
}

function buildFreighter() {
  if (cache) return cache
  const b = new GeoBatch(5)

  // ------------------------------------------------------------ saucer (lathe: lens profile)
  const profile: [number, number][] = [
    [0, 2.3], [3, 2.2], [6.5, 1.7], [11.8, 0.55], [12.3, 0.4], [12.3, -0.4], [11.8, -0.55], [6.5, -1.7], [3, -2.2], [0, -2.3],
  ]
  b.add('xwhite', new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)).reverse(), 56))
  // equatorial trench full of machinery
  b.add('dark', new THREE.CylinderGeometry(R - 0.04, R - 0.04, 0.5, 56, 1, true))
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2
    if (Math.cos(a) < -0.62) continue // stern: the engine band lives there
    b.add('gun', bevelBox(0.5 + (i % 3) * 0.25, 0.3 + (i % 2) * 0.12, 0.22, 0.03), { p: [Math.sin(a) * (R + 0.02), ((i % 4) - 1.5) * 0.04, Math.cos(a) * (R + 0.02)], r: [0, a, 0] })
  }
  // central core hub + dorsal quad turret
  b.add('gun', new THREE.CylinderGeometry(2.7, 3.0, 0.35, 28), { p: [0, 2.3, 0] })
  b.add('xwhite', new THREE.CylinderGeometry(1.5, 1.7, 0.6, 20), { p: [0, 2.65, 0] })
  b.add('glass', new THREE.SphereGeometry(0.75, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), { p: [0, 2.9, 0] })
  b.add('gun', new THREE.CylinderGeometry(1.5, 1.7, 0.6, 20), { p: [0, -2.6, 0] })
  for (const sy of [1, -1]) {
    for (const [dx, dy] of [[-0.28, 0.14], [0.28, 0.14], [-0.28, -0.14], [0.28, -0.14]] as const) {
      b.add('gun', cylZ(0.06, 0.06, 2.6, 6), { p: [dx, sy * 3.15 + dy, 1.5] })
    }
    b.add('dark', bevelBox(0.9, 0.5, 0.7, 0.08), { p: [0, sy * 3.15, 0.3] })
  }
  // radial hull plating: raised panels and a few off-colour replacement plates
  const panel = (key: MatKey, r: number, ang: number, w: number, d: number, top = true) => {
    // tilt the plate to the hull slope first (about its own X), then swing it round to its bearing
    const tilt = Math.atan(r > 6.5 ? 0.217 : r > 3 ? 0.143 : 0.033)
    const y = deckY(r) + 0.02
    const g = bevelBox(w, 0.08, d, 0.02)
    g.rotateX(top ? tilt : -tilt)
    b.add(key, g, { p: [Math.sin(ang) * r, top ? y : -y, Math.cos(ang) * r], r: [0, ang, 0] })
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.2
    panel(i % 5 === 0 ? 'stripe' : 'hull', 8.9 + (i % 2) * 0.9, a, 2.2 + (i % 3) * 0.5, 2.0)
    if (i % 2 === 0) panel('gun', 4.9, a + 0.19, 1.3, 1.4)
    panel(i % 4 === 0 ? 'stripe' : 'hull', 8.6, a + 0.1, 2.4, 2.2, false)
  }
  // six circular heat-exhaust vents on the aft deck
  for (let i = 0; i < 6; i++) {
    const a = Math.PI + (i - 2.5) * 0.29
    const r = i === 0 || i === 5 ? 7.3 : 8.1
    b.add('gun', new THREE.CylinderGeometry(1.0, 1.05, 0.22, 18), { p: [Math.sin(a) * r, deckY(r) + 0.05, Math.cos(a) * r], r: [0.21 * Math.cos(a) * -1, 0, 0.21 * Math.sin(a)] })
    b.add('dark', new THREE.CylinderGeometry(0.78, 0.78, 0.26, 16), { p: [Math.sin(a) * r, deckY(r) + 0.06, Math.cos(a) * r], r: [0.21 * Math.cos(a) * -1, 0, 0.21 * Math.sin(a)] })
  }
  // engine housing lips above and below the glow band
  for (const sy of [1, -1]) {
    b.add('gun', new THREE.CylinderGeometry(R + 0.12, R + 0.12, 0.16, 28, 1, false, Math.PI - 0.92, 1.84), { p: [0, sy * 0.36, 0] })
  }

  // ------------------------------------------------------------ mandibles
  const mandible: V2[] = [[1.05, 8.2], [6.3, 8.6], [5.3, 13.0], [3.5, 20.6], [1.05, 20.6]]
  for (const sx of [1, -1]) {
    const s: [number, number, number] = [sx, 1, 1]
    b.add('xwhite', plateXZ(mandible, 1.5, 0.12), { s })
    b.add('gun', plateXZ([[1.4, 11], [4.6, 11.4], [3.3, 19.4], [1.4, 19.4]], 1.62, 0.04), { s })
    b.add('stripe', plateXZ([[1.5, 12.2], [3.2, 12.4], [2.9, 14.6], [1.5, 14.6]], 1.68, 0.02), { s })
    b.add('dark', bevelBox(0.5, 0.5, 6.5, 0.08), { p: [sx * 1.0, 0, 16.6] }) // inner-face machinery
    b.add('gun', cylZ(0.16, 0.16, 1.2, 8), { p: [sx * 2.3, 0, 21.0] }) // tip emitters
    b.add('navWhite', new THREE.SphereGeometry(0.16, 8, 6), { p: [sx * 2.3, 0, 21.65] })
  }
  // recessed bay between the mandibles
  b.add('gun', bevelBox(2.1, 1.0, 5.4, 0.1), { p: [0, 0, 10.6] })
  for (let i = 0; i < 4; i++) b.add('dark', bevelBox(1.6, 1.1, 0.5, 0.05), { p: [0, 0, 9.0 + i * 1.15] })

  // ------------------------------------------------------------ cockpit (starboard = -X)
  b.add('xwhite', bevelBox(6.6, 1.9, 3.3, 0.3), { p: [-8.7, 0.25, 5.3], r: [0, 0.55, 0] })
  b.add('xwhite', cylZ(1.3, 1.3, 8.4, 18), { p: [-11.3, 0.3, 7.4] })
  b.add('gun', cylZ(1.36, 1.36, 0.5, 18), { p: [-11.3, 0.3, 11.4] })
  b.add('gun', cylZ(1.36, 1.36, 0.4, 18), { p: [-11.3, 0.3, 8.0] })
  b.add('glass', cylZ(0.62, 1.28, 2.3, 14), { p: [-11.3, 0.3, 12.75] })
  b.add('dark', cylZ(0.64, 0.64, 0.12, 12), { p: [-11.3, 0.3, 13.92] })
  for (let i = 0; i < 6; i++) { // canopy frame ribs
    const a = (i / 6) * Math.PI * 2
    b.add('gun', bevelBox(0.09, 0.09, 2.4, 0.02), { p: [-11.3 + Math.cos(a) * 0.97, 0.3 + Math.sin(a) * 0.97, 12.75], r: [Math.sin(a) * 0.28, -Math.cos(a) * 0.28, 0] })
  }

  // ------------------------------------------------------------ sensor dish (port, forward)
  const dx = 5.2, dz = 5.6, dy = deckY(Math.hypot(dx, dz))
  b.add('gun', new THREE.CylinderGeometry(0.55, 0.75, 0.5, 12), { p: [dx, dy + 0.2, dz] })
  b.add('gun', new THREE.CylinderGeometry(0.22, 0.22, 1.5, 8), { p: [dx, dy + 1.1, dz] })
  b.add('hull', new THREE.CylinderGeometry(2.3, 1.2, 0.5, 26), { p: [dx, dy + 2.1, dz + 0.35], r: [1.05, 0, 0] })
  b.add('dark', new THREE.CylinderGeometry(2.05, 2.05, 0.06, 24), { p: [dx, dy + 2.24, dz + 0.6], r: [1.05, 0, 0] })
  b.add('gun', new THREE.CylinderGeometry(0.1, 0.16, 1.3, 6), { p: [dx, dy + 2.55, dz + 1.15], r: [1.05, 0, 0] })

  // ------------------------------------------------------------ docking rings, port and starboard
  for (const sx of [1, -1]) {
    b.add('xwhite', bevelBox(2.6, 2.0, 4.2, 0.25), { p: [sx * 11.6, 0, -0.6] })
    b.add('gun', cylX(1.5, 1.5, 0.7, 18), { p: [sx * 13.1, 0, -0.6] })
    b.add('dark', cylX(1.05, 1.05, 0.76, 16), { p: [sx * 13.12, 0, -0.6] })
  }
  // running lights
  b.add('navRed', new THREE.SphereGeometry(0.2, 8, 6), { p: [0, 3.25, -1.2] })
  b.add('navRed', new THREE.SphereGeometry(0.2, 8, 6), { p: [0, -2.95, 3.0] })
  const body = b.build()

  // ------------------------------------------------------------ landing gear + ramp (y = 0 is the belly line)
  const g = new GeoBatch(3)
  const legs: [number, number, number][] = [[0, 7.4, 1.75], [6.3, -4.6, 1.72], [-6.3, -4.6, 1.72]] // x, z, belly depth there
  for (const [x, z, belly] of legs) {
    const top = -belly + 0.3
    const len = FREIGHTER_GROUND - belly + 0.3
    g.add('gun', new THREE.CylinderGeometry(0.3, 0.36, len, 10), { p: [x, top - len / 2, z] })
    g.add('dark', new THREE.CylinderGeometry(0.42, 0.42, 0.5, 10), { p: [x, top - 0.5, z] })
    g.add('gun', bevelBox(1.9, 0.28, 2.3, 0.08), { p: [x, -FREIGHTER_GROUND + 0.14, z] })
    g.add('gun', bevelBox(0.16, 0.16, 1.9, 0.03), { p: [x, top - len * 0.5, z - 0.75], r: [0.5, 0, 0] })
  }
  // boarding ramp under the starboard-forward quarter
  const rampLen = 6.4
  const rampAng = Math.asin((FREIGHTER_GROUND - 1.5) / rampLen)
  g.add('gun', bevelBox(2.6, 0.22, rampLen, 0.06), { p: [-5.2, -(1.5 + FREIGHTER_GROUND) / 2, 4.6 + Math.cos(rampAng) * rampLen * 0.5 - 2.6], r: [rampAng, 0, 0] })
  for (const sx of [1, -1]) g.add('dark', bevelBox(0.12, 0.5, rampLen, 0.03), { p: [-5.2 + sx * 1.3, -(1.5 + FREIGHTER_GROUND) / 2 + 0.3, 4.6 + Math.cos(rampAng) * rampLen * 0.5 - 2.6], r: [rampAng, 0, 0] })
  const gear = g.build()

  // engine band: an open strip around the stern (cylinder theta 0 = +Z, so the stern is at pi)
  const glow = new THREE.CylinderGeometry(R + 0.06, R + 0.06, 0.56, 36, 1, true, Math.PI - 0.9, 1.8)
  cache = { body, gear, glow }
  return cache
}

/** Distance from the model origin down to the ground when standing on the gear. */
const FREIGHTER_GROUND = 2.25 + LEG

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export function Freighter({ gear = 1, thrust = 0, ...props }: FreighterProps) {
  const geo = useMemo(buildFreighter, [])
  const glowMat = useMemo(() => {
    const m = engineGlowBlueMat().clone() as THREE.MeshStandardMaterial
    m.side = THREE.DoubleSide
    return m
  }, [])
  useEffect(() => () => glowMat.dispose(), [glowMat])
  glowMat.emissiveIntensity = 0.12 + clamp01(thrust) * 4.2
  // own copies of the shared aircraft materials: the baked shadow map is attached to them
  const bind = useMemo<Bind>(() => {
    const own = new Map<string, THREE.Material>()
    return (name) => {
      const key = (['xwhite', 'gun', 'dark', 'glass', 'stripe', 'hull', 'navRed', 'navWhite'].includes(name) ? name : 'gun') as MatKey
      if (!own.has(key)) own.set(key, mat(key).clone())
      return { material: own.get(key)!, ao: key !== 'glass' }
    }
  }, [])
  const k = clamp01(gear)
  return (
    <group {...props}>
      {/* hull: the Blender-built model (tools/blender/freighter.py); the code-built one is the fallback */}
      <Baked name="freighter" bind={bind} fallback={
        <>
          {(Object.keys(geo.body) as MatKey[]).map((key) => (
            <mesh key={key} geometry={geo.body[key]} material={mat(key)} castShadow receiveShadow />
          ))}
        </>
      } />
      <mesh geometry={geo.glow} material={glowMat} />
      {/* gear retracts straight up into the belly */}
      <group visible={k > 0.02} position={[0, (1 - k) * (LEG + 0.6), 0]}>
        {(Object.keys(geo.gear) as MatKey[]).map((key) => (
          <mesh key={key} geometry={geo.gear[key]} material={mat(key)} castShadow />
        ))}
      </group>
    </group>
  )
}

export default Freighter

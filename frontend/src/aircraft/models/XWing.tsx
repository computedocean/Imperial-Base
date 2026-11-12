/**
 * Rebel-style four-wing starfighter — original interpretation: long pointed
 * nose, bubble canopy, astromech dome, four S-foil wings that split into an X,
 * four engine nacelles and wingtip cannons.
 *
 * Conventions: metres, nose +Z, up +Y, ORIGIN = approx. centre of mass.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { EnginePlume } from './Plume'
import type { ThreeElements } from '@react-three/fiber'
import {
  GeoBatch, bevelBox, chamferRect, cylX, cylZ, engineGlowOrangeMat, loft, mat, plateXZ,
  type MatKey, type V2,
} from './materials'

export type XWingProps = ThreeElements['group'] & {
  /** 0 = S-foils closed (flat) .. 1 = open attack X */
  sFoil?: number
  /** 0..1 engine glow intensity */
  thrust?: number
}

const OPEN_ANGLE = THREE.MathUtils.degToRad(13)
const WING_PIVOT_Y = 0.1
const NACELLE = { x: 1.32, y: 0.44, zFront: -1.5, zRear: -5.9, r: 0.42 }
const PLUME = [[NACELLE.x, NACELLE.y, NACELLE.zRear - 0.62]] as const
const TIP_X = 5.72

type Parts = Partial<Record<MatKey, THREE.BufferGeometry>>
let cache: { body: Parts; wing: Parts; glow: THREE.BufferGeometry } | null = null

function buildXWing() {
  if (cache) return cache
  // ------------------------------------------------------------ fuselage
  const b = new GeoBatch(3)
  const sec = (z: number, w: number, yb: number, yt: number, c: number) => ({ z, pts: chamferRect(w, yb, yt, c) })
  b.add('xwhite', loft([
    sec(-5.5, 1.45, -0.55, 0.52, 0.25),
    sec(-2.6, 1.6, -0.6, 0.62, 0.3),
    sec(-0.4, 1.55, -0.58, 0.6, 0.3),
    sec(1.6, 1.22, -0.48, 0.5, 0.26),
    sec(4.2, 0.86, -0.36, 0.26, 0.2),
    sec(6.5, 0.4, -0.2, 0.06, 0.1),
    sec(7.0, 0.14, -0.12, -0.02, 0.04),
  ]))
  // nose underside sensor keel
  b.add('gun', loft([
    sec(1.0, 0.7, -0.62, -0.4, 0.12),
    sec(4.6, 0.4, -0.42, -0.25, 0.08),
  ]))
  // canopy glass (raised bubble) and frame ribs
  const canopy = [
    sec(-1.3, 0.8, 0.5, 0.66, 0.15),
    sec(-0.7, 0.92, 0.5, 1.02, 0.3),
    sec(0.5, 0.88, 0.46, 0.96, 0.3),
    sec(1.9, 0.56, 0.32, 0.44, 0.12),
  ]
  b.add('glass', loft(canopy))
  for (const z of [-0.65, 0.15, 0.85, 1.4]) {
    // interpolate canopy section at z, inflate slightly, thin slab = frame rib
    let i = 0
    while (i < canopy.length - 2 && canopy[i + 1].z < z) i++
    const A = canopy[i], B = canopy[i + 1]
    const t = (z - A.z) / (B.z - A.z)
    const pts: V2[] = A.pts.map((p, k) => [
      (p[0] + (B.pts[k][0] - p[0]) * t) * 1.06,
      0.5 + ((p[1] + (B.pts[k][1] - p[1]) * t) - 0.5) * 1.06,
    ])
    b.add('gun', loft([{ z: z - 0.04, pts }, { z: z + 0.04, pts }]))
  }
  // centre canopy spine
  b.add('gun', bevelBox(0.06, 0.06, 2.4, 0.015), { p: [0, 0.98, 0.0], r: [-0.12, 0, 0] })
  // astromech socket + dome
  b.add('gun', new THREE.CylinderGeometry(0.4, 0.42, 0.3, 18), { p: [0, 0.6, -2.3] })
  b.add('hull', new THREE.SphereGeometry(0.37, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), { p: [0, 0.74, -2.3] })
  b.add('stripe', bevelBox(0.16, 0.12, 0.05, 0.02), { p: [0, 0.98, -2.0], r: [-0.5, 0, 0] })
  b.add('stripe', new THREE.TorusGeometry(0.37, 0.025, 4, 18), { p: [0, 0.82, -2.3], r: [Math.PI / 2, 0, 0] })
  b.add('dark', cylZ(0.06, 0.06, 0.06, 8), { p: [0.12, 0.98, -2.0] })
  // rear deck greebles
  b.add('gun', bevelBox(1.0, 0.12, 2.0, 0.04), { p: [0, 0.6, -4.2] })
  for (let i = 0; i < 4; i++) b.add('dark', bevelBox(0.8, 0.05, 0.12, 0.01), { p: [0, 0.68, -3.6 - i * 0.35] })
  // rear plate with exhaust detail
  b.add('gun', bevelBox(1.3, 0.95, 0.2, 0.05), { p: [0, -0.02, -5.55] })
  b.add('dark', bevelBox(0.8, 0.5, 0.1, 0.02), { p: [0, -0.02, -5.68] })
  // nose stripes and side panels
  for (const sx of [-1, 1]) {
    b.add('stripe', bevelBox(0.04, 0.4, 0.45, 0.01), { p: [sx * 0.6, 0.0, 2.6], r: [0, sx * -0.07, 0] })
    b.add('stripe', bevelBox(0.04, 0.34, 0.25, 0.01), { p: [sx * 0.55, -0.02, 3.3], r: [0, sx * -0.07, 0] })
    b.add('gun', bevelBox(0.06, 0.4, 1.6, 0.02), { p: [sx * 0.79, -0.05, -1.6] })
    b.add('dark', bevelBox(0.05, 0.25, 0.9, 0.02), { p: [sx * 0.81, 0.22, -3.6] })
    // S-foil actuator housings at wing roots
    b.add('gun', cylZ(0.16, 0.16, 2.4, 10), { p: [sx * 0.78, WING_PIVOT_Y, -3.9] })
  }
  // nose cap / sensor tip
  b.add('gun', cylZ(0.035, 0.07, 0.4, 6), { p: [0, -0.07, 7.15] })
  const body = b.build()

  // ------------------------------------------------------------ one wing (upper-right, +X); others are mirrored
  const w = new GeoBatch(3)
  const wingPlan: V2[] = [[0.6, -5.35], [TIP_X, -5.15], [TIP_X, -3.75], [0.6, -2.3]]
  w.add('xwhite', plateXZ(wingPlan, 0.12, 0.035), { p: [0, 0.06, 0] })
  // trailing edge gunmetal strip
  w.add('gun', plateXZ([[1.8, -5.4], [TIP_X - 0.2, -5.22], [TIP_X - 0.2, -5.05], [1.8, -5.2]], 0.15, 0.02), { p: [0, 0.06, 0] })
  // faded squadron stripes (both faces)
  for (const [x0, x1] of [[3.05, 3.4], [3.62, 3.97]] as const) {
    const zLE = (x: number) => -2.3 + ((x - 0.6) / (TIP_X - 0.6)) * (-3.75 + 2.3)
    const zTE = (x: number) => -5.35 + ((x - 0.6) / (TIP_X - 0.6)) * (-5.15 + 5.35)
    w.add('stripe', plateXZ([[x0, zTE(x0) + 0.05], [x1, zTE(x1) + 0.05], [x1, zLE(x1) - 0.05], [x0, zLE(x0) - 0.05]], 0.135, 0.01), { p: [0, 0.06, 0] })
  }
  // raised panel greebles
  w.add('gun', bevelBox(1.0, 0.04, 0.8, 0.015), { p: [2.3, 0.14, -4.6] })
  w.add('gun', bevelBox(0.6, 0.04, 0.5, 0.015), { p: [4.6, 0.14, -4.6] })
  // engine nacelle
  const N = NACELLE
  const nLen = N.zFront - N.zRear
  const nMid = (N.zFront + N.zRear) / 2
  w.add('xwhite', cylZ(N.r, N.r, nLen, 16), { p: [N.x, N.y, nMid] })
  w.add('gun', cylZ(N.r * 1.06, N.r * 1.06, 0.55, 16), { p: [N.x, N.y, N.zFront - 0.1] }) // intake collar
  w.add('dark', cylZ(N.r * 0.75, N.r * 0.75, 0.1, 14), { p: [N.x, N.y, N.zFront + 0.18] }) // intake face
  w.add('gun', cylZ(N.r * 0.5, N.r * 0.5, 0.25, 10), { p: [N.x, N.y, N.zFront + 0.2] }) // intake hub
  w.add('stripe', cylZ(N.r * 1.02, N.r * 1.02, 0.25, 16), { p: [N.x, N.y, N.zFront - 0.9] })
  w.add('gun', cylZ(N.r * 0.95, N.r * 0.82, 0.6, 16), { p: [N.x, N.y, N.zRear - 0.25] }) // exhaust nozzle
  w.add('dark', cylZ(N.r * 0.72, N.r * 0.72, 0.4, 14), { p: [N.x, N.y, N.zRear - 0.38] })
  for (let i = 0; i < 4; i++) w.add('gun', bevelBox(0.05, 0.12, nLen - 1.6, 0.01), { p: [N.x + Math.cos(i * 1.57 + 0.78) * N.r, N.y + Math.sin(i * 1.57 + 0.78) * N.r, nMid] , r: [0, 0, i * 1.57 + 0.78]})
  // nacelle-to-wing pylon
  w.add('gun', bevelBox(0.38, N.y - 0.06, 3.0, 0.04), { p: [N.x, (N.y + 0.06) / 2, nMid + 0.2] })
  // wingtip cannon: housing, main tube, barrel, flash suppressor
  w.add('gun', bevelBox(0.3, 0.26, 1.7, 0.05), { p: [TIP_X, 0.06, -4.4] })
  w.add('gun', cylZ(0.11, 0.11, 4.2, 10), { p: [TIP_X, 0.06, -1.6] })
  w.add('gun', cylZ(0.15, 0.15, 0.5, 10), { p: [TIP_X, 0.06, -1.0] })
  w.add('gun', cylZ(0.055, 0.055, 2.4, 8), { p: [TIP_X, 0.06, 1.6] })
  w.add('dark', cylZ(0.09, 0.09, 0.4, 8), { p: [TIP_X, 0.06, 2.95] })
  const wing = w.build()

  const glow = new THREE.CircleGeometry(N.r * 0.7, 16)
  glow.rotateY(Math.PI)
  cache = { body, wing, glow }
  return cache
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

// [mirrorX, mirrorY]: +1/-1 per wing (upper-right, upper-left, lower-right, lower-left)
const WINGS: [number, number][] = [[1, 1], [-1, 1], [1, -1], [-1, -1]]

export function XWing({ sFoil = 1, thrust = 0.5, ...props }: XWingProps) {
  const geo = useMemo(buildXWing, [])
  const glowMat = useMemo(() => engineGlowOrangeMat().clone(), [])
  useEffect(() => () => glowMat.dispose(), [glowMat])
  glowMat.emissiveIntensity = 0.2 + clamp01(thrust) * 3.2
  const a = clamp01(sFoil) * OPEN_ANGLE

  return (
    <group {...props}>
      {(Object.keys(geo.body) as MatKey[]).map((k) => (
        <mesh key={k} geometry={geo.body[k]} material={mat(k)} castShadow receiveShadow />
      ))}
      {WINGS.map(([mx, my]) => (
        <group key={`${mx}${my}`} position={[0, my * WING_PIVOT_Y, 0]} rotation={[0, 0, mx * my * a]} scale={[mx, my, 1]}>
          {(Object.keys(geo.wing) as MatKey[]).map((k) => (
            <mesh key={k} geometry={geo.wing[k]} material={mat(k)} castShadow receiveShadow />
          ))}
          <mesh geometry={geo.glow} material={glowMat} position={[NACELLE.x, NACELLE.y, NACELLE.zRear - 0.6]} />
          <EnginePlume at={PLUME} radius={NACELLE.r * 0.66} length={5} color="#ff6a4a" thrust={thrust} />
        </group>
      ))}
    </group>
  )
}

export default XWing

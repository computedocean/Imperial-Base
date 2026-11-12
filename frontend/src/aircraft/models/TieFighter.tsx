/**
 * Twin-ion-engine style Imperial fighter — original interpretation:
 * spherical cockpit pod, two pylons, two large flat hexagonal solar wings.
 *
 * Conventions: metres, nose +Z, up +Y, ORIGIN = centre of the cockpit pod.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Baked, shipBind } from './Baked'
import { EnginePlume } from './Plume'
import type { ThreeElements } from '@react-three/fiber'
import { GeoBatch, bevelBox, cylX, cylZ, engineGlowRedMat, loft, mat, plateZY, type MatKey, type V2 } from './materials'

export type TieFighterProps = ThreeElements['group'] & {
  /** 0..1 engine glow intensity */
  thrust?: number
}

const POD_R = 1.22
const PLUMES = [[-0.27, -0.05, -POD_R - 0.13], [0.27, -0.05, -POD_R - 0.13]] as const
const WING_X = 3.4 // wing plane offset from centre
const HEX_R = 3.1 // circumradius => ~6.2 m tall, ~5.4 m long
const VIEW_A = 0.6 // half-angle of the front viewport opening (rad)

type Parts = Partial<Record<MatKey, THREE.BufferGeometry>>
let cache: { parts: Parts; glow: THREE.BufferGeometry } | null = null

function hexPts(r: number): V2[] {
  // vertices at top and bottom (angle measured in z,y plane)
  const out: V2[] = []
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 2 + (k * Math.PI) / 3
    out.push([Math.cos(a) * r, Math.sin(a) * r])
  }
  return out
}

function buildTie() {
  if (cache) return cache
  const b = new GeoBatch(2.2)

  // ---- cockpit pod: sphere with the front cap removed for the viewport
  const pod = new THREE.SphereGeometry(POD_R, 28, 18, 0, Math.PI * 2, VIEW_A, Math.PI - VIEW_A)
  pod.rotateX(Math.PI / 2) // pole +Y -> +Z
  b.add('hull', pod)
  const viewR = POD_R * Math.sin(VIEW_A)
  const viewZ = POD_R * Math.cos(VIEW_A)
  b.add('glass', cylZ(viewR * 0.98, viewR * 0.98, 0.06, 24), { p: [0, 0, viewZ - 0.02] })
  // viewport frame: thick ring + 8 spokes + hub
  b.add('gun', new THREE.TorusGeometry(viewR, 0.085, 6, 28), { p: [0, 0, viewZ + 0.01] })
  b.add('gun', cylZ(0.17, 0.2, 0.12, 12), { p: [0, 0, viewZ + 0.03] })
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4 + Math.PI / 8
    const len = viewR - 0.15
    b.add('gun', bevelBox(len, 0.06, 0.07, 0.015), {
      p: [Math.cos(a) * (len / 2 + 0.12), Math.sin(a) * (len / 2 + 0.12), viewZ + 0.04],
      r: [0, 0, a],
    })
  }
  // equator weld band + top hatch + rear panel
  b.add('gun', new THREE.TorusGeometry(POD_R * 0.995, 0.035, 4, 32), { r: [Math.PI / 2, 0, 0], p: [0, 0.05, 0] })
  b.add('gun', new THREE.CylinderGeometry(0.5, 0.56, 0.16, 16), { p: [0, POD_R - 0.04, -0.15] })
  b.add('dark', new THREE.CylinderGeometry(0.34, 0.34, 0.18, 12), { p: [0, POD_R + 0.0, -0.15] })
  b.add('gun', bevelBox(1.1, 0.9, 0.3, 0.06), { p: [0, -0.05, -POD_R + 0.08] })
  for (let i = 0; i < 4; i++) b.add('dark', bevelBox(0.9, 0.06, 0.05, 0.01), { p: [0, 0.25 - i * 0.18, -POD_R - 0.08] })
  // chin cannons
  for (const sx of [-1, 1]) {
    b.add('gun', cylZ(0.07, 0.07, 0.55, 8), { p: [sx * 0.35, -0.95, 0.75] })
    b.add('dark', cylZ(0.11, 0.11, 0.25, 8), { p: [sx * 0.35, -0.9, 0.5] })
  }

  // ---- pylons (loft along +X, built along Z then rotated)
  const pylon = loft([
    { z: 0, pts: [[0.5, -0.38], [0.5, 0.38], [-0.62, 0.45], [-0.62, -0.45]] },
    { z: 1.0, pts: [[0.42, -0.3], [0.42, 0.3], [-0.55, 0.36], [-0.55, -0.36]] },
    { z: 2.15, pts: [[0.3, -0.24], [0.3, 0.24], [-0.4, 0.28], [-0.4, -0.28]] },
  ])
  // pylon section: x of section -> world z, y -> y, loft z -> world x
  pylon.rotateY(Math.PI / 2) // z -> x, x -> -z
  for (const sx of [-1, 1]) {
    b.add('hull', pylon.clone(), { p: [sx * 0.95, 0, 0], s: [sx, 1, 1] })
    b.add('gun', cylX(0.62, 0.62, 0.32, 18), { p: [sx * 1.0, 0, 0] }) // pod collar
    b.add('dark', cylX(0.5, 0.5, 0.36, 14), { p: [sx * 1.25, 0, 0] })
    // pylon ribs
    for (const x of [1.7, 2.3]) b.add('gun', bevelBox(0.1, 0.72, 0.95, 0.03), { p: [sx * x, 0, -0.05] })
    // wing hub
    b.add('gun', cylX(0.62, 0.48, 0.42, 16), { p: [sx * (WING_X - 0.3), 0, 0] })
    b.add('gun', cylX(0.5, 0.5, 0.62, 16), { p: [sx * WING_X, 0, 0] })
    b.add('dark', cylX(0.3, 0.3, 0.7, 12), { p: [sx * WING_X, 0, 0] })
  }
  pylon.dispose()

  // ---- wings: flat hex panel + frame (rim + 6 spokes)
  const hex = hexPts(HEX_R)
  const panel = plateZY(hexPts(HEX_R - 0.06), 0.07, 0.01)
  for (const sx of [-1, 1]) {
    const x = sx * WING_X
    b.add('solar', panel.clone(), { p: [x, 0, 0] })
    for (let k = 0; k < 6; k++) {
      const [z0, y0] = hex[k]
      const [z1, y1] = hex[(k + 1) % 6]
      const len = Math.hypot(z1 - z0, y1 - y0)
      const a = Math.atan2(y1 - y0, z1 - z0)
      // rim bar (edge), box length along Z then rotated about X
      b.add('gun', bevelBox(0.26, 0.2, len + 0.12, 0.05), { p: [x, (y0 + y1) / 2, (z0 + z1) / 2], r: [-a, 0, 0] })
      // spoke from hub to vertex
      const sl = HEX_R - 0.55
      const sa = Math.atan2(y0, z0)
      b.add('gun', bevelBox(0.18, 0.13, sl, 0.04), { p: [x, Math.sin(sa) * (0.5 + sl / 2), Math.cos(sa) * (0.5 + sl / 2)], r: [-sa, 0, 0] })
      // inner ring segment at ~45% radius (secondary frame)
      const rr = HEX_R * 0.48
      const ia = sa + Math.PI / 6
      const segLen = rr * 2 * Math.sin(Math.PI / 6) * 1.04
      b.add('gun', bevelBox(0.12, 0.07, segLen, 0.02), {
        p: [x, Math.sin(ia) * rr * Math.cos(Math.PI / 6), Math.cos(ia) * rr * Math.cos(Math.PI / 6)],
        r: [-(ia + Math.PI / 2), 0, 0],
      })
      // vertex knuckles
      b.add('gun', cylX(0.17, 0.17, 0.3, 8), { p: [x, y0, z0] })
    }
  }
  panel.dispose()

  const parts = b.build()
  const gb = new GeoBatch(1)
  for (const x of [-0.27, 0.27]) gb.add('glass', new THREE.PlaneGeometry(0.3, 0.42), { p: [x, -0.05, -POD_R - 0.115], r: [0, Math.PI, 0] })
  const glow = gb.build().glass!
  cache = { parts, glow }
  return cache
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
/** every fighter shares one set of materials carrying the baked shadow map */
const BIND = shipBind(['hull', 'gun', 'dark', 'glass', 'solar'])

export function TieFighter({ thrust = 0.5, ...props }: TieFighterProps) {
  const geo = useMemo(buildTie, [])
  const glowMat = useMemo(() => engineGlowRedMat().clone(), [])
  useEffect(() => () => glowMat.dispose(), [glowMat])
  glowMat.emissiveIntensity = 0.2 + clamp01(thrust) * 3.2

  return (
    <group {...props}>
      {/* the Blender-built model (tools/blender/tie.py); the code-built one is the fallback */}
      <Baked name="tie" bind={BIND} fallback={
        <>
          {(Object.keys(geo.parts) as MatKey[]).map((k) => (
            <mesh key={k} geometry={geo.parts[k]} material={mat(k)} castShadow receiveShadow />
          ))}
        </>
      } />
      <mesh geometry={geo.glow} material={glowMat} />
      <EnginePlume at={PLUMES} radius={0.2} length={2.6} color="#ff4a34" thrust={thrust} />
    </group>
  )
}

export default TieFighter

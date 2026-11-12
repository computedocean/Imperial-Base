/**
 * Imperial transport shuttle — an original interpretation of a tri-wing
 * landing shuttle (tall dorsal fin, two folding lower wings).
 *
 * Conventions: metres, nose +Z, up +Y, ORIGIN = ground point under the hull
 * centre at the bottom of the deployed landing gear.
 */
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Baked, shipBind } from './Baked'
import { EnginePlume } from './Plume'
import { useFrame, type ThreeElements } from '@react-three/fiber'
import {
  GeoBatch, bevelBox, chamferRect, cylX, cylZ, engineGlowBlueMat, loft, mat, plateZY,
  type MatKey, type V2,
} from './materials'

export type ShuttleProps = ThreeElements['group'] & {
  /** 0 = wings spread down for flight, 1 = folded up vertical for landing */
  wingFold?: number
  /** 0 retracted .. 1 deployed */
  gear?: number
  /** 0 closed .. 1 lowered */
  ramp?: number
  /** 0..1 engine glow intensity */
  thrust?: number
  navLights?: boolean
}

// Key dimensions
const BELLY = 2.2 // hull bottom height above ground with gear down
const HULL_TOP = 6.0
const HINGE_X = 2.78
const HINGE_Y = 5.05
const WING_SPAN = 16.6
const FOLD_UP = THREE.MathUtils.degToRad(7) // landing: near vertical
const FLIGHT = THREE.MathUtils.degToRad(128) // flight: 38 deg below horizontal
const RAMP_HINGE_Z = 0.4
const RAMP_LEN = 5.2
const GEAR_TRAVEL = 2.15

type Parts = Partial<Record<MatKey, THREE.BufferGeometry>>
const PLUMES = [[-1.45, 4.0, -10.34], [1.45, 4.0, -10.34]] as const

interface ShuttleGeo { body: Parts; wing: Parts; gear: Parts; ramp: Parts; glow: THREE.BufferGeometry; nav: THREE.BufferGeometry }

let cache: ShuttleGeo | null = null
function buildShuttle(): ShuttleGeo {
  if (cache) return cache
  // ---------------------------------------------------------------- body
  const b = new GeoBatch(4)
  const sec = (z: number, w: number, yb: number, yt: number, c: number) => ({ z, pts: chamferRect(w, yb, yt, c) })
  b.add('hull', loft([
    sec(-7.3, 4.7, 2.55, 5.65, 0.6),
    sec(-6.6, 5.1, 2.25, 6.0, 0.75),
    sec(2.6, 5.1, 2.2, 6.0, 0.75),
    sec(4.4, 4.7, 2.2, 5.55, 0.65),
  ]))
  // cockpit nose — narrower, raked top, angular chin
  b.add('hull', loft([
    sec(4.3, 3.9, 2.25, 5.2, 0.55),
    sec(7.2, 3.5, 2.3, 4.75, 0.5),
    sec(9.2, 2.5, 2.65, 3.85, 0.42),
    sec(9.9, 1.5, 3.0, 3.45, 0.25),
  ]))
  // cheek fairings blending nose into body
  for (const sx of [-1, 1]) {
    b.add('hull', loft([
      { z: 2.0, pts: chamferRect(1.1, 2.4, 4.6, 0.3, sx * 2.0) },
      { z: 5.6, pts: chamferRect(0.8, 2.45, 4.1, 0.25, sx * 1.72) },
      { z: 7.4, pts: chamferRect(0.5, 2.6, 3.4, 0.15, sx * 1.55) },
    ]))
  }
  // dorsal spine & fin root fairing
  b.add('hull', loft([
    { z: -7.0, pts: chamferRect(1.4, 5.8, 6.55, 0.25) },
    { z: 1.0, pts: chamferRect(1.5, 5.8, 6.6, 0.3) },
    { z: 3.4, pts: chamferRect(0.9, 5.8, 6.05, 0.15) },
  ]))
  // dorsal fin (outline in z,y) — swept leading edge
  const fin: V2[] = [[-7.0, 6.2], [1.6, 6.2], [-3.6, 18.6], [-6.3, 18.6], [-7.6, 17.2]]
  b.add('hull', plateZY(fin, 0.55, 0.14))
  // fin leading-edge strake + tip cap
  b.add('gun', plateZY([[0.6, 6.4], [1.9, 6.4], [-3.3, 18.7], [-3.9, 18.7]], 0.3, 0.06))
  b.add('gun', bevelBox(0.7, 0.35, 3.3, 0.08), { p: [0, 18.75, -5.0] })
  // fin raised panels / strakes
  for (const [y, z0, z1] of [[9, -6.6, -0.6], [12, -6.8, -2.0], [15, -7.0, -3.4]] as const) {
    b.add('gun', plateZY([[z0, y], [z1, y], [z1 - 0.3, y + 0.5], [z0, y + 0.5]], 0.68, 0.05))
  }
  // engine block
  b.add('gun', loft([
    sec(-7.2, 5.2, 2.45, 5.75, 0.55),
    sec(-8.6, 5.6, 2.5, 5.7, 0.6),
    sec(-9.7, 5.3, 2.7, 5.4, 0.55),
  ]))
  // thruster nozzles + glow recess
  for (const x of [-1.45, 1.45]) {
    b.add('dark', cylZ(0.92, 1.02, 0.7, 16), { p: [x, 4.0, -9.95] })
    b.add('gun', cylZ(1.08, 1.08, 0.24, 16), { p: [x, 4.0, -9.75] })
  }
  b.add('dark', cylZ(0.45, 0.5, 0.5, 12), { p: [0, 3.1, -9.9] })
  // rear radiator vents on engine block sides
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      b.add('dark', bevelBox(0.12, 1.6, 0.18, 0.02), { p: [sx * 2.75, 4.1, -7.6 - i * 0.32] })
    }
    // side hull plating strips & greebles
    b.add('gun', bevelBox(0.12, 0.5, 9.0, 0.04), { p: [sx * 2.55, 3.0, -1.6] })
    b.add('gun', bevelBox(0.14, 0.35, 5.0, 0.04), { p: [sx * 2.56, 3.7, -3.4] })
    b.add('dark', bevelBox(0.1, 0.9, 1.4, 0.03), { p: [sx * 2.57, 4.4, 1.2] })
    // wing-root hinge housings
    b.add('gun', cylZ(0.48, 0.48, 7.6, 14), { p: [sx * HINGE_X, HINGE_Y, -2.4] })
    b.add('gun', cylZ(0.62, 0.62, 0.5, 14), { p: [sx * HINGE_X, HINGE_Y, 1.5] })
    b.add('gun', cylZ(0.62, 0.62, 0.5, 14), { p: [sx * HINGE_X, HINGE_Y, -6.3] })
    // chin laser cannons
    b.add('gun', cylZ(0.13, 0.13, 2.2, 8), { p: [sx * 0.7, 2.55, 10.0] })
    b.add('gun', bevelBox(0.45, 0.4, 1.0, 0.06), { p: [sx * 0.7, 2.6, 8.9] })
    // blaster pods on body flanks (forward)
    b.add('gun', cylZ(0.12, 0.12, 1.8, 8), { p: [sx * 2.2, 2.45, 5.2] })
  }
  // belly plating and gear bays
  b.add('gun', bevelBox(3.4, 0.14, 8.0, 0.05), { p: [0, 2.17, -3.5] })
  for (const [x, z] of [[0, 7.0], [-2.0, -4.6], [2.0, -4.6]] as const) {
    b.add('dark', bevelBox(1.4, 0.12, 1.5, 0.03), { p: [x, z > 0 ? 2.26 : 2.16, z] })
  }
  // ramp doorway recess (dark, revealed when ramp lowers)
  b.add('dark', bevelBox(2.3, 0.1, RAMP_LEN - 0.1, 0.02), { p: [0, BELLY - 0.02, RAMP_HINGE_Z + RAMP_LEN / 2] })
  // dorsal sensor dome + antenna
  b.add('gun', new THREE.SphereGeometry(0.4, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), { p: [0, 6.55, 2.6] })
  b.add('gun', cylZ(0.05, 0.05, 2.4, 5), { p: [0, 18.75, -2.4] })
  // cockpit windows on raked nose top + sides
  const slope = Math.atan2(4.75 - 3.85, 9.2 - 7.2)
  for (const x of [-0.85, 0, 0.85]) {
    b.add('glass', bevelBox(0.72, 0.06, 1.55, 0.03), { p: [x, 4.33, 8.15], r: [slope, 0, 0] })
  }
  for (const sx of [-1, 1]) {
    b.add('glass', bevelBox(0.06, 0.45, 1.3, 0.02), { p: [sx * 1.55, 4.05, 7.7], r: [0, sx * -0.12, 0] })
  }
  b.add('glass', bevelBox(1.0, 0.25, 0.06, 0.02), { p: [0, 3.55, 9.6], r: [-0.55, 0, 0] })
  const body = b.build()

  // ---------------------------------------------------------------- wing (local: hinge at origin, span +Y, chord Z)
  const w = new GeoBatch(4)
  const wingOutline: V2[] = [[-6.3, 0.2], [2.2, 0.2], [-2.6, WING_SPAN], [-7.0, WING_SPAN], [-7.4, WING_SPAN - 1.4]]
  w.add('hull', plateZY(wingOutline, 0.42, 0.12))
  // trailing-edge flap and leading-edge strip
  w.add('gun', plateZY([[-7.0, 1.2], [-6.0, 1.2], [-6.8, WING_SPAN - 1.6], [-7.6, WING_SPAN - 1.6]], 0.3, 0.05))
  w.add('gun', plateZY([[1.6, 0.4], [2.35, 0.4], [-2.4, WING_SPAN - 0.1], [-3.0, WING_SPAN - 0.1]], 0.26, 0.05))
  // raised panels both sides
  for (const [s0, s1, z0, z1] of [[2.0, 5.5, -5.3, 0.4], [6.5, 9.5, -5.8, -1.3], [10.4, 13.6, -6.2, -2.4]] as const) {
    w.add('hull', plateZY([[z0, s0], [z1, s0], [z1 - 0.8, s1], [z0, s1]], 0.52, 0.05))
  }
  // root hinge knuckles
  w.add('dark', cylZ(0.3, 0.3, 8.2, 10), { p: [0, 0.25, -2.1] })
  // wingtip laser cannon
  w.add('gun', cylZ(0.17, 0.17, 3.2, 10), { p: [0, WING_SPAN - 0.15, -3.3] })
  w.add('gun', cylZ(0.08, 0.08, 1.6, 8), { p: [0, WING_SPAN - 0.15, -1.0] })
  const wing = w.build()

  // ---------------------------------------------------------------- landing gear (deployed pose; translated up to retract)
  const g = new GeoBatch(2)
  for (const [x, z] of [[0, 7.0], [-2.0, -4.6], [2.0, -4.6]] as const) {
    g.add('gun', cylZ(0.2, 0.2, 2.0, 10), { p: [x, 1.55, z], r: [Math.PI / 2, 0, 0] }) // upper strut (vertical)
    g.add('hull', cylZ(0.13, 0.13, 1.2, 8), { p: [x, 0.75, z], r: [Math.PI / 2, 0, 0] }) // oleo
    g.add('dark', cylZ(0.58, 0.62, 0.16, 16), { p: [x, 0.08, z], r: [Math.PI / 2, 0, 0] }) // foot pad
    g.add('gun', cylZ(0.3, 0.3, 0.2, 10), { p: [x, 0.25, z], r: [Math.PI / 2, 0, 0] })
    g.add('gun', bevelBox(0.12, 1.6, 0.12, 0.02), { p: [x, 1.3, z + (z > 0 ? -0.45 : 0.45)], r: [z > 0 ? 0.35 : -0.35, 0, 0] }) // drag brace
  }
  const gear = g.build()

  // ---------------------------------------------------------------- ramp (local: hinge at origin, extends +Z)
  const r = new GeoBatch(2)
  r.add('gun', bevelBox(2.2, 0.16, RAMP_LEN, 0.04), { p: [0, -0.08, RAMP_LEN / 2] })
  for (let i = 0; i < 8; i++) r.add('dark', bevelBox(1.9, 0.04, 0.12, 0.01), { p: [0, 0.02, 0.5 + i * 0.6] }) // treads
  for (const sx of [-1, 1]) r.add('gun', bevelBox(0.1, 0.4, RAMP_LEN - 0.4, 0.03), { p: [sx * 1.05, 0.18, RAMP_LEN / 2] }) // side rails
  const ramp = r.build()

  // glow discs facing -Z
  const gb = new GeoBatch(1)
  for (const x of [-1.45, 1.45]) gb.add('glass', new THREE.CircleGeometry(0.88, 20), { p: [x, 4.0, -10.31], r: [0, Math.PI, 0] })
  const glowGeo = gb.build().glass!
  const nav = new THREE.SphereGeometry(0.14, 8, 6)

  cache = { body, wing, gear, ramp, glow: glowGeo, nav }
  return cache
}

function PartMeshes({ parts }: { parts: Parts }) {
  return (
    <>
      {(Object.keys(parts) as MatKey[]).map((k) => (
        <mesh key={k} geometry={parts[k]} material={mat(k)} castShadow receiveShadow />
      ))}
    </>
  )
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const BODY_BIND = shipBind(['hull', 'gun', 'dark', 'glass'])
const WING_BIND = shipBind(['hull', 'gun', 'dark', 'glass'])

export function Shuttle({ wingFold = 1, gear = 1, ramp = 0, thrust = 0.3, navLights = true, ...props }: ShuttleProps) {
  const geo = useMemo(buildShuttle, [])
  const glowMat = useMemo(() => engineGlowBlueMat().clone(), [])
  useEffect(() => () => glowMat.dispose(), [glowMat])
  glowMat.emissiveIntensity = 0.25 + clamp01(thrust) * 3.2

  const angle = THREE.MathUtils.lerp(FLIGHT, FOLD_UP, clamp01(wingFold))
  const rampAngle = clamp01(ramp) * Math.asin((BELLY - 0.05) / RAMP_LEN)
  const gearY = (1 - clamp01(gear)) * GEAR_TRAVEL

  const blink = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!blink.current) return
    const t = clock.elapsedTime % 1.6
    blink.current.visible = navLights && t < 0.12
  })

  return (
    <group {...props}>
      {/* Blender-built hull and wing (tools/blender/shuttle.py); the code-built ones are the fallback */}
      <Baked name="shuttle_body" bind={BODY_BIND} fallback={<PartMeshes parts={geo.body} />} />
      <mesh geometry={geo.glow} material={glowMat} />
      <EnginePlume at={PLUMES} radius={0.84} length={10} color="#5a96ff" thrust={thrust} />
      {/* wings: +X side and mirrored -X side */}
      {[1, -1].map((sx) => (
        <group key={sx} position={[sx * HINGE_X, HINGE_Y, 0]} rotation={[0, 0, -sx * angle]} scale={[sx, 1, 1]}>
          <Baked name="shuttle_wing" bind={WING_BIND} fallback={<PartMeshes parts={geo.wing} />} />
          {navLights && <mesh geometry={geo.nav} material={mat(sx > 0 ? 'navRed' : 'navWhite')} position={[0, WING_SPAN + 0.1, -4.8]} />}
        </group>
      ))}
      <group position={[0, gearY, 0]} visible={gear > 0.001}>
        <PartMeshes parts={geo.gear} />
      </group>
      <group position={[0, BELLY, RAMP_HINGE_Z]} rotation={[rampAngle, 0, 0]}>
        <PartMeshes parts={geo.ramp} />
      </group>
      <group ref={blink}>
        <mesh geometry={geo.nav} material={mat('navWhite')} position={[0, 18.95, -5.0]} />
        <mesh geometry={geo.nav} material={mat('navRed')} position={[0, 2.05, -8.8]} />
      </group>
    </group>
  )
}

export default Shuttle

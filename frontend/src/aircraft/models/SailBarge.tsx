/**
 * Hutt sail barge — original interpretation of the crime lord's desert pleasure craft: a long,
 * heavy hull with rows of shuttered windows, an open upper deck with a stern cabin and a deck gun,
 * steering vanes, and two great orange sails slung over the deck on masts.
 *
 * Conventions: metres, bow +Z, up +Y, ORIGIN = keel line amidships (it hovers; nothing touches the ground).
 */
import { useMemo } from 'react'
import * as THREE from 'three'
import type { ThreeElements } from '@react-three/fiber'
import { timberTexture } from '../../world/surface'
import { Baked, type Bind } from './Baked'
import { GeoBatch, bevelBox, chamferRect, cylZ, loft, plateZY, type MatKey } from './materials'

type Parts = Partial<Record<MatKey, THREE.BufferGeometry>>
let cache: Parts | null = null

function buildBarge() {
  if (cache) return cache
  const sec = (z: number, w: number, yb: number, yt: number, c: number) => ({ z, pts: chamferRect(w, yb, yt, c) })
  const b = new GeoBatch(6)
  // hull: 'hull' key = weathered brown plating (see the material map below)
  b.add('hull', loft([
    sec(-16, 6.2, 1.0, 5.4, 1.1),
    sec(-10, 8.6, 0.0, 5.8, 1.5),
    sec(4, 9.0, -0.3, 5.5, 1.5),
    sec(11, 6.2, 0.5, 4.9, 1.2),
    sec(16.5, 1.7, 1.9, 4.0, 0.5),
  ]))
  // armoured prow and keel strake
  b.add('gun', loft([sec(13.5, 4.4, 1.0, 2.0, 0.4), sec(17.2, 0.9, 2.2, 2.8, 0.2)]))
  b.add('gun', bevelBox(1.6, 0.7, 26, 0.2), { p: [0, -0.1, -1.5] })
  // rows of shuttered windows down both sides, and a rubbing strake
  for (const sx of [1, -1]) {
    for (let i = 0; i < 9; i++) b.add('dark', bevelBox(0.16, 0.95, 1.5, 0.04), { p: [sx * 4.42, 3.3, -10 + i * 2.5] })
    b.add('gun', bevelBox(0.22, 0.3, 25, 0.05), { p: [sx * 4.45, 4.5, -2] })
    b.add('gun', bevelBox(0.22, 0.25, 23, 0.05), { p: [sx * 4.4, 2.2, -2.5] })
    // deck rail
    b.add('gun', bevelBox(0.14, 0.14, 22, 0.03), { p: [sx * 3.9, 7.0, 0.5] })
    for (let i = 0; i < 8; i++) b.add('gun', bevelBox(0.12, 1.2, 0.12, 0.02), { p: [sx * 3.9, 6.4, -10 + i * 3] })
    // steering vanes at the stern
    b.add('gun', plateZY([[-19.5, 2.4], [-15.5, 2.0], [-15.5, 5.2], [-18.6, 6.4]], 0.3, 0.06), { p: [sx * 2.6, 0, 0], r: [0, sx * -0.16, 0] })
    // repulsor pods under the hull
    for (const z of [-9, 5]) b.add('dark', cylZ(0.9, 0.9, 4.5, 10), { p: [sx * 2.6, 0.0, z] })
  }
  // upper deck, stern cabin with its own windows, deck gun forward
  b.add('gun', bevelBox(7.8, 0.3, 25, 0.08), { p: [0, 5.75, -1.5] })
  b.add('hull', bevelBox(6.6, 2.7, 7.4, 0.5), { p: [0, 7.2, -11] })
  b.add('gun', bevelBox(7.0, 0.35, 7.9, 0.1), { p: [0, 8.7, -11] })
  for (const sx of [1, -1]) for (let i = 0; i < 3; i++) b.add('dark', bevelBox(0.14, 0.9, 1.3, 0.03), { p: [sx * 3.32, 7.3, -13 + i * 2.1] })
  b.add('dark', bevelBox(3.4, 0.9, 0.14, 0.03), { p: [0, 7.3, -7.28] })
  b.add('gun', new THREE.CylinderGeometry(0.5, 0.7, 0.8, 10), { p: [0, 6.3, 9] })
  b.add('dark', cylZ(0.14, 0.14, 3.2, 8), { p: [0, 6.9, 10.4] })
  b.add('gun', bevelBox(0.7, 0.6, 1.0, 0.1), { p: [0, 6.9, 8.8] })
  // masts, yards and the two sails ('stripe' key = sailcloth)
  for (const [z, h, tilt] of [[-3, 9.2, -0.1], [5.5, 7.8, 0.1]] as const) {
    b.add('dark', new THREE.CylinderGeometry(0.16, 0.24, h, 8), { p: [0, 5.9 + h / 2, z] })
    b.add('dark', bevelBox(12.6, 0.2, 0.2, 0.04), { p: [0, 5.9 + h, z] })
    for (const sx of [1, -1]) {
      // each half-sail droops outboard from the yard
      b.add('stripe', bevelBox(6.2, 0.1, 7.6, 0.03), { p: [sx * 3.25, 5.55 + h - 0.42, z], r: [tilt, 0, sx * -0.15] })
      b.add('dark', new THREE.CylinderGeometry(0.05, 0.05, h - 1.4, 5), { p: [sx * 6.2, 5.9 + (h - 1.4) / 2 + 0.5, z + 3.2], r: [0.38, 0, sx * 0.34] })
    }
  }
  cache = b.build()
  return cache
}

export function SailBarge(props: ThreeElements['group']) {
  const geo = useMemo(buildBarge, [])
  const m = useMemo(() => ({
    hull: new THREE.MeshStandardMaterial({ color: '#8a5c36', map: timberTexture(), bumpMap: timberTexture(), bumpScale: 1.2, roughness: 0.85, metalness: 0.15 }),
    gun: new THREE.MeshStandardMaterial({ color: '#5a3f27', map: timberTexture(), roughness: 0.8, metalness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: '#17110c', roughness: 0.7, metalness: 0.4 }),
    stripe: new THREE.MeshStandardMaterial({ color: '#c8742c', roughness: 0.95, metalness: 0, side: THREE.DoubleSide }),
    // lanterns and lit cabin windows (Blender model only)
    lamp: new THREE.MeshStandardMaterial({ color: '#2a1a0c', emissive: '#ffb35c', emissiveIntensity: 2.6, roughness: 0.6 }),
  }) as Record<string, THREE.Material>, [])
  // copies, so the baked shadow map never lands on the materials the fallback uses
  const bind = useMemo<Bind>(() => {
    const own = new Map<string, THREE.Material>()
    return (name) => {
      const key = m[name] ? name : 'gun'
      if (!own.has(key)) own.set(key, m[key].clone())
      return { material: own.get(key)!, ao: key !== 'lamp' }
    }
  }, [m])
  return (
    <group {...props}>
      {/* the Blender-built model (tools/blender/sailbarge.py); the code-built one is the fallback */}
      <Baked name="sailbarge" bind={bind} fallback={
        <>
          {(Object.keys(geo) as MatKey[]).map((key) => (
            <mesh key={key} geometry={geo[key]} material={m[key] ?? m.gun} castShadow receiveShadow />
          ))}
        </>
      } />
    </group>
  )
}

export default SailBarge

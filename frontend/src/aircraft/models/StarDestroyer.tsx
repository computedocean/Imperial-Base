/**
 * Star destroyer — original interpretation of the dagger-shaped capital ship: a long wedge hull
 * with a trench along its edge, stepped superstructure terraces, a bridge tower with twin sensor
 * globes, and a bank of engines across the stern.
 *
 * Conventions: metres, bow +Z, up +Y, ORIGIN = centre of the hull. Built 1600 m long.
 * It is far away and above the weather, so its materials ignore scene fog.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { ThreeElements } from '@react-three/fiber'
import { GeoBatch, bevelBox, chamferRect, cylZ, loft, type MatKey } from './materials'

export type StarDestroyerProps = ThreeElements['group'] & { thrust?: number }

type Parts = Partial<Record<MatKey, THREE.BufferGeometry>>
let cache: { body: Parts; glow: THREE.BufferGeometry } | null = null
const ENGINES: [number, number, number][] = [[0, -6, 82], [210, -6, 82], [-210, -6, 82], [105, 44, 36], [-105, 44, 36], [320, -10, 30], [-320, -10, 30]]

function buildDestroyer() {
  if (cache) return cache
  const sec = (z: number, w: number, yb: number, yt: number, c: number) => ({ z, pts: chamferRect(w, yb, yt, c) })
  const b = new GeoBatch(120)
  // the wedge: upper and lower hull plates meeting at a trench along the edge
  b.add('hull', loft([sec(-800, 940, 8, 64, 30), sec(800, 10, 1.5, 6, 2)]))
  b.add('hull', loft([sec(-800, 940, -58, -8, 26), sec(800, 10, -6, -1.5, 2)]))
  b.add('dark', loft([sec(-800, 918, -8, 8, 3), sec(796, 6, -1.5, 1.5, 0.5)]))
  // superstructure terraces stepping up towards the stern
  b.add('hull', loft([sec(-800, 600, 64, 118, 22), sec(250, 70, 30, 46, 8)]))
  b.add('hull', loft([sec(-790, 380, 118, 176, 18), sec(-140, 90, 78, 96, 8)]))
  b.add('gun', loft([sec(-780, 250, 176, 226, 14), sec(-420, 110, 140, 160, 8)]))
  // surface detail: raised blocks along the terraces and the dorsal spine
  for (let i = 0; i < 14; i++) {
    const z = -760 + i * 62
    const half = 250 - i * 14
    b.add('gun', bevelBox(46, 14, 34, 4), { p: [half * 0.55, 122 - i * 5.2, z] })
    b.add('gun', bevelBox(38, 12, 28, 4), { p: [-half * 0.5, 120 - i * 5.2, z + 20] })
  }
  for (let i = 0; i < 9; i++) b.add('dark', bevelBox(60, 6, 14, 2), { p: [0, 66 - i * 5.6, -120 + i * 92] })
  // bridge tower: neck, command bar and the two sensor globes
  b.add('hull', bevelBox(120, 110, 96, 12), { p: [0, 280, -640] })
  b.add('gun', bevelBox(150, 18, 110, 5), { p: [0, 250, -640] })
  b.add('hull', bevelBox(400, 66, 92, 14), { p: [0, 366, -640] })
  b.add('dark', bevelBox(360, 8, 6, 2), { p: [0, 372, -593] }) // bridge windows
  b.add('gun', bevelBox(60, 26, 70, 6), { p: [0, 410, -640] })
  for (const sx of [1, -1]) {
    b.add('gun', new THREE.CylinderGeometry(14, 20, 26, 10), { p: [sx * 150, 408, -640] })
    b.add('hull', new THREE.SphereGeometry(36, 18, 12), { p: [sx * 150, 444, -640] })
  }
  // ventral hangar bay and the reactor bulge
  b.add('dark', bevelBox(210, 10, 260, 3), { p: [0, -44, -200] })
  b.add('gun', new THREE.SphereGeometry(105, 20, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), { p: [0, -40, -470], s: [1, 0.55, 1] })
  // engines across the stern
  for (const [x, y, r] of ENGINES) {
    b.add('gun', cylZ(r * 1.05, r * 0.85, 90, 20), { p: [x, y, -838] })
    b.add('dark', cylZ(r * 0.8, r * 0.8, 20, 18), { p: [x, y, -876] })
  }
  b.add('gun', bevelBox(920, 122, 18, 6), { p: [0, 3, -800] })
  const body = b.build()

  const discs = ENGINES.map(([x, y, r]) => {
    const g = new THREE.CircleGeometry(r * 0.76, 20)
    g.rotateY(Math.PI)
    g.translate(x, y, -887)
    return g
  })
  // merge the engine discs by hand (all the same layout)
  const pos: number[] = []
  for (const g of discs) {
    const ng = g.toNonIndexed()
    pos.push(...(ng.getAttribute('position').array as Float32Array))
    g.dispose(); ng.dispose()
  }
  const glow = new THREE.BufferGeometry()
  glow.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  cache = { body, glow }
  return cache
}

export function StarDestroyer({ thrust = 0.4, ...props }: StarDestroyerProps) {
  const geo = useMemo(buildDestroyer, [])
  const m = useMemo(() => ({
    hull: new THREE.MeshStandardMaterial({ color: '#aeb2b8', roughness: 0.6, metalness: 0.35, fog: false, emissive: '#2c3138', emissiveIntensity: 0.5 }),
    gun: new THREE.MeshStandardMaterial({ color: '#7c8188', roughness: 0.6, metalness: 0.45, fog: false, emissive: '#1c2026', emissiveIntensity: 0.5 }),
    dark: new THREE.MeshStandardMaterial({ color: '#23262b', roughness: 0.7, metalness: 0.4, fog: false }),
    glow: new THREE.MeshBasicMaterial({ color: '#9cc8ff', toneMapped: false, fog: false, side: THREE.DoubleSide }),
  }), [])
  useEffect(() => () => Object.values(m).forEach((x) => x.dispose()), [m])
  m.glow.color.setRGB(0.5 + thrust * 0.5, 0.7 + thrust * 0.3, 1).multiplyScalar(0.6 + thrust * 1.6)
  const mats: Partial<Record<MatKey, THREE.Material>> = { hull: m.hull, gun: m.gun, dark: m.dark }
  return (
    <group {...props}>
      {(Object.keys(geo.body) as MatKey[]).map((key) => (
        <mesh key={key} geometry={geo.body[key]} material={mats[key] ?? m.gun} frustumCulled={false} />
      ))}
      <mesh geometry={geo.glow} material={m.glow} frustumCulled={false} />
    </group>
  )
}

export default StarDestroyer

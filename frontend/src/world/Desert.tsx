// The desert around the base: photo-scanned boulders scattered over the dunes and a ring of terraced mesas.
//   * Boulders: three Poly Haven CC0 scans (rock_a/b/c.glb, 1,500 triangles each), one instanced draw call per kind.
//   * Mesas: generated with Blender's A.N.T. Landscape extension (tools/blender/desert.py), with baked ambient
//     occlusion and a tiling Poly Haven cliff texture.
// On LOW quality, or if a file is missing, the simple code-built boulders are used and the mesas are left out.
import { useGLTF, useTexture } from '@react-three/drei'
import { Suspense, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Baked, ModelBoundary, plainGeometry, type Bind } from '../aircraft/models/Baked'
import { useStore } from '../state/store'
import { Rocks } from './Surroundings'
import { terrainHeight } from './layout'
import { rng } from './noise'

const url = (f: string) => `${import.meta.env.BASE_URL}models/${f}`
const ROCKS = ['rock_a', 'rock_b', 'rock_c'] as const

/** Where the boulders go: the same scatter the code-built rocks use (deterministic). */
function rockPlacements(count: number) {
  const r = rng(55)
  const out: { x: number; z: number; s: number; rx: number; ry: number; rz: number }[] = []
  while (out.length < count) {
    const a = r() * Math.PI * 2
    const d = 600 + Math.pow(r(), 0.7) * 2400
    const x = Math.cos(a) * d
    const z = Math.sin(a) * d
    if (Math.abs(z) < 30 && x > 400) continue // keep the outpost road clear
    out.push({ x, z, s: 1.5 + Math.pow(r(), 3) * 14, rx: r() * 0.5, ry: r() * 6, rz: r() * 0.5 })
  }
  return out
}

function ScannedRocks({ count }: { count: number }) {
  const gltfs = useGLTF(ROCKS.map((n) => url(`${n}.glb`)))
  const refs = useRef<(THREE.InstancedMesh | null)[]>([])
  const kinds = useMemo(() => gltfs.map((g) => {
    let mesh: THREE.Mesh | null = null
    g.scene.traverse((o) => { if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh })
    const m = (mesh!.material as THREE.MeshStandardMaterial).clone()
    m.roughness = 0.95
    m.metalness = 0
    m.envMapIntensity = 0.5
    m.color.set('#ecd9c0') // warm the scans towards the colour of the sand they sit in
    return { geometry: plainGeometry(mesh!), material: m }
  }), [gltfs])
  const per = Math.ceil(count / ROCKS.length)
  useLayoutEffect(() => {
    const o = new THREE.Object3D()
    const n = new Array(ROCKS.length).fill(0)
    rockPlacements(count).forEach((p, i) => {
      const k = i % ROCKS.length
      const mesh = refs.current[k]
      if (!mesh) return
      // the scans are 1 m across with the origin under the base; bed each one a little into the sand
      const size = p.s * 2.3
      o.position.set(p.x, terrainHeight(p.x, p.z) - size * 0.08, p.z)
      o.rotation.set(p.rx * 0.4, p.ry, p.rz * 0.4)
      o.scale.set(size, size * (0.85 + (i % 5) * 0.09), size)
      o.updateMatrix()
      mesh.setMatrixAt(n[k]++, o.matrix)
    })
    refs.current.forEach((mesh, k) => {
      if (!mesh) return
      mesh.count = n[k]
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    })
  }, [count, kinds])
  return (
    <>
      {kinds.map((k, i) => (
        <instancedMesh key={ROCKS[i]} ref={(o) => { refs.current[i] = o }} args={[k.geometry, k.material, per]} castShadow receiveShadow frustumCulled={false} />
      ))}
    </>
  )
}

/** Boulders on the dunes. */
export function DesertRocks({ count }: { count: number }) {
  const low = useStore((s) => s.quality === 'low')
  const simple = <Rocks count={count} />
  if (low) return simple
  return (
    <ModelBoundary fallback={simple}>
      <Suspense fallback={simple}>
        <ScannedRocks count={count} />
      </Suspense>
    </ModelBoundary>
  )
}

/**
 * Mesa placements: centre, width, height, heading and which of the three shapes. They stand outside the sail
 * barge's circle (780 m) and clear of the outpost road, which leaves by the valley to the east.
 */
export const MESAS: { x: number; z: number; width: number; height: number; rotY: number; kind: 'a' | 'b' | 'c' }[] = [
  { x: 462, z: 1269, width: 420, height: 105, rotY: 0.4, kind: 'a' },
  { x: -975, z: 1393, width: 520, height: 140, rotY: 1.9, kind: 'c' },
  { x: -1207, z: 324, width: 340, height: 85, rotY: 2.7, kind: 'b' },
  { x: -1556, z: -1090, width: 600, height: 150, rotY: 4.1, kind: 'a' },
  { x: -336, z: -1256, width: 380, height: 95, rotY: 5.2, kind: 'c' },
  { x: 825, z: -1429, width: 480, height: 120, rotY: 0.9, kind: 'b' },
  { x: 1133, z: -528, width: 320, height: 80, rotY: 3.3, kind: 'a' },
]
/** Height of the flat top in each unit model (see SPECS in tools/blender/desert.py). */
const TOP = { a: 0.42, b: 0.36, c: 0.5 }

/** Lowest ground under a mesa's footprint, so its foot is always buried. */
export function mesaBase(m: { x: number; z: number; width: number }) {
  let low = terrainHeight(m.x, m.z)
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    low = Math.min(low, terrainHeight(m.x + Math.cos(a) * m.width * 0.5, m.z + Math.sin(a) * m.width * 0.5))
  }
  return low - 3
}

function MesaModels() {
  const [diff, nor] = useTexture([url('cliff_diff.jpg'), url('cliff_nor.jpg')])
  const binds = useMemo(() => {
    for (const t of [diff, nor]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.anisotropy = 8
      t.needsUpdate = true
    }
    diff.colorSpace = THREE.SRGBColorSpace
    // one material per mesa: each carries its own baked shadow map
    return MESAS.map((): Bind => {
      const material = new THREE.MeshStandardMaterial({ map: diff, normalMap: nor, normalScale: new THREE.Vector2(1.4, 1.4), color: '#c9a684', roughness: 0.96, metalness: 0, envMapIntensity: 0.5 })
      return () => ({ material })
    })
  }, [diff, nor])
  return (
    <>
      {MESAS.map((m, i) => (
        <group key={i} position={[m.x, mesaBase(m), m.z]} rotation={[0, m.rotY, 0]} scale={[m.width / 2, m.height / TOP[m.kind], m.width / 2]}>
          <Baked name={`mesa_${m.kind}`} bind={binds[i]} fallback={null} />
        </group>
      ))}
    </>
  )
}

/** Terraced mesas standing out of the dunes around the base. */
export function Mesas() {
  const low = useStore((s) => s.quality === 'low')
  if (low) return null
  return (
    <ModelBoundary fallback={null}>
      <Suspense fallback={null}>
        <MesaModels />
      </Suspense>
    </ModelBoundary>
  )
}

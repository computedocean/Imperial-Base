import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Kit } from './kit'
import { KitMesh } from './Structures'
import { GATES, OUTPOST_ROAD, ROADS, SETTLEMENTS, terrainHeight } from './layout'
import { MAT } from './materials'
import { rng } from './noise'
import { makeTerrainSampler } from './terrainSampler'
import { roadTexture, softDotTexture } from './textures'

// ------------------------------------------------------------------ roads
function ribbon(pts: THREE.Vector3[], width: number, lift: number) {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  let dist = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    const dir = new THREE.Vector3().subVectors(b, a).setY(0).normalize()
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(width / 2)
    if (i > 0) dist += p.distanceTo(pts[i - 1])
    pos.push(p.x + side.x, p.y + lift, p.z + side.z, p.x - side.x, p.y + lift, p.z - side.z)
    uv.push(0, dist / width / 2, 1, dist / width / 2)
    if (i > 0) {
      const k = i * 2
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

function densify(poly: [number, number][], step: number, height: (x: number, z: number) => number) {
  const out: THREE.Vector3[] = []
  for (let i = 0; i < poly.length - 1; i++) {
    const [ax, az] = poly[i]
    const [bx, bz] = poly[i + 1]
    const L = Math.hypot(bx - ax, bz - az)
    const n = Math.max(1, Math.ceil(L / step))
    for (let s = 0; s < n; s++) {
      const t = s / n
      const x = ax + (bx - ax) * t
      const z = az + (bz - az) * t
      out.push(new THREE.Vector3(x, height(x, z), z))
    }
  }
  const [lx, lz] = poly[poly.length - 1]
  out.push(new THREE.Vector3(lx, height(lx, lz), lz))
  return out
}

export function Roads({ terrainSegments }: { terrainSegments: number }) {
  const { base, outpost } = useMemo(() => {
    const geos = ROADS.map((r) => ribbon(densify(r.pts, 1000, () => 0), r.width, 0.09))
    // long road out of the east gate, along the valley to the mining outpost — following the rendered terrain
    const sample = makeTerrainSampler(terrainSegments)
    const curve = new THREE.CatmullRomCurve3(OUTPOST_ROAD.map(([x, z]) => new THREE.Vector3(x, 0, z)))
    const pts = curve.getSpacedPoints(260).map((p) => new THREE.Vector3(p.x, 0, p.z))
    const outpostPts = pts.map((p) => {
      // max of a few samples across the road width so it never sinks into the slope
      let h = -Infinity
      for (const o of [-6, 0, 6]) for (const q of [-6, 0, 6]) h = Math.max(h, sample(p.x + o, p.z + q))
      return new THREE.Vector3(p.x, h, p.z)
    })
    return { base: geos, outpost: ribbon(outpostPts, 12, 0.35) }
  }, [terrainSegments])
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.9, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -4 }), [])
  const dirt = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8a6e55', roughness: 1, polygonOffset: true, polygonOffsetFactor: -4 }), [])
  return (
    <group name="roads">
      {base.map((g, i) => <mesh key={i} geometry={g} material={mat} receiveShadow />)}
      <mesh geometry={outpost} material={dirt} receiveShadow />
    </group>
  )
}

// ------------------------------------------------------------------ distant settlements / outpost
export function Settlements({ terrainSegments }: { terrainSegments: number }) {
  const build = useMemo(() => () => {
    const sample = makeTerrainSampler(terrainSegments)
    const k = new Kit()
    for (const s of SETTLEMENTS) {
      const r = rng(Math.floor(s.x + s.z))
      const n = Math.round(10 * s.size)
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2
        const d = r() * 140 * s.size
        const x = s.x + Math.cos(a) * d
        const z = s.z + Math.sin(a) * d
        const y = sample(x, z) - 1
        if (r() > 0.45) k.sphere('sand', 8 + r() * 10, [x, y, z], 16, true)
        else k.box('rust', [10 + r() * 14, 6 + r() * 10, 10 + r() * 14], [x, y, z], r() * 3)
      }
      const y = sample(s.x, s.z)
      k.cyl('rust', 2, 3, 36 * s.size + 12, [s.x, y, s.z], 8)
      k.box('amber', [2, 2, 2], [s.x, y + 36 * s.size + 12, s.z])
      if (s.name.startsWith('Mining')) {
        for (let i = 0; i < 4; i++) k.cyl('rust', 6, 7, 14, [s.x + 60 + i * 15, sample(s.x + 60 + i * 15, s.z - 40), s.z - 40], 12)
        k.boxR('dark', [3, 3, 90], [s.x + 40, sample(s.x, s.z) + 30, s.z - 20], [0.35, 0.8, 0])
      }
    }
    return k
  }, [terrainSegments])
  return <KitMesh key={terrainSegments} build={build} name="settlements" />
}

// ------------------------------------------------------------------ scattered boulders
export function Rocks({ count = 400 }: { count?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const geo = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(1, 1)
    const p = g.attributes.position as THREE.BufferAttribute
    const r = rng(8)
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.7 + r() * 0.6), p.getY(i) * (0.5 + r() * 0.4), p.getZ(i) * (0.7 + r() * 0.6))
    g.computeVertexNormals()
    return g
  }, [])
  useLayoutEffect(() => {
    {
      const m = ref.current
      if (!m) return
      const r = rng(55)
      const o = new THREE.Object3D()
      let n = 0
      while (n < count) {
        const a = r() * Math.PI * 2
        const d = 600 + Math.pow(r(), 0.7) * 2400
        const x = Math.cos(a) * d
        const z = Math.sin(a) * d
        if (Math.abs(z) < 30 && x > 400) continue // keep the outpost road clear
        const s = 1.5 + Math.pow(r(), 3) * 14
        o.position.set(x, terrainHeight(x, z) - s * 0.25, z)
        o.rotation.set(r() * 0.5, r() * 6, r() * 0.5)
        o.scale.setScalar(s)
        o.updateMatrix()
        m.setMatrixAt(n++, o.matrix)
      }
      m.instanceMatrix.needsUpdate = true
      m.computeBoundingSphere()
    }
  }, [count])
  return (
    <instancedMesh ref={ref} args={[geo, undefined, count]} castShadow receiveShadow frustumCulled={false}>
      <meshStandardMaterial color="#6d5646" roughness={0.95} />
    </instancedMesh>
  )
}

// ------------------------------------------------------------------ blinking beacons
/** Alternate warning-beacon intensity on the shared red/amber materials (cheap global blink). */
export function BeaconBlink() {
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    MAT.red().emissiveIntensity = Math.sin(t * 2.4) > 0.2 ? 5 : 0.6
    MAT.amber().emissiveIntensity = 2.4 + Math.sin(t * 1.3) * 0.6
    MAT.holo().emissiveIntensity = 2 + Math.sin(t * 3.1) * 0.25
    MAT.orangeGlow().emissiveIntensity = 2.8 + Math.sin(t * 2.2) * 0.7
    MAT.blueShield().emissiveIntensity = 2.6 + Math.sin(t * 1.7) * 0.5
  })
  return null
}

// ------------------------------------------------------------------ airborne dust
export function Dust({ count }: { count: number }) {
  const ref = useRef<THREE.Points>(null)
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const r = rng(4)
    const p = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      p[i * 3] = (r() - 0.5) * 1400
      p[i * 3 + 1] = r() * 60
      p[i * 3 + 2] = (r() - 0.5) * 1400
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3))
    return g
  }, [count])
  useFrame((_, dt) => {
    if (ref.current) {
      ref.current.position.x = (ref.current.position.x + dt * 6) % 200
      ref.current.position.z = (ref.current.position.z + dt * 2) % 200
    }
  })
  if (!count) return null
  return (
    <points ref={ref} geometry={geo} frustumCulled={false}>
      <pointsMaterial size={1.1} map={softDotTexture()} color="#e8cfa8" transparent opacity={0.4} depthWrite={false} sizeAttenuation />
    </points>
  )
}

/** Gate pylons' approach lights (static markers) */
export function GateLights() {
  return (
    <group>
      {GATES.map((g) => (
        <mesh key={g.id} position={[g.x, 0.2, g.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[30, 4]} />
          <meshBasicMaterial color="#d8a53c" transparent opacity={0.5} />
        </mesh>
      ))}
    </group>
  )
}

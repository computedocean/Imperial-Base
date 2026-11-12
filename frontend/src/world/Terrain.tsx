import { useMemo } from 'react'
import * as THREE from 'three'
import { PLATEAU_RADIUS, WORLD_SIZE, terrainHeight } from './layout'
import { fbm } from './noise'
import { groundDetailTexture, sandNormal } from './textures'

/** Planetary terrain: a centre-dense radial-ish grid (fine near the base, coarse at the horizon). */
export function Terrain({ segments }: { segments: number }) {
  const geometry = useMemo(() => {
    // Non-uniform grid: coordinates are warped so vertex density is highest at the centre.
    const n = segments
    const half = WORLD_SIZE / 2
    const warp = (t: number) => Math.sign(t) * Math.pow(Math.abs(t), 1.8) // t in [-1,1]
    const pos = new Float32Array((n + 1) * (n + 1) * 3)
    const col = new Float32Array((n + 1) * (n + 1) * 3)
    const uv = new Float32Array((n + 1) * (n + 1) * 2)
    const c = new THREE.Color()
    const sand = new THREE.Color('#cfa377')
    const dune = new THREE.Color('#e6c193')
    const rock = new THREE.Color('#6e5444')
    const darkRock = new THREE.Color('#3f3430')
    const base = new THREE.Color('#8f7a66')
    let k = 0
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const x = warp((i / n) * 2 - 1) * half
        const z = warp((j / n) * 2 - 1) * half
        const y = terrainHeight(x, z)
        pos[k * 3] = x
        pos[k * 3 + 1] = y
        pos[k * 3 + 2] = z
        uv[k * 2] = x / 18
        uv[k * 2 + 1] = z / 18
        // colour by slope + height + noise
        const e = 6
        const sx = terrainHeight(x + e, z) - terrainHeight(x - e, z)
        const sz = terrainHeight(x, z + e) - terrainHeight(x, z - e)
        const slope = Math.min(1, Math.hypot(sx, sz) / (2 * e) * 1.4)
        const r = Math.hypot(x, z)
        const n1 = fbm(x * 0.003, z * 0.003, 3) * 0.5 + 0.5
        c.copy(sand).lerp(dune, n1)
        c.lerp(rock, Math.min(1, slope * 1.6))
        c.lerp(darkRock, Math.max(0, Math.min(1, (y - 380) / 500)) * 0.7)
        if (r < PLATEAU_RADIUS + 60) c.lerp(base, Math.max(0, 1 - (r - PLATEAU_RADIUS + 120) / 180) * 0.6)
        col[k * 3] = c.r
        col[k * 3 + 1] = c.g
        col[k * 3 + 2] = c.b
        k++
      }
    }
    const idx: number[] = []
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i
        const b = a + 1
        const d = a + (n + 1)
        const e = d + 1
        idx.push(a, d, b, b, d, e)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    g.setIndex(idx)
    g.computeVertexNormals()
    g.computeBoundingSphere()
    return g
  }, [segments])

  const material = useMemo(() => {
    // sand ripples (normal map) on top of the slope/height vertex colouring; env reflections kept low for dry sand
    const m = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.96, metalness: 0, map: groundDetailTexture(),
      normalMap: sandNormal(), normalScale: new THREE.Vector2(0.55, 0.55), envMapIntensity: 0.45,
    })
    return m
  }, [])

  return <mesh geometry={geometry} material={material} receiveShadow name="terrain" />
}

// Loader for ship models authored in Blender (tools/blender/*.py) and exported as GLB.
// Same contract as the hero buildings (world/HeroModels.tsx): the GLB carries only geometry with
//   uv  (TEXCOORD_0) — box projection for tiling surface textures
//   uv1 (TEXCOORD_1) — atlas for the baked ambient-occlusion map (public/models/<name>_ao.jpg)
// and its materials are placeholders: each is re-bound by NAME to a material the caller supplies.
// While loading, on LOW quality, or if a file is missing, the procedural fallback renders instead.
import { useGLTF, useTexture } from '@react-three/drei'
import { Component, Suspense, useMemo, type ReactNode } from 'react'
import * as THREE from 'three'
import { useStore } from '../../state/store'
import { mat, type MatKey } from './materials'

const url = (f: string) => `${import.meta.env.BASE_URL}models/${f}`

/** How much of the baked AO is multiplied into the albedo (direct light). 0 = aoMap only. */
const DIRECT_AO = 0.5

/**
 * Give a material the model's baked surface map (tools/blender/bkit.py, bake_ao). One greyscale channel carries
 *   value <= 0.75   ambient occlusion = value / 0.75 (crevices)
 *   value >  0.75   edge wear = (value - 0.75) / 0.25 (paint rubbed off exposed edges)
 * Standard aoMap only dims indirect light, so the occlusion is also multiplied into the albedo (by `directAO`):
 * crevices then read under direct sun without a real-time AO pass. Crevices also gather a little sand-coloured
 * dust, and worn edges show brighter, smoother bare material.
 */
export function withBakedAO<T extends THREE.Material>(material: T, ao: THREE.Texture, directAO = DIRECT_AO): T {
  const m = material as unknown as THREE.MeshStandardMaterial
  if (!(m as any).isMeshStandardMaterial) return material
  m.aoMap = ao
  m.aoMapIntensity = 1
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uDirectAO = { value: directAO }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uDirectAO;\nfloat bakedAO = 1.0;\nfloat bakedWear = 0.0;')
      .replace('#include <map_fragment>', `#include <map_fragment>
#ifdef USE_AOMAP
  float bakedV = texture2D(aoMap, vAoMapUv).r;
  bakedAO = min(bakedV / 0.75, 1.0);
  bakedWear = smoothstep(0.1, 0.62, max(bakedV - 0.75, 0.0) / 0.25);
  diffuseColor.rgb *= mix(1.0, bakedAO, uDirectAO);
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.95, 0.85, 0.72), (1.0 - bakedAO) * 0.55);
  diffuseColor.rgb = mix(diffuseColor.rgb, min(diffuseColor.rgb * 1.5 + 0.07, vec3(1.0)), bakedWear * 0.6);
#endif`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n#ifdef USE_AOMAP\n  roughnessFactor *= mix(1.0, 0.6, bakedWear);\n#endif')
      // indirect light uses the decoded occlusion, not the raw channel
      .replace('#include <aomap_fragment>', THREE.ShaderChunk.aomap_fragment.replace(/texture2D\(\s*aoMap\s*,\s*vAoMapUv\s*\)\.r/, 'bakedAO'))
  }
  m.customProgramCacheKey = () => `baked-surface-${directAO}`
  return material
}

/**
 * A mesh's geometry as plain float attributes in the model's own frame. The compressed GLBs store positions and
 * normals as scaled integers with the scale on the mesh node, so code that takes a geometry out of its node
 * (instancing, merging) must go through this first.
 */
export function plainGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
  mesh.updateWorldMatrix(true, false)
  const g = new THREE.BufferGeometry()
  for (const [name, attr] of Object.entries(mesh.geometry.attributes)) {
    const a = attr as THREE.BufferAttribute
    const n = a.itemSize
    const out = new Float32Array(a.count * n)
    for (let i = 0; i < a.count; i++) {
      out[i * n] = a.getX(i)
      if (n > 1) out[i * n + 1] = a.getY(i)
      if (n > 2) out[i * n + 2] = a.getZ(i)
      if (n > 3) out[i * n + 3] = a.getW(i)
    }
    g.setAttribute(name, new THREE.BufferAttribute(out, n))
  }
  if (mesh.geometry.index) g.setIndex(Array.from(mesh.geometry.index.array))
  g.applyMatrix4(mesh.matrixWorld)
  return g
}

export type Bind = (name: string) => { material: THREE.Material; ao?: boolean; shadows?: boolean }

/**
 * Binds a model's material names to this caller's OWN copies of the shared aircraft materials (the baked
 * shadow map is attached to them, so they cannot be shared between models). Unknown names fall back to `gun`.
 */
export function shipBind(keys: MatKey[], noAO: MatKey[] = ['glass', 'navRed', 'navWhite']): Bind {
  const own = new Map<MatKey, THREE.Material>()
  return (name) => {
    const key = (keys.includes(name as MatKey) ? name : 'gun') as MatKey
    if (!own.has(key)) own.set(key, mat(key).clone())
    return { material: own.get(key)!, ao: !noAO.includes(key) }
  }
}

function Model({ name, bind }: { name: string; bind: Bind }) {
  const gltf = useGLTF(url(`${name}.glb`))
  const ao = useTexture(url(`${name}_ao.jpg`))
  const object = useMemo(() => {
    ao.flipY = false // glTF UV convention
    ao.channel = 1
    ao.colorSpace = THREE.NoColorSpace
    ao.anisotropy = 4
    ao.needsUpdate = true
    const cache = new Map<string, { material: THREE.Material; shadows: boolean }>()
    const root = gltf.scene.clone(true)
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const key = ((mesh.material as THREE.Material).name || 'hull').replace(/\.\d+$/, '')
      let hit = cache.get(key)
      if (!hit) {
        const b = bind(key)
        hit = { material: b.ao === false ? b.material : withBakedAO(b.material, ao), shadows: b.shadows ?? true }
        cache.set(key, hit)
      }
      mesh.material = hit.material
      mesh.castShadow = hit.shadows
      mesh.receiveShadow = hit.shadows
      mesh.frustumCulled = false
    })
    return root
  }, [gltf, ao, bind])
  return <primitive object={object} />
}

/** Renders `fallback` instead of its children if they throw (a model file that is missing or broken). */
export class ModelBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(e: unknown) { console.warn('[baked-models] falling back to procedural geometry:', e) }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

/** A Blender-built model, with the procedural version as loading / LOW-quality / error fallback. */
export function Baked({ name, bind, fallback }: { name: string; bind: Bind; fallback: ReactNode }) {
  const low = useStore((s) => s.quality === 'low')
  if (low) return <>{fallback}</>
  return (
    <ModelBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <Model name={name} bind={bind} />
      </Suspense>
    </ModelBoundary>
  )
}

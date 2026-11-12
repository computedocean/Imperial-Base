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

const url = (f: string) => `${import.meta.env.BASE_URL}models/${f}`

/** How much of the baked AO is multiplied into the albedo (direct light). 0 = aoMap only. */
const DIRECT_AO = 0.5

/**
 * Give a material the baked ambient occlusion. Standard aoMap only dims indirect light, so the map is
 * also multiplied into the albedo: crevices then read under direct sun without a real-time AO pass.
 */
export function withBakedAO<T extends THREE.Material>(material: T, ao: THREE.Texture): T {
  const m = material as unknown as THREE.MeshStandardMaterial
  if (!(m as any).isMeshStandardMaterial) return material
  m.aoMap = ao
  m.aoMapIntensity = 1
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uDirectAO = { value: DIRECT_AO }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uDirectAO;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n#ifdef USE_AOMAP\n  diffuseColor.rgb *= mix(1.0, texture2D(aoMap, vAoMapUv).r, uDirectAO);\n#endif')
  }
  m.customProgramCacheKey = () => `baked-ao-${DIRECT_AO}`
  return material
}

export type Bind = (name: string) => { material: THREE.Material; ao?: boolean; shadows?: boolean }

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

class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
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
    <Fallback fallback={fallback}>
      <Suspense fallback={fallback}>
        <Model name={name} bind={bind} />
      </Suspense>
    </Fallback>
  )
}

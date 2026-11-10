// Hero building models authored in Blender (tools/blender/*.py) and exported as GLB.
// The GLB carries only geometry + two UV sets; materials are re-bound by name to the shared MAT
// palette so the art direction stays consistent with the procedural kit:
//   uv  (TEXCOORD_0) — world-metre box projection for the tiling panel textures
//   uv1 (TEXCOORD_1) — atlas for the baked ambient-occlusion map (public/models/<name>_ao.jpg)
// The AO map darkens indirect light (standard aoMap) and, partially, the albedo too, so crevices
// read under direct sunlight on low-end GPUs without any real-time AO pass.
// While loading, on LOW quality, or if the file is missing, the procedural kit version renders instead.
import { useGLTF, useTexture } from '@react-three/drei'
import { Component, Suspense, useMemo, type ReactNode } from 'react'
import * as THREE from 'three'
import { useStore } from '../state/store'
import { MAT, type MatKey } from './materials'

const url = (f: string) => `${import.meta.env.BASE_URL}models/${f}`

export const HERO_MODELS = ['citadel', 'citadel_crown', 'hangar'] as const
export type HeroName = (typeof HERO_MODELS)[number] | string

/** How much of the baked AO is multiplied into the albedo (direct light). 0 = aoMap only. */
const DIRECT_AO = 0.45

const EMISSIVE = new Set<MatKey>(['windows', 'red', 'amber', 'whiteLight', 'holo'])

function heroMaterial(key: MatKey, ao: THREE.Texture, cache: Map<string, THREE.Material>) {
  const hit = cache.get(key)
  if (hit) return hit
  const base = MAT[key]()
  if (EMISSIVE.has(key) || !(base instanceof THREE.MeshStandardMaterial)) {
    cache.set(key, base)
    return base
  }
  const m = base.clone()
  m.aoMap = ao
  m.aoMapIntensity = 1
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uDirectAO = { value: DIRECT_AO }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uDirectAO;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n#ifdef USE_AOMAP\n  diffuseColor.rgb *= mix(1.0, texture2D(aoMap, vAoMapUv).r, uDirectAO);\n#endif')
  }
  m.customProgramCacheKey = () => `hero-ao-${DIRECT_AO}`
  cache.set(key, m)
  return m
}

function HeroModel({ name }: { name: string }) {
  const gltf = useGLTF(url(`${name}.glb`))
  const ao = useTexture(url(`${name}_ao.jpg`))
  const object = useMemo(() => {
    ao.flipY = false // glTF UV convention
    ao.channel = 1
    ao.colorSpace = THREE.NoColorSpace
    ao.anisotropy = 4
    ao.needsUpdate = true
    const cache = new Map<string, THREE.Material>()
    const root = gltf.scene.clone(true)
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const src = mesh.material as THREE.Material
      const key = (src.name || 'hull').replace(/\.\d+$/, '') as MatKey
      const known = key in MAT
      mesh.material = heroMaterial(known ? key : 'hull', ao, cache)
      const emissive = EMISSIVE.has(key)
      mesh.castShadow = !emissive
      mesh.receiveShadow = !emissive
    })
    return root
  }, [gltf, ao])
  return <primitive object={object} />
}

class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(e: unknown) {
    console.warn('[hero-models] falling back to procedural geometry:', e)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** Blender hero model with the procedural kit version as loading / LOW-quality / error fallback. */
export function Hero({ name, fallback, group }: { name: string; fallback: ReactNode; group?: string }) {
  const low = useStore((s) => s.quality === 'low')
  if (low) return <>{fallback}</>
  return (
    <group name={group ?? name}>
      <Fallback fallback={fallback}>
        <Suspense fallback={fallback}>
          <HeroModel name={name} />
        </Suspense>
      </Fallback>
    </group>
  )
}

for (const n of HERO_MODELS) useGLTF.preload(url(`${n}.glb`))

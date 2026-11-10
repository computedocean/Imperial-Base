// Lighting, environment, atmosphere and post-processing for the exterior world, driven by the
// time-of-day preset (store.timeOfDay, `N` cycles) and scaled by the quality preset.
import { useFrame, useThree } from '@react-three/fiber'
import { Bloom, BrightnessContrast, EffectComposer, HueSaturation, N8AO, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { QUALITY, useStore } from '../state/store'
import { lampPlacements } from '../vehicles/propPlacement'
import { TOD } from './lighting'
import { MAT } from './materials'
import { applySkyPreset, createSkyMaterial } from './Sky'
import { lightPoolTexture, setTextureAnisotropy } from './textures'

const AO_TINT = new THREE.Color('#1a120c')
const _focus = new THREE.Vector3()
const _c = new THREE.Vector3()

/** Sun (or moon) with a shadow frustum that follows the area of interest and keeps texel density high. */
function Sun({ shadows, size, radius }: { shadows: boolean; size: number; radius: number }) {
  const light = useRef<THREE.DirectionalLight>(null)
  const { camera } = useThree()
  const target = useMemo(() => new THREE.Object3D(), [])
  const interior = useStore((s) => s.interior)
  const tod = useStore((s) => s.timeOfDay)
  const p = TOD[tod]
  useFrame(() => {
    const l = light.current
    if (!l) return
    camera.getWorldDirection(_focus)
    // focus point: where the view ray meets the ground, clamped to a sensible distance
    const reach = _focus.y < -0.05 ? Math.min(700, camera.position.y / -_focus.y) : Math.min(400, camera.position.y * 1.2 + 60)
    _c.copy(camera.position).addScaledVector(_focus, reach * 0.85)
    _c.y = 0
    _c.clampLength(0, 520)
    // half-extent scales with viewing distance: tight (crisp) close up, wide when overlooking the base
    const dist = Math.hypot(camera.position.y, reach)
    const half = interior ? 60 : THREE.MathUtils.clamp(dist * 0.62, 70, 480)
    // snap the frustum to whole shadow texels to stop shimmering while the camera moves
    const texel = (half * 2) / size
    _c.set(Math.round(_c.x / texel) * texel, 0, Math.round(_c.z / texel) * texel)
    target.position.copy(_c)
    l.position.copy(_c).addScaledVector(p.sunDir, 1200)
    l.target = target
    const cam = l.shadow.camera
    if (Math.abs(cam.right - half) > 0.5) {
      cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half
      cam.updateProjectionMatrix()
      // bias in world units ∝ texel size: no acne on the apron, no peter-panning at building feet
      l.shadow.normalBias = texel * 0.9
    }
  })
  return (
    <>
      <primitive object={target} />
      <directionalLight ref={light} color={p.sunColor} intensity={p.sunIntensity} castShadow={shadows}
        shadow-mapSize={[size, size]} shadow-camera-near={50} shadow-camera-far={2600} shadow-bias={-0.00015}
        shadow-normalBias={0.5} shadow-radius={radius} />
    </>
  )
}

/** Image-based lighting baked from the procedural sky (PMREM) whenever the time of day changes. */
function SkyEnvironment() {
  const { gl, scene } = useThree()
  const tod = useStore((s) => s.timeOfDay)
  useEffect(() => {
    const p = TOD[tod]
    const envScene = new THREE.Scene()
    const mat = createSkyMaterial(true)
    applySkyPreset(mat, p)
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat)
    envScene.add(sphere)
    // a warm ground disc so lower hemispheres pick up bounce light from the sand/ferrocrete
    const ground = new THREE.Mesh(new THREE.CircleGeometry(45, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(p.sky.ground).multiplyScalar(0.7) }))
    ground.position.y = -3
    envScene.add(ground)
    const pmrem = new THREE.PMREMGenerator(gl)
    const rt = pmrem.fromScene(envScene, 0, 0.1, 200)
    const prev = scene.environment
    scene.environment = rt.texture
    scene.environmentIntensity = p.envIntensity
    pmrem.dispose()
    sphere.geometry.dispose(); mat.dispose(); ground.geometry.dispose(); (ground.material as THREE.Material).dispose()
    return () => {
      if (scene.environment === rt.texture) scene.environment = prev ?? null
      rt.dispose()
    }
  }, [gl, scene, tod])
  return null
}

function Atmosphere() {
  const { scene, gl } = useThree()
  const interior = useStore((s) => s.interior)
  const tod = useStore((s) => s.timeOfDay)
  useEffect(() => {
    const p = TOD[tod]
    scene.fog = new THREE.FogExp2(p.fog, interior && interior !== 'command' ? 0.0005 : p.fogDensity)
    scene.background = new THREE.Color(p.fog)
    gl.toneMappingExposure = p.exposure
    MAT.windows().emissiveIntensity = p.windows
  }, [scene, gl, interior, tod])
  return null
}

/** Warm pools of light on the ground under every lamp (additive decals, one draw call; dusk/night only). */
function LightPools() {
  const tod = useStore((s) => s.timeOfDay)
  const strength = TOD[tod].lampPools
  const lamps = useMemo(() => lampPlacements(), [])
  const ref = useRef<THREE.InstancedMesh>(null)
  const geo = useMemo(() => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), [])
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: lightPoolTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -10, toneMapped: false }), [])
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const m = new THREE.Matrix4()
    lamps.forEach((l, i) => {
      // the lamp head hangs 2.2 m out along the arm (local +z rotated by rotY)
      const x = l.x + Math.sin(l.rotY) * 2.2
      const z = l.z + Math.cos(l.rotY) * 2.2
      m.makeScale(26, 1, 26).setPosition(x, 0.12, z)
      mesh.setMatrixAt(i, m)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [lamps, strength])
  mat.opacity = strength * 0.32
  if (strength <= 0) return null
  return <instancedMesh ref={ref} args={[geo, mat, lamps.length]} frustumCulled={false} renderOrder={2} />
}

/** `N` cycles golden hour → dusk → night (ignored while typing in inputs). */
function TimeOfDayHotkey() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return
      if (e.code === 'KeyN' && !e.ctrlKey && !e.metaKey && !e.altKey) useStore.getState().cycleTimeOfDay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return null
}

/** Post stack per quality: none (LOW) · SMAA + bloom + grade + vignette (MEDIUM) · + N8AO (HIGH/CINEMATIC). */
function PostStack() {
  const quality = useStore((s) => s.quality)
  const tod = useStore((s) => s.timeOfDay)
  const q = QUALITY[quality]
  const p = TOD[tod]
  if (q.post === 'none') return null
  const full = q.post === 'full'
  const effects = [
    // halfRes stays off: n8ao 2.0.1's half-res depth downsample target is incompatible with three r187 (crashes in setupRenderTarget)
    full && <N8AO key="ao" halfRes={false} quality={quality === 'cinematic' ? 'high' : 'low'} aoRadius={6} distanceFalloff={1.5} intensity={2.2} color={AO_TINT} />,
    <Bloom key="bloom" intensity={p.bloom} luminanceThreshold={0.92} luminanceSmoothing={0.25} mipmapBlur levels={full ? 7 : 5} radius={0.72} />,
    <HueSaturation key="sat" saturation={p.saturation} />,
    <BrightnessContrast key="bc" contrast={p.contrast} />,
    // the composer disables renderer tone mapping, so it is applied here (exposure still comes from gl.toneMappingExposure)
    <ToneMapping key="tm" mode={ToneMappingMode.ACES_FILMIC} />,
    <Vignette key="vig" offset={0.32} darkness={0.5} />,
    q.composerMsaa === 0 && <SMAA key="smaa" />,
  ].filter(Boolean) as React.JSX.Element[]
  return (
    <EffectComposer multisampling={q.composerMsaa} enableNormalPass={false}>
      {effects}
    </EffectComposer>
  )
}

/** Everything that defines the look of the exterior world. Mount once inside the Canvas. */
export function WorldRendering() {
  const quality = useStore((s) => s.quality)
  const tod = useStore((s) => s.timeOfDay)
  const q = QUALITY[quality]
  const p = TOD[tod]
  // anisotropy is a per-preset setting; textures are cached singletons so set it before they upload
  useMemo(() => setTextureAnisotropy(q.anisotropy), [q.anisotropy])
  return (
    <>
      <Atmosphere />
      <SkyEnvironment />
      <TimeOfDayHotkey />
      <hemisphereLight args={[p.hemiSky, p.hemiGround, p.hemiIntensity]} />
      <ambientLight intensity={p.ambient} />
      <Sun shadows={q.shadows} size={q.shadowMapSize} radius={q.shadowRadius} />
      <LightPools />
      <PostStack />
    </>
  )
}

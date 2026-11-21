// Perimeter guard tower sweeping volumetric searchlights scanning the outer Ketrax desert,
// ground searchlight hit decals, and green flush taxiway centerline inset diodes.
import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useStore } from '../state/store'
import { perimeterVertices, terrainHeight } from './layout'
import { TOD } from './lighting'
import { diodeGlowTexture, lightPoolTexture } from './textures'

// Volumetric searchlight beam shader
const BEAM_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vNormal;
varying vec3 vViewPosition;
varying float vDist;
void main() {
  vDist = clamp(-position.z / 160.0, 0.0, 1.0);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = -mvPosition.xyz;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
}
`

const BEAM_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vNormal;
varying vec3 vViewPosition;
varying float vDist;
void main() {
  #include <logdepthbuf_fragment>
  vec3 viewDir = normalize(vViewPosition);
  float rim = 1.0 - abs(dot(viewDir, vNormal));
  float longitudinal = pow(1.0 - vDist, 1.6);
  float alpha = rim * longitudinal * uOpacity;
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(uColor, alpha);
  #include <colorspace_fragment>
}
`

// ------------------------------------------------------------------ Taxiway sampling
const TAXIWAYS: [number, number][][] = [
  // Hangar Alpha to Pad 3 and Main Platform
  [[-203, 20], [-175, 45], [-160, 100], [-135, 160], [-115, 225], [-95, 285], [-80, 335]],
  // Hangar Alpha to Pad 2
  [[-203, 20], [-175, -5], [-160, -55], [-135, -115]],
  // Main Platform to North Gate Road
  [[-80, 340], [-45, 320], [0, 300]],
]

function samplePolyline(points: [number, number][], step = 7.0): [number, number][] {
  const result: [number, number][] = []
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, z1] = points[i]
    const [x2, z2] = points[i + 1]
    const segLen = Math.hypot(x2 - x1, z2 - z1)
    const count = Math.max(1, Math.round(segLen / step))
    const start = i === 0 ? 0 : 1
    for (let j = start; j <= count; j++) {
      const t = j / count
      result.push([x1 + (x2 - x1) * t, z1 + (z2 - z1) * t])
    }
  }
  return result
}

function TaxiwayDiodes() {
  const tod = useStore((s) => s.timeOfDay)
  const diodePoints = useMemo(() => {
    const pts: [number, number][] = []
    TAXIWAYS.forEach((tw) => pts.push(...samplePolyline(tw, 7.2)))
    return pts
  }, [])

  const refCollars = useRef<THREE.InstancedMesh>(null)
  const refEmitters = useRef<THREE.InstancedMesh>(null)
  const refHalos = useRef<THREE.InstancedMesh>(null)

  const geoCollar = useMemo(() => new THREE.CylinderGeometry(0.32, 0.4, 0.08, 8), [])
  const geoEmitter = useMemo(() => new THREE.CylinderGeometry(0.2, 0.2, 0.1, 8), [])
  const geoHalo = useMemo(() => new THREE.PlaneGeometry(2.0, 2.0).rotateX(-Math.PI / 2), [])

  const matCollar = useMemo(() => new THREE.MeshStandardMaterial({ color: 0x181a1f, roughness: 0.65, metalness: 0.8 }), [])
  const matEmitter = useMemo(() => new THREE.MeshBasicMaterial({ color: 0x22ff77, toneMapped: false }), [])
  const haloTex = useMemo(() => diodeGlowTexture(), [])
  const matHalo = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: haloTex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -12,
        toneMapped: false,
      }),
    [haloTex]
  )

  useLayoutEffect(() => {
    const m = new THREE.Matrix4()
    diodePoints.forEach(([x, z], i) => {
      // Collar
      m.makeScale(1, 1, 1).setPosition(x, 0.04, z)
      refCollars.current?.setMatrixAt(i, m)

      // Emitter
      m.makeScale(1, 1, 1).setPosition(x, 0.08, z)
      refEmitters.current?.setMatrixAt(i, m)

      // Halo decal
      m.makeScale(1, 1, 1).setPosition(x, 0.11, z)
      refHalos.current?.setMatrixAt(i, m)
    })
    if (refCollars.current) {
      refCollars.current.instanceMatrix.needsUpdate = true
      refCollars.current.computeBoundingSphere()
    }
    if (refEmitters.current) {
      refEmitters.current.instanceMatrix.needsUpdate = true
      refEmitters.current.computeBoundingSphere()
    }
    if (refHalos.current) {
      refHalos.current.instanceMatrix.needsUpdate = true
      refHalos.current.computeBoundingSphere()
    }
  }, [diodePoints])

  const haloOpacity = tod === 'night' ? 0.85 : tod === 'dusk' ? 0.48 : 0.04
  matHalo.opacity = haloOpacity

  return (
    <group name="taxiway-diodes">
      <instancedMesh ref={refCollars} args={[geoCollar, matCollar, diodePoints.length]} frustumCulled={false} />
      <instancedMesh ref={refEmitters} args={[geoEmitter, matEmitter, diodePoints.length]} frustumCulled={false} />
      {haloOpacity > 0.02 && (
        <instancedMesh ref={refHalos} args={[geoHalo, matHalo, diodePoints.length]} frustumCulled={false} renderOrder={3} />
      )}
    </group>
  )
}

// ------------------------------------------------------------------ Tower Searchlights
interface SearchlightTower {
  x: number
  z: number
  baseAngle: number
  px: number
  pz: number
  py: number
}

export function Searchlights() {
  const tod = useStore((s) => s.timeOfDay)
  const towers = useMemo<SearchlightTower[]>(() => {
    const verts = perimeterVertices()
    return verts.map(([vx, vz]) => {
      const baseAngle = Math.atan2(vz, vx)
      // Mount fixture on outer edge of tower top deck (y = 35.8)
      const px = vx + Math.cos(baseAngle) * 5.4
      const pz = vz + Math.sin(baseAngle) * 5.4
      return { x: vx, z: vz, baseAngle, px, pz, py: 35.8 }
    })
  }, [])

  // Geometries
  const geoBeam = useMemo(() => {
    const geo = new THREE.CylinderGeometry(0.8, 22, 160, 16, 1, true)
    geo.translate(0, -80, 0)
    geo.rotateX(Math.PI / 2) // Points along -Z
    return geo
  }, [])

  const geoBarrel = useMemo(() => {
    const geo = new THREE.CylinderGeometry(0.9, 1.1, 2.2, 12)
    geo.translate(0, -1.1, 0)
    geo.rotateX(Math.PI / 2) // Points along -Z
    return geo
  }, [])

  const geoLens = useMemo(() => {
    const geo = new THREE.CircleGeometry(0.88, 12)
    geo.rotateY(Math.PI) // Faces -Z
    return geo
  }, [])

  const geoGroundSpot = useMemo(() => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), [])

  // Materials
  const matBeam = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        uniforms: {
          uColor: { value: new THREE.Color(0xdceaff) },
          uOpacity: { value: 0 },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    []
  )

  const matBarrel = useMemo(() => new THREE.MeshStandardMaterial({ color: 0x111316, metalness: 0.85, roughness: 0.4 }), [])
  const matLens = useMemo(() => new THREE.MeshBasicMaterial({ color: 0xeef5ff, toneMapped: false }), [])
  const spotTex = useMemo(() => lightPoolTexture(), [])
  const matGroundSpot = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: spotTex,
        color: new THREE.Color(0xd0e4ff),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -10,
        toneMapped: false,
      }),
    [spotTex]
  )

  const headsRef = useRef<(THREE.Group | null)[]>([])
  const spotsRef = useRef<THREE.InstancedMesh>(null)

  // Target TOD beam opacity
  const targetOpacity = tod === 'night' ? 0.38 : tod === 'dusk' ? 0.16 : 0.0

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    // Subtle beam flicker / atmospheric shimmer
    const shimmer = 0.96 + Math.sin(t * 3.5) * 0.04
    matBeam.uniforms.uOpacity.value = targetOpacity * shimmer
    matGroundSpot.opacity = targetOpacity * 0.45 * shimmer

    if (targetOpacity <= 0.001) return

    const mat = new THREE.Matrix4()
    towers.forEach((tower, i) => {
      const head = headsRef.current[i]
      if (!head) return

      // Sinusoidal sweep across outer desert (+/- 26 degrees)
      const sweep = Math.sin(t * 0.42 + i * 1.35) * 0.46
      const yaw = tower.baseAngle + sweep

      // Hit point on outer desert terrain: ~105m out from tower
      const targetX = tower.px + Math.cos(yaw) * 105
      const targetZ = tower.pz + Math.sin(yaw) * 105
      const targetY = terrainHeight(targetX, targetZ)

      // Aim searchlight head & beam directly at ground target (Three.js lookAt aims -Z)
      head.lookAt(targetX, targetY, targetZ)

      // Update ground light pool matrix
      mat.makeScale(34, 1, 34).setPosition(targetX, targetY + 0.15, targetZ)
      spotsRef.current?.setMatrixAt(i, mat)
    })

    if (spotsRef.current) {
      spotsRef.current.instanceMatrix.needsUpdate = true
      spotsRef.current.computeBoundingSphere()
    }
  })

  return (
    <group name="searchlights">
      <TaxiwayDiodes />

      {/* 8 Perimeter Tower Searchlight Fixtures */}
      {towers.map((tower, i) => (
        <group key={i} position={[tower.px, tower.py, tower.pz]}>
          {/* Pedestal Mount */}
          <mesh position={[0, -0.4, 0]}>
            <cylinderGeometry args={[0.55, 0.7, 0.8, 8]} />
            <meshStandardMaterial color={0x15171b} metalness={0.8} roughness={0.5} />
          </mesh>

          {/* Aimed Searchlight Head */}
          <group ref={(el) => { headsRef.current[i] = el }}>
            <mesh geometry={geoBarrel} material={matBarrel} />
            <mesh geometry={geoLens} material={matLens} position={[0, 0, -2.1]} />
            {targetOpacity > 0.001 && <mesh geometry={geoBeam} material={matBeam} renderOrder={5} />}
          </group>
        </group>
      ))}

      {/* Additive Ground Light Decals for the 8 Searchlight Sweeps */}
      {targetOpacity > 0.001 && (
        <instancedMesh ref={spotsRef} args={[geoGroundSpot, matGroundSpot, towers.length]} frustumCulled={false} renderOrder={2} />
      )}
    </group>
  )
}

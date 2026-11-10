// IMPERIAL BASE — hero character for REAL connected AI agents.
// Same rig + proportions as the crowd, rendered as individual meshes with a
// premium black uniform, gold shoulder trim and a pulsing holographic ring.
// The parent positions/rotates the group and owns labels.

import { useEffect, useMemo, useRef } from 'react'
import type { ThreeElements } from '@react-three/fiber'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
} from 'three'
import { PALETTES, createPartGeometries, resolveChannels, type CrowdMember, type CrowdMeshKey, type Palette } from './Crowd'
import {
  PART,
  PART_COUNT,
  WALK_MIN_SPEED,
  advancePhase,
  computePose,
  copyPose,
  createPose,
  lerpPose,
  poseToMatrices,
  type Action,
} from './rig'

export interface HeroCharacterProps extends Omit<ThreeElements['group'], 'children'> {
  action: CrowdMember['action']
  speed: number
  /** ring / insignia colour (default soft holo blue) */
  accent?: string
  selected?: boolean
  /** free-form agent status: 'error'/'failed' tints the ring red, 'offline'/'idle' dims it */
  status?: string
  phase?: number
}

const HERO_PALETTE: Palette = {
  ...PALETTES.officer,
  tunic: '#1d1f23',
  under: '#202226',
  sleeve: '#1d1f23',
  trousers: '#1b1c20',
  upperShin: '#08090a',
  boots: '#08090a',
  sole: '#050505',
  belt: '#0b0b0c',
  buckle: '#c9a24a',
  gloves: '#0a0a0b',
  plaque: '#c9a24a',
  trim: '#c49a42',
  hat: '#131417',
  hatBand: '#0a0a0b',
}

/** Bake the 4-tone weights of a part geometry into plain vertex colours. */
function bake(src: BufferGeometry, key: CrowdMeshKey, palette: Palette, seed: number): BufferGeometry {
  const g = src.clone()
  const cols = [new Color(), new Color(), new Color(), new Color()]
  resolveChannels(key, palette, cols, seed)
  const w = g.getAttribute('color')
  const out = new Float32Array(w.count * 3)
  for (let i = 0; i < w.count; i++) {
    const a = w.getX(i), b = w.getY(i), c = w.getZ(i)
    const k = Math.max(0, 1 - a - b - c)
    out[i * 3] = cols[0].r * a + cols[1].r * b + cols[2].r * c + cols[3].r * k
    out[i * 3 + 1] = cols[0].g * a + cols[1].g * b + cols[2].g * c + cols[3].g * k
    out[i * 3 + 2] = cols[0].b * a + cols[1].b * b + cols[2].b * c + cols[3].b * k
  }
  g.setAttribute('color', new Float32BufferAttribute(out, 3))
  return g
}

const RING_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`
const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uIntensity;
uniform float uSelected;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  float pulse = 0.5 + 0.5 * sin(uTime * 2.4);
  float r0 = 0.62 + 0.03 * pulse;
  float ring = exp(-pow((r - r0) / 0.045, 2.0));
  float halo = exp(-pow((r - r0) / 0.18, 2.0)) * 0.35;
  float disc = smoothstep(0.7, 0.0, r) * 0.1;
  // rotating dashes on the outer ring when selected
  float ang = atan(vUv.y, vUv.x);
  float dash = step(0.5, fract(ang * 6.0 / 6.2831853 * 4.0 + uTime * 0.25));
  float outer = exp(-pow((r - 0.86) / 0.02, 2.0)) * dash * uSelected;
  float wave = exp(-pow((r - fract(uTime * 0.45) * 0.95) / 0.04, 2.0)) * (1.0 - fract(uTime * 0.45)) * 0.35;
  float a = (ring * (0.65 + 0.35 * pulse) + halo + disc + outer + wave) * uIntensity;
  a *= smoothstep(1.0, 0.92, r);
  gl_FragColor = vec4(uColor * a, a);
}`

const HERO_OPTS = { seed: 0.71, stride: 1.02 }
const ACTION_KEY: Record<Action, number> = { walk: 0, idle: 1, work: 2, guard: 3, salute: 4, inspect: 5, talk: 6 }

export function HeroCharacter({ action, speed, accent = '#5ab8ff', selected = false, status, phase = 0, ...group }: HeroCharacterProps) {
  const built = useMemo(() => {
    const src = createPartGeometries()
    const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.28 })
    const mk = (key: CrowdMeshKey) => {
      const m = new Mesh(bake(src[key], key, HERO_PALETTE, 0.35), mat)
      m.matrixAutoUpdate = false
      m.castShadow = true
      return m
    }
    const parts: [Mesh, number][] = [
      [mk('pelvis'), PART.pelvis],
      [mk('torso'), PART.torso],
      [mk('head'), PART.head],
      [mk('cap'), PART.helmet],
      [mk('upperArm'), PART.upperArmL],
      [mk('upperArm'), PART.upperArmR],
      [mk('forearm'), PART.forearmL],
      [mk('forearm'), PART.forearmR],
      [mk('thigh'), PART.thighL],
      [mk('thigh'), PART.thighR],
      [mk('shin'), PART.shinL],
      [mk('shin'), PART.shinR],
    ]
    for (const g of Object.values(src)) g.dispose()
    const ringMat = new ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      uniforms: {
        uColor: { value: new Color(accent) },
        uTime: { value: 0 },
        uIntensity: { value: 1 },
        uSelected: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      toneMapped: false,
    })
    const ring = new Mesh(new PlaneGeometry(1.7, 1.7), ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.025
    ring.renderOrder = 2
    return { parts, mat, ring, ringMat }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      for (const [m] of built.parts) m.geometry.dispose()
      built.mat.dispose()
      built.ring.geometry.dispose()
      built.ringMat.dispose()
    }
  }, [built])

  const anim = useRef({
    clock: 0,
    time: 0,
    target: createPose(),
    cur: createPose(),
    from: createPose(),
    trans: 1,
    lastKey: -1,
    mats: Array.from({ length: PART_COUNT }, () => new Matrix4()),
    root: new Matrix4(),
    color: new Color(),
    alert: new Color('#ff4a3a'),
    dim: new Color('#7f8a96'),
  })

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const a = anim.current
    a.time += dt
    const walking = action === 'walk' && speed > WALK_MIN_SPEED
    const act: Action = action === 'walk' && !walking ? 'idle' : action
    a.clock = advancePhase(a.clock, act, speed, dt, 1.02)
    computePose(act, phase + a.clock, speed, a.target, HERO_OPTS)
    const key = ACTION_KEY[act]
    if (a.lastKey < 0) {
      copyPose(a.target, a.cur)
      a.lastKey = key
    } else if (key !== a.lastKey) {
      copyPose(a.cur, a.from)
      a.trans = 0
      a.lastKey = key
    }
    if (a.trans < 1) {
      a.trans = Math.min(1, a.trans + dt / 0.4)
      const t = a.trans
      lerpPose(a.from, a.target, t * t * (3 - 2 * t), a.cur)
    } else copyPose(a.target, a.cur)
    poseToMatrices(a.cur, a.root, a.mats)
    for (const [mesh, part] of built.parts) mesh.matrix.copy(a.mats[part])

    // holo ring
    const s = (status ?? '').toLowerCase()
    const u = built.ringMat.uniforms
    a.color.set(accent)
    let intensity = selected ? 1.9 : 1.0
    if (s.includes('error') || s.includes('fail')) a.color.lerp(a.alert, 0.85)
    else if (s.includes('offline') || s.includes('idle')) {
      a.color.lerp(a.dim, 0.5)
      intensity *= 0.55
    }
    ;(u.uColor.value as Color).copy(a.color)
    u.uTime.value = a.time + phase
    u.uIntensity.value += (intensity - u.uIntensity.value) * Math.min(1, dt * 6)
    u.uSelected.value += ((selected ? 1 : 0) - u.uSelected.value) * Math.min(1, dt * 6)
  })

  return (
    <group {...group}>
      {built.parts.map(([m]) => (
        <primitive key={m.uuid} object={m} />
      ))}
      <primitive object={built.ring} />
    </group>
  )
}

export default HeroCharacter

// IMPERIAL BASE — instanced crowd renderer.
//
// One InstancedMesh per body part (15 draw calls for the whole crowd, regardless
// of head-count). Every part geometry carries per-vertex "tone weights" in its
// colour attribute (r,g,b = channels 0..2, remainder = channel 3); the shader
// mixes four per-instance colours with those weights, so one shared geometry
// renders every uniform: olive tunic + black jackboots, white armour + black
// joints, orange vest over grey, etc. All matrices are written in one useFrame
// with scratch objects only — no React state, no per-frame allocation.

import { useEffect, useMemo, useRef } from 'react'
import type React from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Euler,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  BODY,
  PART,
  PART_COUNT,
  RIFLE_LOCAL,
  WALK_MIN_SPEED,
  advancePhase,
  computePose,
  copyPose,
  createPose,
  hash01,
  lerpPose,
  poseToMatrices,
  strideScaleFor,
  type Action,
  type Pose,
  type PoseOptions,
} from './rig'

export type PersonnelVariant = 'officer' | 'trooper' | 'engineer' | 'technician' | 'scientist' | 'pilot' | 'crew' | 'analyst'

export interface CrowdMember {
  x: number
  y: number
  z: number
  /** radians, 0 faces +Z */
  heading: number
  /** m/s, 0 = standing */
  speed: number
  action: 'walk' | 'idle' | 'work' | 'guard' | 'salute' | 'inspect' | 'talk'
  variant: PersonnelVariant
  /** per-character animation phase offset (the renderer advances its own clock on top) */
  phase: number
  visible: boolean
}

export const PERSONNEL_VARIANTS: PersonnelVariant[] = ['officer', 'trooper', 'engineer', 'technician', 'scientist', 'pilot', 'crew', 'analyst']

// ------------------------------------------------------------------ palettes

export type PaletteKey =
  | 'tunic' | 'under' | 'sleeve' | 'trousers' | 'upperShin' | 'boots' | 'sole' | 'belt' | 'buckle' | 'gloves'
  | 'plaque' | 'trim' | 'skin' | 'hair' | 'brow' | 'hat' | 'hatBand' | 'visor' | 'helmetTrim' | 'coat'
  | 'gun' | 'gunDark' | 'knee'

/** `knee` is optional and falls back to `trousers`. */
export type Palette = Record<Exclude<PaletteKey, 'knee'>, string> & { knee?: string }

const BASE: Palette = {
  tunic: '#5b6152', under: '#5b6152', sleeve: '#5b6152', trousers: '#5b6152', upperShin: '#5b6152',
  boots: '#141414', sole: '#0b0b0b', belt: '#151515', buckle: '#9da1a6', gloves: '#161616',
  plaque: '#a83228', trim: '#5b6152', skin: '#c99a7b', hair: '#3a2a1e', brow: '#2a1d16',
  hat: '#5b6152', hatBand: '#1a1a1a', visor: '#0c0e12', helmetTrim: '#2b2d31', coat: '#d6d8da',
  gun: '#26282c', gunDark: '#0f1012',
}

export const PALETTES: Record<PersonnelVariant, Palette> = {
  officer: { ...BASE, upperShin: '#141414', plaque: '#a8332a', trim: '#565c4e' },
  trooper: {
    ...BASE,
    tunic: '#e6e6e2', under: '#141517', sleeve: '#e2e2de', trousers: '#e4e4e0', upperShin: '#e4e4e0',
    boots: '#dcdcd8', sole: '#1a1a1a', belt: '#e8e8e4', buckle: '#2a2b2e', gloves: '#141517',
    plaque: '#2b2c2f', trim: '#ececea', hat: '#ececea', knee: '#141517', visor: '#0a0b0d', helmetTrim: '#3a3c40',
  },
  engineer: {
    ...BASE,
    tunic: '#6c5c45', under: '#6c5c45', sleeve: '#6c5c45', trousers: '#655640', upperShin: '#655640',
    boots: '#2a2420', belt: '#2b2620', buckle: '#d27a2e', gloves: '#3a2f26', plaque: '#d8782a', trim: '#d07228',
    hat: '#6c5c45',
  },
  technician: {
    ...BASE,
    tunic: '#1c1d20', under: '#1c1d20', sleeve: '#1c1d20', trousers: '#1a1b1e', upperShin: '#121212',
    belt: '#0d0d0e', buckle: '#70747a', plaque: '#5c6066', trim: '#26282c', hat: '#18191b', hatBand: '#0c0c0d',
  },
  scientist: {
    ...BASE,
    tunic: '#d9dadb', under: '#c9cacc', sleeve: '#d6d7d9', trousers: '#383b40', upperShin: '#383b40',
    boots: '#1a1a1c', belt: '#2a2c30', buckle: '#8a8e94', gloves: '#c99a7b', plaque: '#3e6fa8', trim: '#d0d1d3',
    coat: '#d9dadb',
  },
  pilot: {
    ...BASE,
    tunic: '#17181a', under: '#17181a', sleeve: '#17181a', trousers: '#17181a', upperShin: '#17181a',
    boots: '#0d0d0e', belt: '#2a2b2e', buckle: '#8d9298', plaque: '#7c8288', trim: '#232427',
    hat: '#111214', visor: '#05070a', helmetTrim: '#55595f',
  },
  crew: {
    ...BASE,
    tunic: '#c8621f', under: '#c8621f', sleeve: '#4f5358', trousers: '#4b4f54', upperShin: '#4b4f54',
    boots: '#1b1b1c', belt: '#2a2b2d', buckle: '#b9bcbf', gloves: '#2c2d30', plaque: '#c9ccc9', trim: '#d6d8d4',
  },
  analyst: {
    ...BASE,
    tunic: '#3b4553', under: '#3b4553', sleeve: '#3b4553', trousers: '#353e4b', upperShin: '#141414',
    belt: '#151618', plaque: '#4d7bb0', trim: '#3f4a59',
  },
}

const SKIN = ['#e3b896', '#c99a7b', '#a87252', '#7d5038', '#5a3726', '#d8a988']
const HAIR = ['#1c1714', '#3a2a1e', '#5b4129', '#8a6a44', '#2b2b2b', '#6e6a64']

// ------------------------------------------------------------------ geometry

type Tone = 0 | 1 | 2 | 3
const TONE_RGB: [number, number, number][] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [0, 0, 0],
]

const _gm = new Matrix4()
const _gq = new Quaternion()
const _ge = new Euler()
const _gv = new Vector3()
const _gs = new Vector3()

function piece(
  g: BufferGeometry, tone: Tone,
  p: [number, number, number] = [0, 0, 0],
  r: [number, number, number] = [0, 0, 0],
  s: [number, number, number] = [1, 1, 1],
): BufferGeometry {
  _ge.set(r[0], r[1], r[2])
  _gq.setFromEuler(_ge)
  _gm.compose(_gv.set(p[0], p[1], p[2]), _gq, _gs.set(s[0], s[1], s[2]))
  g.applyMatrix4(_gm)
  g.deleteAttribute('uv')
  const n = g.getAttribute('position').count
  const c = new Float32Array(n * 3)
  const t = TONE_RGB[tone]
  for (let i = 0; i < n; i++) {
    c[i * 3] = t[0]
    c[i * 3 + 1] = t[1]
    c[i * 3 + 2] = t[2]
  }
  g.setAttribute('color', new Float32BufferAttribute(c, 3))
  return g
}

const cyl = (rt: number, rb: number, h: number, seg: number, open = false, theta = 0) => new CylinderGeometry(rt, rb, h, seg, 1, open, theta)
const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d)
const sph = (r: number, ws: number, hs: number, t0 = 0, tl = Math.PI) => new SphereGeometry(r, ws, hs, 0, Math.PI * 2, t0, tl)
const O8 = Math.PI / 8
const O6 = Math.PI / 6
/** Single quad facing +Z (flush decals: plaques, eyes, buckles). */
const quad = (w: number, h: number) => new PlaneGeometry(w, h)

function merged(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts, false)
  if (!g) throw new Error('crowd: geometry merge failed')
  for (const p of parts) p.dispose()
  g.computeBoundingSphere()
  return g
}

export type CrowdMeshKey =
  | 'pelvis' | 'torso' | 'head' | 'upperArm' | 'forearm' | 'thigh' | 'shin'
  | 'cap' | 'trooperHelmet' | 'pilotHelmet' | 'rifle' | 'coat'
  | 'armour' | 'pauldron' | 'greave'

/** Radial segments of limbs and bodies: round enough to read as cloth and armour up close. */
const S = 12

/** Builds the shared part geometries (local frames match rig.ts pivots). */
export function createPartGeometries(): Record<CrowdMeshKey, BufferGeometry> {
  const hc = BODY.headCenter
  return {
    // pivot = hip joints line. channels: trousers, belt, buckle, under
    pelvis: merged([
      piece(cyl(0.162, 0.13, 0.22, S), 0, [0, 0.0, 0], [0, 0, 0], [1, 1, 0.72]),
      piece(cyl(0.168, 0.168, 0.055, S, true), 1, [0, 0.1, 0], [0, 0, 0], [1, 1, 0.74]),
      piece(box(0.07, 0.045, 0.02), 2, [0, 0.1, 0.122]),
    ]),
    // pivot = waist. channels: tunic, under, plaque, trim
    torso: merged([
      piece(cyl(0.152, 0.15, 0.2, S, true), 1, [0, 0.1, 0], [0, 0, 0], [1, 1, 0.72]),
      piece(cyl(0.198, 0.156, 0.25, S, true), 0, [0, 0.3, 0.004], [0, 0, 0], [1, 1, 0.66]),
      piece(cyl(0.13, 0.198, 0.045, S, false), 0, [0, 0.446, 0.004], [0, 0, 0], [1, 1, 0.66]),
      piece(box(0.125, 0.05, 0.16), 3, [0.16, 0.432, 0], [0, 0, -0.28]),
      piece(box(0.125, 0.05, 0.16), 3, [-0.16, 0.432, 0], [0, 0, 0.28]),
      piece(cyl(0.062, 0.07, 0.05, S, true), 1, [0, 0.468, 0.005]),
      piece(box(0.072, 0.042, 0.014), 2, [0.088, 0.355, 0.114], [0, 0.36, 0]),
      piece(cyl(0.178, 0.174, 0.022, S, true), 3, [0, 0.27, 0.004], [0, 0, 0], [1, 1, 0.66]),
    ]),
    // pivot = neck base. channels: skin, hair, brow, skin
    head: merged([
      piece(cyl(0.05, 0.058, 0.11, 8, true), 0, [0, 0.045, 0.005]),
      piece(sph(0.1, 14, 10), 0, [0, hc, 0.012], [0, 0, 0], [0.79, 1.17, 0.98]),
      piece(sph(0.104, 14, 4, 0, Math.PI * 0.42), 1, [0, hc + 0.006, -0.004], [-0.5, 0, 0], [0.8, 1.17, 1.0]),
      piece(box(0.03, 0.012, 0.012), 2, [0.034, hc + 0.018, 0.1], [0, 0.32, 0]),
      piece(box(0.03, 0.012, 0.012), 2, [-0.034, hc + 0.018, 0.1], [0, -0.32, 0]),
      piece(box(0.022, 0.045, 0.03), 0, [0, hc - 0.008, 0.105], [-0.15, 0, 0]),
      piece(box(0.014, 0.04, 0.026), 0, [0.079, hc - 0.002, 0.004]),
      piece(box(0.014, 0.04, 0.026), 0, [-0.079, hc - 0.002, 0.004]),
    ]),
    // pivot = shoulder. channels: sleeve, under, trim, sleeve
    upperArm: merged([
      piece(sph(0.06, 10, 6), 0, [0, -0.008, 0]),
      piece(cyl(0.058, 0.047, 0.31, 10), 0, [0, -0.135, 0]),
      piece(cyl(0.049, 0.047, 0.05, 10, true), 1, [0, -0.27, 0]),
    ]),
    // pivot = elbow. channels: sleeve, gloves, trim, under
    forearm: merged([
      piece(cyl(0.048, 0.037, 0.27, 10), 0, [0, -0.115, 0]),
      piece(cyl(0.042, 0.04, 0.045, 10, true), 1, [0, -0.235, 0]),
      piece(sph(0.046, 8, 6), 1, [0, -0.3, 0.004], [0, 0, 0], [0.45, 1.0, 0.85]),
      piece(box(0.016, 0.04, 0.02), 1, [0, -0.285, 0.045], [0.5, 0, 0]),
    ]),
    // pivot = hip joint. channels: trousers, knee, trim, trousers
    thigh: merged([
      piece(cyl(0.082, 0.06, 0.47, 10, true), 0, [0, -0.21, 0]),
      piece(sph(0.054, 10, 6), 1, [0, -BODY.thigh, 0.006], [0, 0, 0], [0.95, 1, 1]),
    ]),
    // pivot = knee. channels: trousers, boots, sole, upperShin
    shin: merged([
      piece(cyl(0.058, 0.05, 0.22, 10, true), 3, [0, -0.1, 0]),
      piece(cyl(0.054, 0.05, 0.25, 10, true), 1, [0, -0.33, 0]),
      piece(box(0.094, 0.07, 0.2), 1, [0, -0.46, 0.025]),
      piece(sph(0.047, 8, 5), 1, [0, -0.46, 0.125], [0, 0, 0], [1, 0.74, 1.2]),
      piece(box(0.1, 0.022, 0.26), 2, [0, -0.493, 0.05]),
    ]),
    // ---- headgear (pivot = neck base, same as head)
    cap: merged([
      piece(cyl(0.112, 0.1, 0.075, S), 0, [0, hc + 0.105, 0.0], [-0.08, 0, 0], [1, 1, 1.12]),
      piece(cyl(0.102, 0.102, 0.022, S, true), 1, [0, hc + 0.075, 0.0], [-0.08, 0, 0], [1, 1, 1.12]),
      piece(box(0.16, 0.012, 0.065), 1, [0, hc + 0.066, 0.11], [0.22, 0, 0]),
      piece(box(0.035, 0.025, 0.01), 2, [0, hc + 0.105, 0.124], [-0.08, 0, 0]),
    ]),
    // channels: helmet, visor, helmetTrim, hat
    trooperHelmet: merged([
      piece(sph(0.132, S, 7, 0, Math.PI * 0.62), 0, [0, hc + 0.02, -0.005], [0, 0, 0], [0.95, 1.0, 1.06]),
      piece(cyl(0.122, 0.13, 0.06, S, true), 0, [0, hc - 0.025, -0.01], [0, 0, 0], [0.95, 1, 1.0]),
      piece(box(0.13, 0.12, 0.06), 0, [0, hc - 0.045, 0.1], [-0.12, 0, 0]),
      // visor: a brow band and two angled lenses
      piece(box(0.128, 0.03, 0.02), 1, [0, hc + 0.03, 0.137]),
      piece(box(0.05, 0.034, 0.02), 1, [0.034, hc + 0.004, 0.136], [0, 0, -0.35]),
      piece(box(0.05, 0.034, 0.02), 1, [-0.034, hc + 0.004, 0.136], [0, 0, 0.35]),
      // vocoder grille, cheek tubes, ear caps, a ridge over the crown
      piece(box(0.05, 0.04, 0.012), 1, [0, hc - 0.07, 0.1335], [-0.12, 0, 0]),
      piece(cyl(0.016, 0.016, 0.05, 6), 2, [0.05, hc - 0.085, 0.118], [Math.PI / 2 - 0.12, 0, 0]),
      piece(cyl(0.016, 0.016, 0.05, 6), 2, [-0.05, hc - 0.085, 0.118], [Math.PI / 2 - 0.12, 0, 0]),
      piece(cyl(0.034, 0.034, 0.024, 8), 2, [0.125, hc - 0.01, 0.0], [0, 0, Math.PI / 2]),
      piece(cyl(0.034, 0.034, 0.024, 8), 2, [-0.125, hc - 0.01, 0.0], [0, 0, Math.PI / 2]),
      piece(box(0.03, 0.02, 0.2), 0, [0, hc + 0.148, -0.02], [0.12, 0, 0]),
    ]),
    pilotHelmet: merged([
      piece(sph(0.145, S, 7, 0, Math.PI * 0.66), 0, [0, hc + 0.02, -0.012], [0, 0, 0], [1.0, 1.0, 1.04]),
      piece(cyl(0.138, 0.142, 0.07, S, true), 0, [0, hc - 0.03, -0.015]),
      piece(box(0.17, 0.07, 0.04), 1, [0, hc + 0.0, 0.122], [-0.05, 0, 0]),
      piece(box(0.07, 0.06, 0.06), 2, [0, hc - 0.085, 0.11], [-0.2, 0, 0]),
      piece(cyl(0.012, 0.012, 0.2, 6, true), 2, [0.04, hc - 0.18, 0.12], [0.35, 0, 0.12]),
      piece(cyl(0.012, 0.012, 0.2, 6, true), 2, [-0.04, hc - 0.18, 0.12], [0.35, 0, -0.12]),
      piece(cyl(0.03, 0.03, 0.02, 8), 3, [0.147, hc, 0.0], [0, 0, Math.PI / 2]),
      piece(cyl(0.03, 0.03, 0.02, 8), 3, [-0.147, hc, 0.0], [0, 0, Math.PI / 2]),
    ]),
    // rifle, long axis +Y (muzzle). channels: gun, gunDark, gunDark, gun
    rifle: merged([
      piece(box(0.05, 0.3, 0.06), 0, [0, 0, 0]),
      piece(cyl(0.016, 0.016, 0.2, 8, true), 1, [0, 0.25, 0.005]),
      piece(cyl(0.022, 0.022, 0.05, 8), 0, [0, 0.36, 0.005]),
      piece(box(0.035, 0.15, 0.04), 1, [0, -0.2, 0.0]),
      piece(box(0.06, 0.03, 0.03), 1, [-0.045, -0.07, 0], [0, 0, 0.5]),
      piece(box(0.07, 0.03, 0.025), 2, [-0.05, 0.05, 0], [0, 0, 0]),
      piece(cyl(0.014, 0.014, 0.16, 6), 2, [0.038, 0.04, 0]),
    ]),
    // lab coat skirt (pelvis frame). channels: coat, coat, trim, coat
    coat: merged([
      piece(cyl(0.172, 0.215, 0.44, S, true), 0, [0, -0.12, -0.005], [0, 0, 0], [1, 1, 0.74]),
    ]),
    // ---- trooper armour plates, worn over the body
    // torso frame. channels: tunic (plate), under, plaque, trim
    armour: merged([
      // chest plate, stomach plate, back plate with a pack, belt boxes
      piece(sph(0.2, S, 6, 0, Math.PI * 0.62), 0, [0, 0.3, 0.012], [0, 0, 0], [1.04, 0.86, 0.72]),
      piece(cyl(0.166, 0.16, 0.1, S, true), 0, [0, 0.13, 0.004], [0, 0, 0], [1, 1, 0.76]),
      piece(box(0.2, 0.25, 0.06), 0, [0, 0.31, -0.135]),
      piece(box(0.12, 0.06, 0.02), 1, [0, 0.3, -0.167]),
      piece(box(0.05, 0.05, 0.03), 0, [0.1, 0.035, 0.115]),
      piece(box(0.05, 0.05, 0.03), 0, [-0.1, 0.035, 0.115]),
      piece(box(0.1, 0.03, 0.014), 1, [0, 0.215, 0.13]),
    ]),
    // upper-arm frame. channels: sleeve (plate), under, trim, sleeve
    pauldron: merged([
      piece(sph(0.078, 10, 5, 0, Math.PI * 0.55), 0, [0, -0.012, 0], [0, 0, 0], [1.05, 1, 1.08]),
      piece(cyl(0.064, 0.056, 0.15, 10, true), 0, [0, -0.17, 0]),
    ]),
    // shin frame. channels: trousers (plate), boots, sole, upperShin
    greave: merged([
      piece(sph(0.062, 8, 5), 0, [0, -0.005, 0.03], [0, 0, 0], [0.9, 1.1, 0.7]),
      piece(cyl(0.066, 0.058, 0.3, 10, true), 0, [0, -0.2, 0.004]),
    ]),
  }
}

/** Palette keys feeding the four tone channels of each mesh. */
export const MESH_CHANNELS: Record<CrowdMeshKey, [PaletteKey, PaletteKey, PaletteKey, PaletteKey]> = {
  pelvis: ['trousers', 'belt', 'buckle', 'under'],
  torso: ['tunic', 'under', 'plaque', 'trim'],
  head: ['skin', 'hair', 'brow', 'skin'],
  upperArm: ['sleeve', 'under', 'trim', 'sleeve'],
  forearm: ['sleeve', 'gloves', 'trim', 'under'],
  thigh: ['trousers', 'knee', 'trim', 'trousers'],
  shin: ['trousers', 'boots', 'sole', 'upperShin'],
  cap: ['hat', 'hatBand', 'plaque', 'hatBand'],
  trooperHelmet: ['hat', 'visor', 'helmetTrim', 'hat'],
  pilotHelmet: ['hat', 'visor', 'helmetTrim', 'helmetTrim'],
  rifle: ['gun', 'gunDark', 'gunDark', 'gun'],
  coat: ['coat', 'coat', 'trim', 'coat'],
  armour: ['tunic', 'under', 'plaque', 'trim'],
  pauldron: ['sleeve', 'under', 'trim', 'sleeve'],
  greave: ['trousers', 'boots', 'sole', 'upperShin'],
}

type Slot =
  | { kind: 'part'; part: number }
  | { kind: 'pair'; left: number; right: number }
  | { kind: 'rifle' }

interface MeshSpec {
  key: CrowdMeshKey
  slot: Slot
  /** variants that wear this part (undefined = everyone) */
  only?: PersonnelVariant[]
}

const MESH_SPECS: MeshSpec[] = [
  { key: 'pelvis', slot: { kind: 'part', part: PART.pelvis } },
  { key: 'torso', slot: { kind: 'part', part: PART.torso } },
  { key: 'head', slot: { kind: 'part', part: PART.head } },
  { key: 'upperArm', slot: { kind: 'pair', left: PART.upperArmL, right: PART.upperArmR } },
  { key: 'forearm', slot: { kind: 'pair', left: PART.forearmL, right: PART.forearmR } },
  { key: 'thigh', slot: { kind: 'pair', left: PART.thighL, right: PART.thighR } },
  { key: 'shin', slot: { kind: 'pair', left: PART.shinL, right: PART.shinR } },
  { key: 'cap', slot: { kind: 'part', part: PART.helmet }, only: ['officer', 'technician'] },
  { key: 'trooperHelmet', slot: { kind: 'part', part: PART.helmet }, only: ['trooper'] },
  { key: 'pilotHelmet', slot: { kind: 'part', part: PART.helmet }, only: ['pilot'] },
  { key: 'rifle', slot: { kind: 'rifle' }, only: ['trooper'] },
  { key: 'coat', slot: { kind: 'part', part: PART.pelvis }, only: ['scientist'] },
  { key: 'armour', slot: { kind: 'part', part: PART.torso }, only: ['trooper'] },
  { key: 'pauldron', slot: { kind: 'pair', left: PART.upperArmL, right: PART.upperArmR }, only: ['trooper'] },
  { key: 'greave', slot: { kind: 'pair', left: PART.shinL, right: PART.shinR }, only: ['trooper'] },
]

export const RIFLE_MATRIX = new Matrix4().compose(
  new Vector3(RIFLE_LOCAL.x, RIFLE_LOCAL.y, RIFLE_LOCAL.z),
  new Quaternion().setFromEuler(new Euler(RIFLE_LOCAL.rotX, RIFLE_LOCAL.rotY, RIFLE_LOCAL.rotZ)),
  new Vector3(1, 1, 1),
)

const COLOR_CACHE = new Map<string, Color>()
function cached(hex: string): Color {
  let c = COLOR_CACHE.get(hex)
  if (!c) {
    c = new Color(hex)
    COLOR_CACHE.set(hex, c)
  }
  return c
}

/** Resolve the 4 channel colours (linear) of one mesh for one character. */
export function resolveChannels(key: CrowdMeshKey, palette: Palette, out: Color[], memberSeed = 0, shade = 1) {
  const ch = MESH_CHANNELS[key]
  for (let c = 0; c < 4; c++) {
    const k = ch[c]
    if (k === 'skin') out[c].copy(cached(SKIN[Math.floor(memberSeed * SKIN.length) % SKIN.length]))
    else if (k === 'knee') out[c].copy(cached(palette.knee ?? palette.trousers))
    else if (k === 'hair') out[c].copy(cached(HAIR[Math.floor(hash01(Math.floor(memberSeed * 1e6)) * HAIR.length) % HAIR.length]))
    else {
      out[c].copy(cached(palette[k]))
      if (shade !== 1) out[c].multiplyScalar(shade)
    }
  }
}

/** Patch a MeshStandardMaterial to mix four per-instance colours by vertex tone weights. */
function createCrowdMaterial(): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.12 })
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 iC1;\nattribute vec3 iC2;\nattribute vec3 iC3;')
      .replace(
        '#include <color_vertex>',
        `vColor = vec4(1.0);
#ifdef USE_INSTANCING_COLOR
  float wK = clamp(1.0 - color.r - color.g - color.b, 0.0, 1.0);
  vColor.rgb = instanceColor.rgb * color.r + iC1 * color.g + iC2 * color.b + iC3 * wK;
#else
  vColor.rgb = color;
#endif`,
      )
  }
  mat.customProgramCacheKey = () => 'imperial-crowd-4tone'
  return mat
}

// ------------------------------------------------------------------ component

const VARIANT_INDEX: Record<PersonnelVariant, number> = {
  officer: 0, trooper: 1, engineer: 2, technician: 3, scientist: 4, pilot: 5, crew: 6, analyst: 7,
}

interface Built {
  meshes: InstancedMesh[]
  specs: MeshSpec[]
  per: number[] // instances per member for each mesh (1 or 2)
  cols: InstancedBufferAttribute[][] // [mesh][channel 0..3]
  owner: Int32Array[] // colour cache: member*16+variant written in that slot (-1 = none)
  material: MeshStandardMaterial
  geos: BufferGeometry[]
}

function build(capacity: number, castShadow: boolean): Built {
  const geoms = createPartGeometries()
  const material = createCrowdMaterial()
  const meshes: InstancedMesh[] = []
  const per: number[] = []
  const cols: InstancedBufferAttribute[][] = []
  const owner: Int32Array[] = []
  const geos: BufferGeometry[] = []
  for (const spec of MESH_SPECS) {
    const n = spec.slot.kind === 'pair' ? 2 : 1
    const cap = Math.max(1, capacity * n)
    const geo = geoms[spec.key]
    geos.push(geo)
    const c0 = new InstancedBufferAttribute(new Float32Array(cap * 3), 3)
    const c1 = new InstancedBufferAttribute(new Float32Array(cap * 3), 3)
    const c2 = new InstancedBufferAttribute(new Float32Array(cap * 3), 3)
    const c3 = new InstancedBufferAttribute(new Float32Array(cap * 3), 3)
    for (const c of [c0, c1, c2, c3]) c.setUsage(DynamicDrawUsage)
    geo.setAttribute('iC1', c1)
    geo.setAttribute('iC2', c2)
    geo.setAttribute('iC3', c3)
    const mesh = new InstancedMesh(geo, material, cap)
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.instanceColor = c0
    mesh.count = 0
    mesh.frustumCulled = false
    mesh.castShadow = castShadow
    mesh.receiveShadow = false
    mesh.name = `crowd-${spec.key}`
    meshes.push(mesh)
    per.push(n)
    cols.push([c0, c1, c2, c3])
    owner.push(new Int32Array(cap).fill(-1))
  }
  return { meshes, specs: MESH_SPECS, per, cols, owner, material, geos }
}

interface MemberState {
  clock: Float32Array
  seed: Float32Array
  stride: Float32Array
  scale: Float32Array
  shade: Float32Array
  trans: Float32Array
  lastKey: Int8Array
  shown: Uint8Array
  cur: Pose[]
  from: Pose[]
}

const ACTION_KEY: Record<Action, number> = { walk: 0, idle: 1, work: 2, guard: 3, salute: 4, inspect: 5, talk: 6 }
const TRANSITION_TIME = 0.4

function makeState(capacity: number): MemberState {
  const st: MemberState = {
    clock: new Float32Array(capacity),
    seed: new Float32Array(capacity),
    stride: new Float32Array(capacity),
    scale: new Float32Array(capacity),
    shade: new Float32Array(capacity),
    trans: new Float32Array(capacity).fill(1),
    lastKey: new Int8Array(capacity).fill(-1),
    shown: new Uint8Array(capacity),
    cur: [],
    from: [],
  }
  for (let i = 0; i < capacity; i++) {
    st.seed[i] = hash01(i * 13 + 1)
    st.stride[i] = strideScaleFor(i)
    st.scale[i] = 0.95 + hash01(i * 31 + 5) * 0.09
    st.shade[i] = 0.94 + hash01(i * 17 + 9) * 0.1
    st.cur.push(createPose())
    st.from.push(createPose())
  }
  return st
}

export function Crowd({
  members,
  capacity,
  castShadow = false,
}: {
  members: React.MutableRefObject<CrowdMember[]>
  capacity: number
  castShadow?: boolean
}) {
  const built = useMemo(() => build(capacity, castShadow), [capacity, castShadow])
  const state = useMemo(() => makeState(capacity), [capacity])
  const scratch = useRef({
    target: createPose(),
    mats: Array.from({ length: PART_COUNT }, () => new Matrix4()),
    root: new Matrix4(),
    tmp: new Matrix4(),
    scaleV: new Vector3(),
    opts: { seed: 0, stride: 1, carry: false } as Required<PoseOptions>,
    colors: [new Color(), new Color(), new Color(), new Color()],
    counts: new Int32Array(MESH_SPECS.length),
    dirty: new Uint8Array(MESH_SPECS.length),
  })

  useEffect(() => {
    return () => {
      for (const g of built.geos) g.dispose()
      built.material.dispose()
      for (const m of built.meshes) m.dispose()
    }
  }, [built])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const s = scratch.current
    const list = members.current
    const n = Math.min(list.length, capacity)
    const { meshes, specs, per, cols, owner } = built
    const counts = s.counts
    counts.fill(0)
    s.dirty.fill(0)
    const mats = s.mats

    for (let i = 0; i < n; i++) {
      const m = list[i]
      if (!m || !m.visible) {
        state.shown[i] = 0
        continue
      }
      const walking = m.action === 'walk' && m.speed > WALK_MIN_SPEED
      const action: Action = m.action === 'walk' && !walking ? 'idle' : m.action
      state.clock[i] = advancePhase(state.clock[i], action, m.speed, dt, state.stride[i])
      const o = s.opts
      o.seed = state.seed[i]
      o.stride = state.stride[i]
      o.carry = m.variant === 'trooper'
      computePose(action, m.phase + state.clock[i], m.speed, s.target, o)

      // blend between actions
      const key = ACTION_KEY[action]
      const cur = state.cur[i]
      if (!state.shown[i]) {
        copyPose(s.target, cur)
        state.trans[i] = 1
        state.lastKey[i] = key
      } else {
        if (key !== state.lastKey[i]) {
          copyPose(cur, state.from[i])
          state.trans[i] = 0
          state.lastKey[i] = key
        }
        if (state.trans[i] < 1) {
          state.trans[i] = Math.min(1, state.trans[i] + dt / TRANSITION_TIME)
          const t = state.trans[i]
          lerpPose(state.from[i], s.target, t * t * (3 - 2 * t), cur)
        } else copyPose(s.target, cur)
      }
      state.shown[i] = 1

      // forward kinematics
      const sc = state.scale[i]
      s.root.makeRotationY(m.heading).scale(s.scaleV.set(sc, sc, sc)).setPosition(m.x, m.y, m.z)
      poseToMatrices(cur, s.root, mats)

      const vIdx = VARIANT_INDEX[m.variant] ?? 0
      const code = i * 16 + vIdx
      for (let k = 0; k < specs.length; k++) {
        const spec = specs[k]
        if (spec.only && !spec.only.includes(m.variant)) continue
        const mesh = meshes[k]
        const base = counts[k]
        const slot = spec.slot
        if (slot.kind === 'part') mesh.setMatrixAt(base, mats[slot.part])
        else if (slot.kind === 'pair') {
          mesh.setMatrixAt(base, mats[slot.left])
          mesh.setMatrixAt(base + 1, mats[slot.right])
        } else {
          s.tmp.multiplyMatrices(mats[PART.torso], RIFLE_MATRIX)
          mesh.setMatrixAt(base, s.tmp)
        }
        // colours only when the slot changes hands
        const own = owner[k]
        if (own[base] !== code) {
          resolveChannels(spec.key, PALETTES[m.variant] ?? PALETTES.officer, s.colors, state.seed[i], state.shade[i])
          const c = cols[k]
          for (let j = 0; j < per[k]; j++) {
            own[base + j] = code
            for (let ch = 0; ch < 4; ch++) c[ch].setXYZ(base + j, s.colors[ch].r, s.colors[ch].g, s.colors[ch].b)
          }
          s.dirty[k] = 1
        }
        counts[k] = base + per[k]
      }
    }

    for (let k = 0; k < meshes.length; k++) {
      const mesh = meshes[k]
      mesh.count = counts[k]
      if (counts[k] > 0) mesh.instanceMatrix.needsUpdate = true
      if (s.dirty[k]) for (const c of cols[k]) c.needsUpdate = true
    }
  })

  return (
    <group name="crowd">
      {built.meshes.map((m) => (
        <primitive key={m.uuid} object={m} />
      ))}
    </group>
  )
}

export default Crowd

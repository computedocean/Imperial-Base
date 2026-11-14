// Original ground-vehicle designs for the garrison motor pool, built with the merged-geometry Kit
// (one geometry per material per type → rendered as InstancedMeshes). Units: metres, nose = +Z,
// y = 0 is the underside of the repulsor pods (the layer adds the hover height).
import * as THREE from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { plainGeometry, withBakedAO } from '../aircraft/models/Baked'
import { Kit } from '../world/kit'
import type { MatKey } from '../world/materials'
import type { VehicleType } from './routes'

/** four repulsor pods with glowing emitters underneath */
function pods(k: Kit, hw: number, zs: number[], r = 0.6) {
  for (const z of zs) for (const s of [-1, 1]) {
    k.cyl('black', r, r * 1.15, 0.55, [s * hw, 0.05, z], 10)
    k.cyl('holo', r * 0.8, r * 0.8, 0.06, [s * hw, 0, z], 10)
  }
}

function lights(k: Kit, hw: number, front: number, back: number, y: number) {
  for (const s of [-1, 1]) {
    k.box('whiteLight', [0.45, 0.22, 0.12], [s * hw, y, front])
    k.box('red', [0.4, 0.2, 0.1], [s * hw, y, back])
  }
}

/** Heavy repulsor cargo hauler: armoured cab, flat bed with two cargo modules. ~14 m. */
function hauler() {
  const k = new Kit()
  pods(k, 1.6, [4.5, -5])
  k.box('dark', [4.2, 0.8, 12], [0, 0.55, -0.8])
  k.taper('hull', [4.0, 3.4], [3.2, 2.0], 2.3, [0, 1.35, 5.4])
  k.boxR('glass', [3.0, 0.7, 0.12], [0, 3.05, 6.5], [-0.75, 0, 0])
  k.box('black', [4.3, 0.3, 0.4], [0, 1.0, 7.1])
  k.box('rust', [3.6, 2.4, 4.0], [0, 1.35, -0.2])
  k.box('hull', [3.6, 2.4, 3.6], [0, 1.35, -4.6])
  k.box('stripe', [3.65, 0.25, 3.65], [0, 2.9, -4.6])
  k.box('black', [4.4, 0.5, 0.6], [0, 0.7, -6.8])
  k.cyl('black', 0.08, 0.08, 1.6, [1.2, 3.6, 4.6], 6)
  k.box('amber', [0.35, 0.25, 0.35], [-1.0, 3.65, 5.0])
  lights(k, 1.5, 7.15, -7.1, 1.15)
  return k
}

/** Two-seat patrol speeder: low wedge hull, bubble canopy, twin rear thrusters. ~5.5 m. */
function speeder() {
  const k = new Kit()
  pods(k, 0.9, [1.6, -1.6], 0.42)
  k.taper('dark', [2.3, 4.4], [1.5, 3.4], 0.75, [0, 0.4, -0.3])
  k.taper('hull', [2.0, 1.6], [1.0, 0.4], 0.55, [0, 0.45, 2.6])
  k.add('glass', new THREE.SphereGeometry(0.75, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), [0, 1.15, -0.2], [0, 0, 0], [1, 0.8, 1.6])
  for (const s of [-1, 1]) {
    k.cyl('black', 0.32, 0.38, 1.9, [s * 1.25, 0.75 - 0.95, -1.8], 10, [Math.PI / 2, 0, 0])
    k.cyl('holo', 0.26, 0.26, 0.08, [s * 1.25, 0.75 - 0.04, -2.78], 10, [Math.PI / 2, 0, 0])
  }
  k.box('red', [2.32, 0.1, 0.5], [0, 1.15, 0.8])
  k.box('whiteLight', [0.9, 0.12, 0.12], [0, 0.65, 3.0])
  return k
}

/** Fuel tender: cab, cylindrical tank with hazard bands, hose reel. ~11 m. */
function tender() {
  const k = new Kit()
  pods(k, 1.4, [3.6, -3.8])
  k.box('dark', [3.6, 0.7, 10.6], [0, 0.5, 0])
  k.box('hull', [3.4, 2.2, 2.6], [0, 1.2, 3.9])
  k.boxR('glass', [2.8, 0.75, 0.12], [0, 2.75, 5.22], [-0.25, 0, 0])
  const tankLen = 6.6
  k.cyl('light', 1.35, 1.35, tankLen, [0, 2.65 - tankLen / 2, -1.2], 18, [Math.PI / 2, 0, 0])
  for (const z of [1.7, -4.1]) k.cyl('stripe', 1.42, 1.42, 0.45, [0, 2.65 - 0.225, z], 18, [Math.PI / 2, 0, 0])
  k.cyl('black', 0.7, 0.7, 0.5, [1.6, 1.25, -4.4], 12, [0, 0, Math.PI / 2])
  k.box('amber', [0.4, 0.3, 0.4], [0, 3.4, 3.9])
  lights(k, 1.3, 5.25, -5.35, 1.0)
  return k
}

/** Armoured troop carrier: sloped glacis, vision slits, small roof turret. ~10 m. */
function troop() {
  const k = new Kit()
  pods(k, 1.55, [3.2, -3.4])
  k.taper('dark', [4.0, 8.4], [3.4, 7.6], 2.5, [0, 0.55, -0.6])
  k.taper('hull', [3.8, 2.2], [3.2, 0.6], 1.9, [0, 0.55, 4.6])
  k.box('hull', [3.0, 0.5, 6.0], [0, 3.05, -0.8])
  for (const s of [-1, 1]) k.box('glass', [0.06, 0.35, 4.6], [s * 1.86, 2.25, -0.6])
  k.box('glass', [2.4, 0.3, 0.06], [0, 2.3, 3.6])
  k.cyl('black', 0.75, 0.85, 0.6, [0, 3.55, 0.6], 12)
  k.boxR('black', [0.18, 0.18, 2.2], [0, 3.95, 1.9], [0.05, 0, 0])
  k.box('black', [3.0, 1.6, 0.2], [0, 0.9, -4.95])
  k.box('stripe', [4.05, 0.18, 0.6], [0, 2.0, 3.0])
  lights(k, 1.6, 5.7, -5.0, 1.2)
  return k
}

/**
 * Scout speeder bike with its rider: slim engine under the saddle, a long twin-rail nose boom ending
 * in steering vanes, one rear thruster. The rider is part of the model (crouched over the bars), so a
 * patrol costs no extra draw calls. ~4.6 m.
 */
function bike() {
  const k = new Kit()
  /** cylinder lying along the bike (z axis), centred at pos; r0 is the rear radius, r1 the front */
  const zcyl = (mat: MatKey, r0: number, r1: number, len: number, pos: [number, number, number]) =>
    k.cyl(mat, r1, r0, len, [pos[0], pos[1] - len / 2, pos[2]], 10, [Math.PI / 2, 0, 0])
  // --- machine
  k.taper('dark', [0.46, 1.7], [0.36, 1.4], 0.4, [0, 0.12, -0.55])
  k.box('holo', [0.2, 0.03, 1.0], [0, 0.085, -0.5])
  zcyl('black', 0.26, 0.2, 0.7, [0, 0.36, -1.6])
  zcyl('holo', 0.17, 0.17, 0.05, [0, 0.36, -1.97])
  for (const s of [-1, 1]) k.boxR('hull', [0.04, 0.3, 0.5], [s * 0.3, 0.4, -1.4], [0, s * 0.25, 0])
  k.box('black', [0.34, 0.1, 0.85], [0, 0.52, -0.6])
  k.taper('hull', [0.4, 0.7], [0.26, 0.45], 0.3, [0, 0.5, 0.35])
  for (const s of [-1, 1]) k.box('dark', [0.06, 0.06, 2.2], [s * 0.11, 0.34, 1.55])
  k.box('black', [0.08, 0.08, 1.4], [0, 0.16, 1.3])
  k.box('dark', [0.56, 0.07, 0.1], [0, 0.33, 2.55])
  for (const s of [-1, 1]) {
    k.box('hull', [0.04, 0.36, 0.62], [s * 0.26, 0.2, 2.75])
    k.boxR('hull', [0.42, 0.035, 0.5], [s * 0.44, 0.5, 2.7], [0, 0, -s * 0.3])
  }
  k.box('black', [0.7, 0.05, 0.05], [0, 0.86, 0.35])
  for (const s of [-1, 1]) k.boxR('black', [0.04, 0.4, 0.04], [s * 0.2, 0.72, 0.3], [0.3, 0, 0])
  k.box('black', [0.75, 0.05, 0.12], [0, 0.2, -0.9])
  k.box('whiteLight', [0.14, 0.08, 0.06], [0, 0.62, 0.72])
  k.box('red', [0.2, 0.06, 0.05], [0, 0.5, -1.3])
  // --- rider: black body glove, white armour plates, leaning into the wind
  const lean = 0.6
  k.box('black', [0.34, 0.2, 0.3], [0, 0.62, -0.72])
  k.boxR('light', [0.4, 0.6, 0.26], [0, 1.05, -0.55], [lean, 0, 0])
  k.boxR('black', [0.3, 0.36, 0.12], [0, 1.14, -0.72], [lean, 0, 0])
  k.sphere('light', 0.15, [0, 1.43, -0.25], 12)
  k.box('black', [0.2, 0.06, 0.1], [0, 1.4, -0.14])
  for (const s of [-1, 1]) {
    k.boxR('light', [0.16, 0.16, 0.5], [s * 0.22, 0.66, -0.45], [0.2, 0, 0])
    k.boxR('black', [0.13, 0.46, 0.13], [s * 0.31, 0.44, -0.78], [-0.45, 0, 0])
    k.box('light', [0.14, 0.1, 0.3], [s * 0.33, 0.22, -0.92])
    k.boxR('black', [0.11, 0.11, 0.8], [s * 0.27, 1.07, -0.02], [0.48, 0, 0])
    k.boxR('light', [0.13, 0.13, 0.3], [s * 0.29, 0.96, 0.2], [0.48, 0, 0])
    k.boxR('light', [0.18, 0.12, 0.2], [s * 0.26, 1.28, -0.38], [lean, 0, 0])
  }
  return k
}

const BUILDERS: Record<VehicleType, () => Kit> = { hauler, speeder, tender, troop, bike }

/** Types that also have a Blender-built model in public/models (the rest stay code-built). */
export const HAS_BAKED: Record<VehicleType, boolean> = { hauler: true, speeder: true, tender: true, troop: true, bike: false }

/** How hard a type leans into a turn, and the most it may lean (radians). */
export const BANK: Record<VehicleType, { k: number; max: number }> = {
  hauler: { k: 0.06, max: 0.35 }, tender: { k: 0.06, max: 0.35 }, troop: { k: 0.06, max: 0.35 }, speeder: { k: 0.22, max: 0.35 }, bike: { k: 0.3, max: 0.7 },
}

/** Hover height (pod underside above ground) per type. */
export const HOVER: Record<VehicleType, number> = { hauler: 0.7, speeder: 0.9, tender: 0.65, troop: 0.7, bike: 0.8 }

/** Flat colours used instead of the textured world materials (vehicles are small; 2 draw calls per type). */
const BODY: Partial<Record<MatKey, string>> = {
  hull: '#c3c8cd', dark: '#5a6169', light: '#d6d9dc', black: '#1d2025', glass: '#0e151c', stripe: '#c29a32', rust: '#76583f', concrete: '#a39b90',
}
const GLOW: Partial<Record<MatKey, string>> = { red: '#ff3a26', whiteLight: '#e8f2ff', amber: '#ffa22a', holo: '#4cb8ff' }

function colorize(g: THREE.BufferGeometry, hex: string, keepUv = false) {
  const c = new THREE.Color(hex)
  const n = g.attributes.position.count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  if (!keepUv) g.deleteAttribute('uv')
  return g
}

/** One vertex-coloured body geometry + one emissive glow geometry per vehicle type. */
export function buildVehicle(type: VehicleType): { body: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const parts = BUILDERS[type]().build()
  const body: THREE.BufferGeometry[] = []
  const glow: THREE.BufferGeometry[] = []
  for (const p of parts) {
    if (GLOW[p.mat]) glow.push(colorize(p.geometry, GLOW[p.mat]!))
    else body.push(colorize(p.geometry, BODY[p.mat] ?? '#888888'))
  }
  const out = { body: mergeGeometries(body, false)!, glow: mergeGeometries(glow, false)! }
  body.concat(glow).forEach((g) => g.dispose())
  out.body.computeBoundingSphere()
  out.glow.computeBoundingSphere()
  return out
}

let _bodyMat: THREE.MeshStandardMaterial | null = null
let _glowMat: THREE.MeshBasicMaterial | null = null
export const vehicleMaterials = () => ({
  body: (_bodyMat ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 })),
  // > 1 so the lights catch the bloom pass on high/cinematic
  glow: (_glowMat ??= new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, color: new THREE.Color(2.4, 2.4, 2.4) })),
})

export interface BakedVehicle { body: THREE.BufferGeometry; glow: THREE.BufferGeometry; material: THREE.MeshStandardMaterial }

/**
 * The Blender-built version of a vehicle (tools/blender/vehicles.py): public/models/veh_<type>.glb plus its baked
 * shadow map. It is merged the same way as the code-built one (one vertex-coloured body, one glow geometry), so it
 * still draws as two instanced meshes per type. Rejects if a file is missing; the caller keeps the code-built model.
 */
export async function loadBakedVehicle(type: VehicleType): Promise<BakedVehicle> {
  const base = `${import.meta.env.BASE_URL}models/veh_${type}`
  const [gltf, ao] = await Promise.all([new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${base}.glb`), new THREE.TextureLoader().loadAsync(`${base}_ao.jpg`)])
  ao.flipY = false // glTF UV convention
  ao.channel = 1
  ao.colorSpace = THREE.NoColorSpace
  ao.anisotropy = 4
  const body: THREE.BufferGeometry[] = []
  const glow: THREE.BufferGeometry[] = []
  gltf.scene.updateMatrixWorld(true)
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const name = ((mesh.material as THREE.Material).name || 'hull').replace(/\.\d+$/, '') as MatKey
    const g = plainGeometry(mesh)
    if (GLOW[name]) glow.push(colorize(g, GLOW[name]!, true))
    else body.push(colorize(g, BODY[name] ?? '#888888', true))
  })
  const out = { body: mergeGeometries(body, false)!, glow: mergeGeometries(glow, false)! }
  body.concat(glow).forEach((g) => g.dispose())
  out.body.computeBoundingSphere()
  out.glow.computeBoundingSphere()
  const material = withBakedAO(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 }), ao)
  return { ...out, material }
}

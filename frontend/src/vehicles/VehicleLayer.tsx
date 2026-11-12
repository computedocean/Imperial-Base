// Garrison motor pool: repulsor vehicles driving the base's roads, plus the animated gate booms.
// Each vehicle type is one merged geometry per material, drawn as an InstancedMesh, so the whole
// fleet costs 8 draw calls (body + glow per type) regardless of how many vehicles are out.
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { QUALITY, useStore } from '../state/store'
import { Kit } from '../world/kit'
import { GATES, PLATEAU_RADIUS } from '../world/layout'
import { MAT } from '../world/materials'
import { makeTerrainSampler } from '../world/terrainSampler'
import { HOVER, buildVehicle, loadBakedVehicle, vehicleMaterials, type BakedVehicle } from './models'
import { Follower, UNITS, routes, type Pose, type VehicleType } from './routes'

interface Slot { type: VehicleType; index: number; phase: number; yaw: number; roll: number; y: number }

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler(0, 0, 0, 'YXZ')
const _p = new THREE.Vector3()
const _s = new THREE.Vector3(1, 1, 1)

/** live vehicle positions (gate booms + QA read these) */
export const vehicleState: { poses: { id: string; type: VehicleType; x: number; y: number; z: number; speed: number }[] } = { poses: [] }

export function VehicleLayer({ visible = true }: { visible?: boolean }) {
  const quality = useStore((s) => s.quality)
  const segs = QUALITY[quality].terrainSegments
  const full = quality !== 'low'

  const { units, slots, counts } = useMemo(() => {
    const R = routes()
    const units = UNITS.filter((u) => full || u.minQuality === 0).map((u) => ({
      spec: u,
      f: new Follower(R[u.route], { s: u.s, delay: u.delay, dwellA: u.dwellA, dwellB: u.dwellB, members: u.types.length, gap: u.gap }),
    }))
    const counts: Record<VehicleType, number> = { hauler: 0, speeder: 0, tender: 0, troop: 0 }
    const slots: Slot[][] = units.map((u, ui) => u.spec.types.map((type, k) => ({ type, index: counts[type]++, phase: ui * 1.7 + k * 0.9, yaw: NaN, roll: 0, y: 0 })))
    return { units, slots, counts }
  }, [full])

  const geos = useMemo(() => {
    const out: Partial<Record<VehicleType, ReturnType<typeof buildVehicle>>> = {}
    for (const t of Object.keys(counts) as VehicleType[]) if (counts[t] > 0) out[t] = buildVehicle(t)
    return out
  }, [counts])
  useEffect(() => () => Object.values(geos).forEach((g) => { g?.body.dispose(); g?.glow.dispose() }), [geos])

  // Blender-built models replace the code-built ones as they arrive (not on LOW quality)
  const [baked, setBaked] = useState<Partial<Record<VehicleType, BakedVehicle>>>({})
  useEffect(() => {
    if (!full) { setBaked({}); return }
    let live = true
    for (const t of Object.keys(counts) as VehicleType[]) {
      if (counts[t] === 0) continue
      loadBakedVehicle(t).then((b) => { if (live) setBaked((prev) => ({ ...prev, [t]: b })) })
        .catch((e) => console.warn(`[vehicles] ${t}: keeping the code-built model:`, e))
    }
    return () => { live = false }
  }, [counts, full])

  const meshes = useRef<Record<string, THREE.InstancedMesh | null>>({})
  const ground = useMemo(() => {
    const sample = makeTerrainSampler(segs)
    // match the rendered outpost road: highest of a few samples across the road width (+ ribbon lift)
    return (x: number, z: number) => {
      if (Math.hypot(x, z) < PLATEAU_RADIUS) return 0
      let h = -Infinity
      for (const o of [-6, 0, 6]) for (const q of [-6, 0, 6]) h = Math.max(h, sample(x + o, z + q))
      return h + 0.35
    }
  }, [segs])

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const t = clock.elapsedTime
    const poses: typeof vehicleState.poses = []
    units.forEach((u, ui) => {
      const ps: Pose[] = u.f.step(dt)
      ps.forEach((p, k) => {
        const slot = slots[ui][k]
        // heading smoothing + bank into turns (speeders bank harder)
        if (Number.isNaN(slot.yaw)) slot.yaw = p.yaw
        let dy = p.yaw - slot.yaw
        dy = Math.atan2(Math.sin(dy), Math.cos(dy))
        const yawRate = dy / Math.max(dt, 1e-3)
        slot.yaw += dy * Math.min(1, dt * 6)
        const bankK = slot.type === 'speeder' ? 0.22 : 0.06
        slot.roll += (THREE.MathUtils.clamp(-yawRate * p.speed * bankK * 0.1, -0.35, 0.35) - slot.roll) * Math.min(1, dt * 3)
        // ground + slope pitch outside the plateau
        const fx = Math.sin(slot.yaw) * 4
        const fz = Math.cos(slot.yaw) * 4
        const g = ground(p.x, p.z)
        const pitch = Math.atan2(ground(p.x - fx, p.z - fz) - ground(p.x + fx, p.z + fz), 8)
        const idle = p.speed < 0.2
        const bob = Math.sin(t * (idle ? 1.6 : 2.3) + slot.phase) * (idle ? 0.06 : 0.1)
        const y = g + HOVER[slot.type] + bob
        _e.set(pitch + Math.sin(t * 1.3 + slot.phase) * 0.01, slot.yaw, slot.roll)
        _q.setFromEuler(_e)
        _m.compose(_p.set(p.x, y, p.z), _q, _s)
        meshes.current[`${slot.type}:body`]?.setMatrixAt(slot.index, _m)
        meshes.current[`${slot.type}:glow`]?.setMatrixAt(slot.index, _m)
        poses.push({ id: `${u.spec.id}${u.spec.types.length > 1 ? `-${k}` : ''}`, type: slot.type, x: p.x, y, z: p.z, speed: p.speed })
      })
    })
    for (const m of Object.values(meshes.current)) if (m) m.instanceMatrix.needsUpdate = true
    vehicleState.poses = poses
    ;(window as any).__imperialVehicles = poses
  })

  return (
    <group name="vehicles" visible={visible}>
      {(Object.keys(geos) as VehicleType[]).flatMap((type) =>
        (['body', 'glow'] as const).map((part) => (
          <instancedMesh
            key={`${type}:${part}:${baked[type] ? 'baked' : 'code'}`}
            ref={(m) => { meshes.current[`${type}:${part}`] = m; if (m) m.frustumCulled = false }}
            args={[baked[type]?.[part] ?? geos[type]![part], part === 'body' && baked[type] ? baked[type]!.material : vehicleMaterials()[part], counts[type]]}
            castShadow={part === 'body'}
            receiveShadow={part === 'body'}
          />
        )),
      )}
      <GateBooms />
    </group>
  )
}

/** Boom barriers at each gate checkpoint; they lift when a vehicle comes within 45 m. */
function GateBooms() {
  const booms = useMemo(() => {
    const k = new Kit()
    const L = 17
    k.box('stripe', [L, 0.35, 0.35], [L / 2, -0.175, 0])
    for (let x = 1.5; x < L; x += 3) k.box('red', [1.2, 0.37, 0.37], [x, -0.185, 0])
    const post = new Kit()
    post.cyl('dark', 0.45, 0.6, 1.6, [0, -1.4, 0], 10)
    post.box('amber', [0.3, 0.3, 0.3], [0, 0.2, 0])
    return { boom: k.build(), post: post.build() }
  }, [])
  const groups = useRef<(THREE.Group | null)[]>([])
  const lift = useRef(GATES.map(() => 0))
  const frames = useMemo(() => GATES.map((g) => {
    const ux = Math.cos(g.rotY)
    const uz = -Math.sin(g.rotY)
    const r0 = Math.hypot(g.x, g.z)
    const nx = -g.x / r0
    const nz = -g.z / r0
    // hinge beside the booth (booth sits at +14 along the wall axis); the boom spans the road toward -axis
    return { x: g.x + nx * 9 + ux * 9, z: g.z + nz * 9 + uz * 9, rotY: Math.atan2(uz, -ux), gx: g.x, gz: g.z }
  }), [])
  useFrame((_, dt) => {
    frames.forEach((f, i) => {
      const near = vehicleState.poses.some((p) => Math.hypot(p.x - f.gx, p.z - f.gz) < 45)
      lift.current[i] += ((near ? 1 : 0) - lift.current[i]) * Math.min(1, dt * 2.5)
      const g = groups.current[i]
      if (g) g.rotation.z = lift.current[i] * 1.35
    })
  })
  return (
    <>
      {frames.map((f, i) => (
        <group key={i} position={[f.x, 1.4, f.z]} rotation={[0, f.rotY, 0]}>
          {booms.post.map((b) => <mesh key={b.mat} geometry={b.geometry} material={MAT[b.mat]()} castShadow />)}
          <group ref={(g) => { groups.current[i] = g }}>
            {booms.boom.map((b) => <mesh key={b.mat} geometry={b.geometry} material={MAT[b.mat]()} castShadow />)}
          </group>
        </group>
      ))}
    </>
  )
}

// Roadside dressing: lamp pylons with emissive heads, centre-line dashes, barriers and crates.
// Everything is instanced: 5 draw calls in total.
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Kit } from '../world/kit'
import { MAT } from '../world/materials'
import { blockPlacements, dashPlacements, lampPlacements } from './propPlacement'

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)

function useInstances(ref: React.RefObject<THREE.InstancedMesh | null>, n: number, fill: (i: number, m: THREE.Matrix4) => void, deps: unknown[]) {
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    for (let i = 0; i < n; i++) { fill(i, _m); mesh.setMatrixAt(i, _m) }
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
}

export function RoadProps() {
  const lamps = useMemo(() => lampPlacements(), [])
  const dashes = useMemo(() => dashPlacements(), [])
  const blocks = useMemo(() => blockPlacements(), [])
  const crates = blocks.filter((b) => b.tint >= 0)
  const barriers = blocks.filter((b) => b.tint < 0)

  const lampGeo = useMemo(() => {
    const k = new Kit()
    k.cyl('dark', 0.16, 0.24, 8.6, [0, 0, 0], 8)
    k.box('dark', [0.9, 0.5, 0.9], [0, 0, 0])
    k.box('dark', [0.16, 0.16, 2.4], [0, 8.4, 1.1])
    k.box('whiteLight', [0.5, 0.18, 0.9], [0, 8.2, 2.2])
    const parts = k.build()
    return { pole: parts.find((p) => p.mat === 'dark')!.geometry, head: parts.find((p) => p.mat === 'whiteLight')!.geometry }
  }, [])
  const dashGeo = useMemo(() => new THREE.PlaneGeometry(0.35, 1).rotateX(-Math.PI / 2), [])
  const dashMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d9d2bf', roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -8 }), [])
  const barrierGeo = useMemo(() => {
    // jersey barrier profile: wide foot, narrow top
    const g = new THREE.BoxGeometry(1, 1, 1)
    const p = g.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * (p.getY(i) > 0 ? 0.45 : 1))
    g.translate(0, 0.5, 0)
    g.computeVertexNormals()
    return g
  }, [])
  const crateGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), [])
  const crateMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75, metalness: 0.25 }), [])

  const poles = useRef<THREE.InstancedMesh>(null)
  const heads = useRef<THREE.InstancedMesh>(null)
  const dashRef = useRef<THREE.InstancedMesh>(null)
  const barrierRef = useRef<THREE.InstancedMesh>(null)
  const crateRef = useRef<THREE.InstancedMesh>(null)

  const lampMatrix = (i: number, m: THREE.Matrix4) => m.compose(_p.set(lamps[i].x, 0, lamps[i].z), _q.setFromAxisAngle(_up, lamps[i].rotY), _s.set(1, 1, 1))
  useInstances(poles, lamps.length, lampMatrix, [lamps])
  useInstances(heads, lamps.length, lampMatrix, [lamps])
  useInstances(dashRef, dashes.length, (i, m) => m.compose(_p.set(dashes[i].x, 0.11, dashes[i].z), _q.setFromAxisAngle(_up, dashes[i].rotY), _s.set(1, 1, dashes[i].len)), [dashes])
  useInstances(barrierRef, barriers.length, (i, m) => {
    const b = barriers[i]
    m.compose(_p.set(b.x, 0, b.z), _q.setFromAxisAngle(_up, b.rotY), _s.set(b.sx, b.sy, b.sz))
  }, [barriers])
  useInstances(crateRef, crates.length, (i, m) => {
    const b = crates[i]
    m.compose(_p.set(b.x, 0, b.z), _q.setFromAxisAngle(_up, b.rotY), _s.set(b.sx, b.sy, b.sz))
  }, [crates])
  useLayoutEffect(() => {
    const mesh = crateRef.current
    if (!mesh) return
    const tints = [new THREE.Color('#8a6a4e'), new THREE.Color('#5d6670'), new THREE.Color('#a89a7a')]
    crates.forEach((c, i) => mesh.setColorAt(i, tints[c.tint % tints.length]))
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [crates])

  return (
    <group name="road-props">
      <instancedMesh ref={poles} args={[lampGeo.pole, MAT.dark(), lamps.length]} castShadow receiveShadow />
      <instancedMesh ref={heads} args={[lampGeo.head, MAT.whiteLight(), lamps.length]} />
      <instancedMesh ref={dashRef} args={[dashGeo, dashMat, dashes.length]} receiveShadow />
      <instancedMesh ref={barrierRef} args={[barrierGeo, MAT.concrete(), barriers.length]} castShadow receiveShadow />
      <instancedMesh ref={crateRef} args={[crateGeo, crateMat, crates.length]} castShadow receiveShadow />
    </group>
  )
}

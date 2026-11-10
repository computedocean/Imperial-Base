/**
 * Fuel depot on the east apron, inside the wall: storage tanks, pipework and a parked fuel truck.
 * It is the X-wing's ground target. When it is hit it becomes a burning wreck under a column of
 * smoke; some time later the depot is rebuilt. Simulated scenery — not real telemetry.
 */
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { FUEL_DUMP } from '../aircraft/flight'
import { puffTexture } from '../aircraft/Combat'
import { sim } from '../sim/world'

const FIRES = 7
const SMOKE = 16
/** fires die down after this long; the smoke thins out a little later */
const BURN_S = 70

/** Seconds since the dump was last hit, or -1 when it is standing (never hit, or rebuilt since). */
export function dumpBurnAge() {
  const at = sim.xwing.strikeAt
  if (at === null) return -1
  const age = sim.time - at
  return age >= 0 && age < FUEL_DUMP.rebuildAfter ? age : -1
}

export function FuelDump({ visible = true }: { visible?: boolean }) {
  const intact = useRef<THREE.Group>(null)
  const wreck = useRef<THREE.Group>(null)
  const fires = useRef<(THREE.Sprite | null)[]>([])
  const smokes = useRef<(THREE.Sprite | null)[]>([])
  const m = useMemo(() => {
    const map = puffTexture()
    return {
      pad: new THREE.MeshStandardMaterial({ color: '#5b5750', roughness: 0.95, metalness: 0.05 }),
      tank: new THREE.MeshStandardMaterial({ color: '#8f959c', roughness: 0.45, metalness: 0.7 }),
      band: new THREE.MeshStandardMaterial({ color: '#b3402c', roughness: 0.6, metalness: 0.3 }),
      steel: new THREE.MeshStandardMaterial({ color: '#4d535a', roughness: 0.6, metalness: 0.7 }),
      truck: new THREE.MeshStandardMaterial({ color: '#6c705f', roughness: 0.7, metalness: 0.4 }),
      glass: new THREE.MeshStandardMaterial({ color: '#16202a', roughness: 0.2, metalness: 0.8 }),
      char: new THREE.MeshStandardMaterial({ color: '#141210', roughness: 1, metalness: 0.1 }),
      ember: new THREE.MeshStandardMaterial({ color: '#2a1508', roughness: 1, emissive: '#ff5a10', emissiveIntensity: 1.2 }),
      scorch: new THREE.MeshBasicMaterial({ map, color: '#000000', transparent: true, opacity: 0.75, depthWrite: false }),
      fire: Array.from({ length: FIRES }, (_, i) => new THREE.SpriteMaterial({ map, color: i % 2 ? '#ff6a14' : '#ffb03a', toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })),
      smoke: Array.from({ length: SMOKE }, () => new THREE.SpriteMaterial({ map, color: '#0d0b0a', transparent: true, depthWrite: false, fog: false })),
    }
  }, [])
  // where the fires sit (the three tanks, the tower, the truck)
  const hearths: [number, number, number][] = [[-7, 2.5, -4], [0, 2.5, -4], [7, 2.2, -4], [-10, 3, 5], [8, 1.8, 6], [2, 1.2, 2], [-3, 1.5, 7]]

  useFrame(() => {
    const age = dumpBurnAge()
    const burning = age >= 0
    if (intact.current) intact.current.visible = !burning
    if (wreck.current) wreck.current.visible = burning
    if (!burning) return
    const t = sim.time
    const heat = Math.max(0, 1 - age / BURN_S) // fires die down
    m.ember.emissiveIntensity = 0.25 + heat * (1.2 + Math.sin(t * 9) * 0.4)
    fires.current.forEach((sp, i) => {
      if (!sp) return
      const [x, y, z] = hearths[i]
      const lick = 0.75 + 0.25 * Math.sin(t * (7 + i * 1.3) + i) + 0.15 * Math.sin(t * 23 + i * 2)
      sp.visible = heat > 0.02
      sp.position.set(x + Math.sin(t * 3 + i) * 0.4, y + 2 + lick * 2.2 * heat, z)
      sp.scale.set((6 + i % 3 * 2) * (0.5 + heat * 0.6), (9 + i % 2 * 4) * lick * (0.4 + heat * 0.7), 1)
      m.fire[i].opacity = Math.min(1, heat * 1.6) * (0.75 + 0.25 * lick)
    })
    const thin = Math.max(0, Math.min(1, (FUEL_DUMP.rebuildAfter - 6 - age) / 25)) * Math.min(1, age / 2)
    smokes.current.forEach((sp, i) => {
      if (!sp) return
      // each puff rises, swells, leans downwind and fades, then starts again at the fire
      const k = (age * 0.06 + i / SMOKE) % 1
      sp.position.set(-2 + k * k * 46 + Math.sin(i * 2.4) * 3, 5 + k * 120, 1 + k * 18 + Math.cos(i * 1.7) * 3)
      sp.scale.setScalar(16 + k * 64)
      m.smoke[i].opacity = (1 - k * 0.75) * Math.min(1, k * 10) * thin
    })
  })

  const tank = (x: number, key: string) => (
    <group key={key} position={[x, 3.1, -4]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} material={m.tank} castShadow receiveShadow><cylinderGeometry args={[2.6, 2.6, 9, 20]} /></mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} material={m.band}><cylinderGeometry args={[2.66, 2.66, 0.9, 20]} /></mesh>
      {[-3.2, 3.2].map((z) => <mesh key={z} position={[0, -1.9, z]} material={m.steel} castShadow><boxGeometry args={[4.6, 2.4, 0.6]} /></mesh>)}
      {[-4.5, 4.5].map((z) => <mesh key={z} position={[0, 0, z]} scale={[1, 1, 0.35]} material={m.tank}><sphereGeometry args={[2.6, 16, 10]} /></mesh>)}
    </group>
  )
  // tanks towards the wall, truck and crates on the side facing the base
  const yaw = Math.atan2(-FUEL_DUMP.x, -FUEL_DUMP.z)

  return (
    <group name="fuel-dump" visible={visible} position={[FUEL_DUMP.x, 0, FUEL_DUMP.z]} rotation={[0, yaw, 0]}>
      <mesh position={[0, 0.15, 1]} material={m.pad} receiveShadow><boxGeometry args={[30, 0.3, 22]} /></mesh>
      <group ref={intact}>
        {tank(-7, 'a')}{tank(0, 'b')}{tank(7, 'c')}
        {/* header pipe and valves */}
        <mesh position={[0, 1.1, 1.6]} rotation={[0, 0, Math.PI / 2]} material={m.steel} castShadow><cylinderGeometry args={[0.35, 0.35, 21, 10]} /></mesh>
        {[-7, 0, 7].map((x) => <mesh key={x} position={[x, 1.1, 0.9]} rotation={[Math.PI / 2, 0, 0]} material={m.band}><cylinderGeometry args={[0.5, 0.5, 1.4, 10]} /></mesh>)}
        {/* standing tank with ladder cage */}
        <mesh position={[-10, 4, 5.5]} material={m.tank} castShadow receiveShadow><cylinderGeometry args={[2.8, 2.8, 7.4, 20]} /></mesh>
        <mesh position={[-10, 7.9, 5.5]} material={m.steel}><cylinderGeometry args={[1.4, 2.8, 0.6, 20]} /></mesh>
        <mesh position={[-10, 4.6, 5.5]} material={m.band}><cylinderGeometry args={[2.86, 2.86, 0.8, 20]} /></mesh>
        {/* parked fuel truck */}
        <group position={[7.5, 0, 6.5]} rotation={[0, 0.25, 0]}>
          <mesh position={[0, 1.15, 0]} material={m.steel} castShadow><boxGeometry args={[2.5, 0.5, 7.4]} /></mesh>
          <mesh position={[0, 2.35, -0.9]} rotation={[Math.PI / 2, 0, 0]} material={m.truck} castShadow><cylinderGeometry args={[1.25, 1.25, 4.8, 16]} /></mesh>
          <mesh position={[0, 2.35, -0.9]} rotation={[Math.PI / 2, 0, 0]} material={m.band}><cylinderGeometry args={[1.29, 1.29, 0.5, 16]} /></mesh>
          <mesh position={[0, 2.1, 2.7]} material={m.truck} castShadow><boxGeometry args={[2.4, 2.0, 1.9]} /></mesh>
          <mesh position={[0, 2.5, 3.67]} material={m.glass}><boxGeometry args={[2.0, 0.8, 0.06]} /></mesh>
          {[-1, 1].map((sx) => [-2.4, -0.4, 2.4].map((z) => (
            <mesh key={`${sx}${z}`} position={[sx * 1.25, 0.55, z]} rotation={[0, 0, Math.PI / 2]} material={m.char}><cylinderGeometry args={[0.55, 0.55, 0.45, 14]} /></mesh>
          )))}
        </group>
        {[[-2, 4.5], [-0.4, 6.2], [1.6, 4.8]].map(([x, z]) => <mesh key={x} position={[x, 0.95, z]} material={m.truck} castShadow><boxGeometry args={[1.5, 1.3, 1.5]} /></mesh>)}
      </group>
      <group ref={wreck} visible={false}>
        {/* scorched ground, split and charred tanks, the truck on its side */}
        <mesh position={[0, 0.34, 1]} rotation={[-Math.PI / 2, 0, 0]} material={m.scorch}><planeGeometry args={[58, 58]} /></mesh>
        <mesh position={[-7, 2.2, -4]} rotation={[Math.PI / 2, 0, 0.5]} material={m.char} castShadow><cylinderGeometry args={[2.6, 2.3, 8, 14, 1, true, 0.4, 4.6]} /></mesh>
        <mesh position={[0.6, 1.5, -3.2]} rotation={[1.2, 0.5, 0.2]} material={m.char} castShadow><cylinderGeometry args={[2.5, 2.6, 5, 14, 1, true, 0, 3.6]} /></mesh>
        <mesh position={[7.4, 2.6, -4.6]} rotation={[Math.PI / 2, 0, -0.3]} material={m.char} castShadow><cylinderGeometry args={[2.6, 2.6, 9, 14, 1, true, 1, 5]} /></mesh>
        <mesh position={[-10, 2.4, 5.5]} rotation={[0.2, 0, 0.16]} material={m.char} castShadow><cylinderGeometry args={[2.2, 2.9, 4.6, 14, 1, true]} /></mesh>
        <group position={[8.5, 1.1, 7]} rotation={[0.1, 0.9, 1.45]}>
          <mesh material={m.char} castShadow><boxGeometry args={[2.5, 0.5, 7.4]} /></mesh>
          <mesh position={[0, 1.2, -0.9]} rotation={[Math.PI / 2, 0, 0]} material={m.char} castShadow><cylinderGeometry args={[1.25, 1.1, 4.8, 12, 1, true, 0, 5]} /></mesh>
          <mesh position={[0, 0.95, 2.7]} material={m.char}><boxGeometry args={[2.4, 2.0, 1.9]} /></mesh>
        </group>
        {hearths.map(([x, , z], i) => <mesh key={i} position={[x, 0.5, z]} rotation={[0, i, 0]} material={m.ember}><boxGeometry args={[2.6 + (i % 3), 0.5, 1.8 + (i % 2)]} /></mesh>)}
        {m.smoke.map((mat, i) => <sprite key={`s${i}`} ref={(o) => { smokes.current[i] = o }} material={mat} />)}
        {m.fire.map((mat, i) => <sprite key={`f${i}`} ref={(o) => { fires.current[i] = o }} material={mat} />)}
      </group>
    </group>
  )
}

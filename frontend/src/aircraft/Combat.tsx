/**
 * The shoot-down during the X-wing flyby: a picket TIE closing head-on, the intruder's cannon fire,
 * and the explosion with tumbling wreckage. All timing comes from XWingSim (flight.ts); this file
 * only draws it. Simulated scenery — not real telemetry.
 */
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { sim } from '../sim/world'
import { terrainHeight } from '../world/layout'
import { XWING_PATH, XWING_TIMING } from './flight'
import { TieFighter } from './models/TieFighter'
import { darkMetalMat } from './models/materials'

export function PicketActor({ register }: { register: (o: THREE.Object3D | null) => void }) {
  const g = useRef<THREE.Group>(null)
  useFrame(() => {
    const p = sim.xwing.picket
    const o = g.current
    if (!o) return
    o.visible = p.visible
    o.position.copy(p.pos)
    o.quaternion.copy(p.quat)
  })
  return <group ref={(o) => { (g as any).current = o; register(o) }}><TieFighter thrust={1} /></group>
}

// ------------------------------------------------------------------ cannon fire
const BOLTS = 14
const BOLT_SPEED = 950
const MUZZLES: [number, number][] = [[5.7, 0.9], [-5.7, -0.9], [-5.7, 0.9], [5.7, -0.9]] // fired in rotation
const _o = new THREE.Object3D()
const _v = new THREE.Vector3()
const _aim = new THREE.Vector3()

export function LaserBolts() {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const bolts = useMemo(() => Array.from({ length: BOLTS }, () => ({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0 })), [])
  const st = useRef({ next: 0, since: 0, muzzle: 0 })
  // long thin box along +Z; fat enough to read from the base, a kilometre away
  const geo = useMemo(() => new THREE.BoxGeometry(1.1, 1.1, 30), [])
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ff3020', toneMapped: false, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }), [])
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1)
    const m = mesh.current
    if (!m) return
    const x = sim.xwing
    const s = st.current
    if (x.firing && x.pose.visible) {
      s.since += dt
      while (s.since >= 0.085) {
        s.since -= 0.085
        const b = bolts[s.next++ % BOLTS]
        const [mx, my] = MUZZLES[s.muzzle++ % 4]
        b.pos.set(mx, my, 3).applyQuaternion(x.pose.quat).add(x.pose.pos)
        // lead the target a little so the fire converges on it
        _aim.copy(x.picket.pos).sub(b.pos).normalize()
        b.vel.copy(_aim).multiplyScalar(BOLT_SPEED)
        b.life = 0.55
      }
    } else s.since = 0.085
    let n = 0
    for (const b of bolts) {
      if (b.life <= 0) continue
      b.life -= dt
      b.pos.addScaledVector(b.vel, dt)
      _o.position.copy(b.pos)
      _o.lookAt(_v.copy(b.pos).add(b.vel))
      _o.scale.setScalar(1)
      _o.updateMatrix()
      m.setMatrixAt(n++, _o.matrix)
    }
    m.count = n
    m.visible = n > 0
    m.instanceMatrix.needsUpdate = true
  })
  return <instancedMesh ref={mesh} args={[geo, material, BOLTS]} frustumCulled={false} visible={false} />
}

// ------------------------------------------------------------------ explosion + wreckage
const SHARDS = 34
const LIFE = 7

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Soft round puff: opaque core fading to nothing at the rim (flat spheres read as paper discs). */
function puffTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.75)')
  g.addColorStop(0.7, 'rgba(255,255,255,0.22)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

const FIRE = 6
const SMOKE = 4

export function Explosion() {
  const root = useRef<THREE.Group>(null)
  const flash = useRef<THREE.Sprite>(null)
  const fires = useRef<(THREE.Sprite | null)[]>([])
  const smokes = useRef<(THREE.Sprite | null)[]>([])
  const shards = useRef<THREE.InstancedMesh>(null)
  const shardGeo = useMemo(() => new THREE.BoxGeometry(1, 0.18, 1), [])
  const mats = useMemo(() => {
    const map = puffTexture()
    const glow = (color: string) => new THREE.SpriteMaterial({ map, color, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    return {
      flash: glow('#fff1c0'),
      fire: Array.from({ length: FIRE }, (_, i) => glow(i % 2 ? '#ff5a12' : '#ffa030')),
      smoke: Array.from({ length: SMOKE }, () => new THREE.SpriteMaterial({ map, color: '#1c1612', transparent: true, depthWrite: false })),
    }
  }, [])
  // each shard: outward velocity, spin axis and size. The two biggest are the wing panels.
  const parts = useMemo(() => {
    const r = rng(77)
    return Array.from({ length: SHARDS }, (_, i) => {
      const dir = new THREE.Vector3(r() - 0.5, r() - 0.35, r() - 0.5).normalize()
      const big = i < 2
      return {
        vel: dir.multiplyScalar(big ? 22 + r() * 10 : 35 + r() * 95),
        axis: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(),
        spin: (big ? 1.6 : 4) + r() * 6,
        size: big ? [6.5, 1, 8.5] : [0.8 + r() * 2.4, 1, 0.6 + r() * 2.2],
      }
    })
  }, [])
  // fire and smoke puffs: where each one drifts to, and how late it blooms
  const puffs = useMemo(() => {
    const r = rng(1138)
    return Array.from({ length: FIRE + SMOKE }, () => ({ dir: new THREE.Vector3(r() - 0.5, r() - 0.3, r() - 0.5).multiplyScalar(26), delay: r() * 0.22, size: 0.75 + r() * 0.5 }))
  }, [])
  // the wreck keeps some of the momentum the fighter had
  const drift = useMemo(() => new THREE.Vector3(), [])
  const seen = useRef(-1)

  useFrame(() => {
    const g = root.current
    if (!g) return
    const x = sim.xwing
    const age = x.killAt === null ? -1 : sim.time - x.killAt
    if (age < 0 || age > LIFE) { g.visible = false; return }
    if (seen.current !== x.kills) {
      seen.current = x.kills
      const speed = (XWING_PATH.length / XWING_TIMING.duration) * 0.8
      XWING_PATH.tangent(0.45, drift).multiplyScalar(-speed * 0.35)
    }
    g.visible = true
    g.position.copy(x.killPos)
    const ease = (k: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3)
    if (flash.current) {
      flash.current.scale.setScalar(30 + 110 * ease(age / 0.22))
      mats.flash.opacity = Math.max(0, 1 - age / 0.55)
      flash.current.visible = age < 0.55
    }
    fires.current.forEach((sp, i) => {
      if (!sp) return
      const p = puffs[i]
      const a = age - p.delay
      sp.visible = a > 0 && a < 1.9
      if (!sp.visible) return
      const k = ease(a / 1.0)
      sp.position.set(p.dir.x * k + drift.x * a * 0.5, p.dir.y * k + a * 5, p.dir.z * k + drift.z * a * 0.5)
      sp.scale.setScalar((16 + 44 * k) * p.size)
      mats.fire[i].opacity = Math.max(0, 1 - a / 1.9)
    })
    smokes.current.forEach((sp, i) => {
      if (!sp) return
      const p = puffs[FIRE + i]
      const a = age - 0.25 - p.delay
      sp.visible = a > 0
      if (!sp.visible) return
      const k = ease(a / 3.5)
      sp.position.set(p.dir.x * k * 1.4 + drift.x * a * 0.5, p.dir.y * k + a * 8, p.dir.z * k * 1.4 + drift.z * a * 0.5)
      sp.scale.setScalar((26 + 70 * k) * p.size)
      mats.smoke[i].opacity = 0.7 * Math.min(1, a / 0.6) * Math.max(0, 1 - age / LIFE)
    })
    const m = shards.current
    if (m) {
      const fade = Math.max(0, Math.min(1, (LIFE - age) / 1.5))
      parts.forEach((p, i) => {
        _o.position.set(
          (p.vel.x + drift.x) * age,
          (p.vel.y + drift.y) * age - 0.5 * 26 * age * age,
          (p.vel.z + drift.z) * age,
        )
        // wreckage that reaches the ground stays there
        const floor = terrainHeight(x.killPos.x + _o.position.x, x.killPos.z + _o.position.z) - x.killPos.y + 0.3
        const landed = _o.position.y < floor
        if (landed) _o.position.y = floor
        _o.quaternion.setFromAxisAngle(p.axis, landed ? 1 : age * p.spin)
        _o.scale.set(p.size[0] * fade, p.size[1] * fade, p.size[2] * fade)
        _o.updateMatrix()
        m.setMatrixAt(i, _o.matrix)
      })
      m.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <group ref={root} visible={false}>
      {mats.smoke.map((m, i) => <sprite key={`s${i}`} ref={(o) => { smokes.current[i] = o }} material={m} />)}
      {mats.fire.map((m, i) => <sprite key={`f${i}`} ref={(o) => { fires.current[i] = o }} material={m} />)}
      <sprite ref={flash} material={mats.flash} />
      <instancedMesh ref={shards} args={[shardGeo, darkMetalMat(), SHARDS]} frustumCulled={false} />
    </group>
  )
}

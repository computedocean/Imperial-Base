// Dust kicked up from the desert floor: a puff under each walker foot as it plants, and a spreading ring of
// sand under any ship that is low over the ground with its engines running. One pooled Points object; the
// particles move on the GPU, so the CPU only writes a few attributes when something is emitted.
// Simulated scenery — not real telemetry.
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { sim } from '../sim/world'
import { useStore } from '../state/store'
import { LEGS, footAt } from '../vehicles/walkerGait'
import { PADS, terrainHeight } from './layout'
import { TOD } from './lighting'

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aVel; attribute float aBirth; attribute float aLife; attribute float aSize;
uniform float uTime; uniform float uScale;
varying float vAlpha;
void main() {
  float age = uTime - aBirth;
  float k = clamp(age / max(aLife, 0.001), 0.0, 1.0);
  // fast at first, then the air drags it to a stop; a slow rise and a drift down-wind
  vec3 p = position + aVel * (1.0 - exp(-age * 1.3)) / 1.3 + vec3(1.6, 0.5, 0.5) * age;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float alive = step(0.0, age) * step(age, aLife);
  gl_PointSize = min(512.0, aSize * (0.4 + 1.5 * k) * uScale / max(1.0, -mv.z)) * alive;
  vAlpha = pow(1.0 - k, 1.4) * smoothstep(0.0, 0.07, k) * alive;
  #include <logdepthbuf_vertex>
}`

const FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
varying float vAlpha;
void main() {
  #include <logdepthbuf_fragment>
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.15, d) * vAlpha * 0.3;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`

const SHIPS = ['shuttle', 'gunship', 'freighter'] as const
const _foot = { pos: new THREE.Vector3(), planted: true, lift: 0 }
const _sand = new THREE.Color('#d8b88c')

/** Height of the surface a ship would blow dust off at (x, z): a landing pad if it is over one, else the ground. */
function surfaceAt(x: number, z: number) {
  for (const p of PADS) if (Math.hypot(x - p.x, z - p.z) < p.radius) return p.y
  return terrainHeight(x, z)
}

export function GroundFx({ capacity = 700 }: { capacity?: number }) {
  const tod = useStore((s) => s.timeOfDay)
  const size = useThree((s) => s.size)
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const built = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const attr = (n: number) => { const a = new THREE.BufferAttribute(new Float32Array(capacity * n), n); a.setUsage(THREE.DynamicDrawUsage); return a }
    const pos = attr(3), vel = attr(3), birth = attr(1), life = attr(1), sz = attr(1)
    birth.array.fill(-1e6)
    g.setAttribute('position', pos); g.setAttribute('aVel', vel); g.setAttribute('aBirth', birth); g.setAttribute('aLife', life); g.setAttribute('aSize', sz)
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uScale: { value: 600 }, uColor: { value: new THREE.Color() } },
    })
    return { g, m, pos, vel, birth, life, sz }
  }, [capacity])
  useEffect(() => () => { built.g.dispose(); built.m.dispose() }, [built])
  useEffect(() => { built.m.uniforms.uColor.value.set(TOD[tod].fog).lerp(_sand, 0.45) }, [built, tod])

  const s = useRef({ next: 0, time: 0, planted: LEGS.map(() => true), debt: SHIPS.map(() => 0), dirty: false })

  const emit = (x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, sz: number) => {
    const st = s.current
    const i = st.next
    st.next = (i + 1) % capacity
    built.pos.setXYZ(i, x, y, z)
    built.vel.setXYZ(i, vx, vy, vz)
    built.birth.setX(i, st.time)
    built.life.setX(i, life)
    built.sz.setX(i, sz)
    st.dirty = true
  }

  useFrame((_, rawDt) => {
    const st = s.current
    const dt = Math.min(rawDt, 0.1)
    st.time += dt
    built.m.uniforms.uTime.value = st.time
    built.m.uniforms.uScale.value = size.height / (2 * Math.tan((camera.fov * Math.PI) / 360))

    // walker: a ring of dust thrown outwards as each foot comes down
    LEGS.forEach((leg, i) => {
      const f = footAt(leg, sim.time, _foot)
      if (f.planted && !st.planted[i]) {
        for (let k = 0; k < 20; k++) {
          const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 7
          emit(f.pos.x + Math.cos(a) * 2.4, f.pos.y + 0.4, f.pos.z + Math.sin(a) * 2.4, Math.cos(a) * sp, 1.2 + Math.random() * 3.5, Math.sin(a) * sp, 2.6 + Math.random() * 2, 9 + Math.random() * 9)
        }
      }
      st.planted[i] = f.planted
    })
    // ships: engine wash scours the surface while they are low and under power
    SHIPS.forEach((key, i) => {
      const state = (sim as any)[key]?.state as { pos: THREE.Vector3; visible: boolean; thrust: number } | undefined
      if (!state || !state.visible || state.thrust < 0.15) return
      const ground = surfaceAt(state.pos.x, state.pos.z)
      const alt = state.pos.y - ground
      if (alt > 38 || alt < 0) return
      st.debt[i] += dt * 70 * state.thrust * (1 - alt / 38)
      while (st.debt[i] >= 1) {
        st.debt[i] -= 1
        const a = Math.random() * Math.PI * 2, r = 5 + Math.random() * 9, sp = 9 + Math.random() * 12
        emit(state.pos.x + Math.cos(a) * r, ground + 0.3, state.pos.z + Math.sin(a) * r, Math.cos(a) * sp, 0.6 + Math.random() * 2.2, Math.sin(a) * sp, 2.2 + Math.random() * 1.8, 10 + Math.random() * 12)
      }
    })
    if (st.dirty) {
      st.dirty = false
      for (const a of [built.pos, built.vel, built.birth, built.life, built.sz]) a.needsUpdate = true
    }
  })

  return <points geometry={built.g} material={built.m} frustumCulled={false} renderOrder={3} />
}

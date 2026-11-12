/**
 * Engine exhaust plume: a soft additive cone trailing behind each nozzle (towards -Z), white-hot at the
 * throat and fading to the engine colour, with a slight flicker. Its length and brightness follow thrust.
 * All the nozzles of one ship share a single geometry and draw call.
 */
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`

const FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor; uniform float uThrust; uniform float uTime; uniform float uSeed;
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main() {
  #include <logdepthbuf_fragment>
  float along = vUv.y;                                   // 0 at the nozzle .. 1 at the tail
  float core = pow(abs(dot(normalize(vN), normalize(vV))), 2.0); // brightest looking through the middle of the cone
  float flick = 0.86 + 0.14 * sin(uTime * 41.0 + along * 23.0 + uSeed) * sin(uTime * 27.0 - along * 11.0 + uSeed * 1.7);
  float reach = mix(0.3, 1.0, uThrust);
  float fade = pow(max(0.0, 1.0 - along / reach), 1.8);
  float a = (0.25 + 0.75 * core) * fade * flick * smoothstep(0.0, 0.15, uThrust);
  vec3 col = mix(uColor, vec3(1.0, 0.97, 0.92), core * fade * 0.75);
  gl_FragColor = vec4(col * a * 2.4, a);
}`

export type PlumeProps = {
  /** nozzle exit centres in the ship's frame */
  at: readonly (readonly [number, number, number])[]
  /** radius at the nozzle, metres */
  radius: number
  /** length at full thrust, metres */
  length: number
  color: string
  /** 0..1 */
  thrust: number
}

export function EnginePlume({ at, radius, length, color, thrust }: PlumeProps) {
  const geo = useMemo(() => {
    const cones = at.map(([x, y, z]) => {
      // CylinderGeometry runs along Y with v = 0 at the bottom: bottom = nozzle, top = tail; lay it along -Z
      const g = new THREE.CylinderGeometry(radius * 0.22, radius, length, 14, 5, true)
      g.rotateX(-Math.PI / 2)
      g.translate(x, y, z - length / 2)
      return g
    })
    const merged = mergeGeometries(cones, false)!
    for (const c of cones) c.dispose()
    return merged
  }, [at, radius, length])
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { uColor: { value: new THREE.Color(color) }, uThrust: { value: 0 }, uTime: { value: 0 }, uSeed: { value: Math.random() * 20 } },
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false,
  }), [color])
  useEffect(() => () => { geo.dispose() }, [geo])
  useEffect(() => () => { mat.dispose() }, [mat])
  const k = Math.min(1, Math.max(0, thrust))
  mat.uniforms.uThrust.value = k
  useFrame(({ clock }) => { mat.uniforms.uTime.value = clock.elapsedTime })
  return <mesh geometry={geo} material={mat} visible={k > 0.03} frustumCulled={false} renderOrder={5} />
}

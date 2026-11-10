import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useStore } from '../state/store'
import { SUN2_DIR, TOD, type TodPreset } from './lighting'

/** Golden-hour sun direction (kept for modules that need a fixed reference). */
export const SUN_DIR = TOD.golden.sunDir.clone()
export const FOG_COLOR = TOD.golden.fog
export { SUN2_DIR }

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // keep at far plane
}`

const frag = /* glsl */ `
uniform vec3 sunDir; uniform vec3 sun2Dir;
uniform vec3 uZenith; uniform vec3 uMid; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uGlow;
uniform float uGlowStrength; uniform float uDisc; uniform float uStars; uniform float uCloud; uniform float uEnv;
varying vec3 vDir;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.2, h));
  col = mix(col, uZenith, smoothstep(0.16, 0.8, h));
  // below the horizon: dusty ground haze
  col = mix(col, uGround, smoothstep(0.0, -0.06, h));
  float s = max(dot(d, sunDir), 0.0);
  // broad forward-scatter glow hugging the horizon around the sun
  float horizonBand = exp(-abs(h) * 7.0);
  col += uGlow * pow(s, 6.0) * uGlowStrength * (0.45 + horizonBand);
  col += uGlow * pow(s, 48.0) * uGlowStrength * 0.9;
  // sun / moon disc (dimmer in the environment-map render to avoid specular fireflies)
  col += vec3(1.0, 0.95, 0.88) * smoothstep(0.9993, 0.99965, s) * uDisc * (1.0 - uEnv * 0.85);
  // companion sun fades out at night
  float s2 = max(dot(d, sun2Dir), 0.0);
  float day = 1.0 - uStars;
  col += vec3(1.0, 0.6, 0.4) * pow(s2, 40.0) * 0.3 * day;
  col += vec3(1.0, 0.8, 0.65) * smoothstep(0.99975, 0.99988, s2) * 3.0 * day * (1.0 - uEnv * 0.85);
  // high cirrus: fbm on a virtual cloud plane, lit warm on the sun side
  if (h > 0.0) {
    vec2 cp = d.xz / (h + 0.08) * 1.4;
    float c = fbm(cp * vec2(1.0, 3.0) + vec2(3.1, 7.7));
    c = smoothstep(0.52, 0.85, c) * smoothstep(0.02, 0.18, h) * (1.0 - smoothstep(0.55, 0.95, h));
    vec3 cloudCol = mix(col * 1.12 + 0.03, uGlow, pow(s, 3.0) * 0.6);
    col = mix(col, cloudCol, c * uCloud * 4.0);
  }
  // stars
  if (uStars > 0.0 && h > 0.0) {
    vec2 g = floor(d.xz / (h + 0.25) * 420.0);
    float st = step(0.9965, hash(g)) * smoothstep(0.05, 0.4, h);
    float tw = 0.6 + 0.4 * hash(g + 3.7);
    col += vec3(0.85, 0.9, 1.0) * st * tw * uStars * 1.3;
    // faint galactic band
    float band = exp(-pow(dot(d, normalize(vec3(0.3, 0.5, -0.8))) * 3.2, 2.0));
    col += vec3(0.05, 0.06, 0.09) * band * fbm(d.xz * 9.0) * uStars;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`

const c3 = (hex: string) => new THREE.Color(hex)

/** Creates the sky dome material; `env` = true for the dimmer-disc copy used to bake the environment map. */
export function createSkyMaterial(env = false) {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      sunDir: { value: TOD.golden.sunDir.clone() }, sun2Dir: { value: SUN2_DIR },
      uZenith: { value: c3('#000') }, uMid: { value: c3('#000') }, uHorizon: { value: c3('#000') }, uGround: { value: c3('#000') },
      uGlow: { value: c3('#000') }, uGlowStrength: { value: 0 }, uDisc: { value: 0 }, uStars: { value: 0 }, uCloud: { value: 0 },
      uEnv: { value: env ? 1 : 0 },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  })
}

export function applySkyPreset(mat: THREE.ShaderMaterial, p: TodPreset) {
  const u = mat.uniforms
  u.sunDir.value.copy(p.sunDir)
  u.uZenith.value.set(p.sky.zenith)
  u.uMid.value.set(p.sky.mid)
  u.uHorizon.value.set(p.sky.horizon)
  u.uGround.value.set(p.sky.ground)
  u.uGlow.value.set(p.sky.glow)
  u.uGlowStrength.value = p.sky.glowStrength
  u.uDisc.value = p.sky.disc
  u.uStars.value = p.sky.stars
  u.uCloud.value = p.sky.cloud
}

/** Background sky dome + a ringed gas giant hanging over the eastern mountains. */
export function Sky() {
  const tod = useStore((s) => s.timeOfDay)
  const mat = useMemo(() => createSkyMaterial(), [])
  useEffect(() => applySkyPreset(mat, TOD[tod]), [mat, tod])
  const planet = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 256
    const g = c.getContext('2d')!
    for (let y = 0; y < 256; y++) {
      const t = y / 256
      const b = Math.sin(t * 38) * 0.5 + Math.sin(t * 91 + 1) * 0.25
      const r = 150 + b * 40
      g.fillStyle = `rgb(${r},${r * 0.82},${r * 0.66})`
      g.fillRect(0, y, 512, 1)
    }
    g.fillStyle = 'rgba(120,70,50,0.5)'
    g.beginPath(); g.ellipse(330, 150, 30, 12, 0, 0, Math.PI * 2); g.fill()
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [])
  const night = tod === 'night'
  return (
    <group>
      <mesh material={mat} renderOrder={-10} frustumCulled={false}>
        <sphereGeometry args={[30000, 48, 24]} />
      </mesh>
      {/* gas giant — far away, fog-free, lit from the suns' side */}
      <group position={[16000, 7200, 9000]} rotation={[0.3, 0.6, 0.38]}>
        <mesh>
          <sphereGeometry args={[3600, 48, 24]} />
          <meshStandardMaterial map={planet} fog={false} roughness={1} metalness={0} emissive="#3a2a22" emissiveIntensity={night ? 0.6 : 0.25} />
        </mesh>
        <mesh rotation={[Math.PI / 2 - 0.25, 0, 0]}>
          <ringGeometry args={[4500, 7200, 96]} />
          <meshBasicMaterial color={night ? '#6a6070' : '#d8c0a0'} transparent opacity={night ? 0.22 : 0.35} side={THREE.DoubleSide} fog={false} depthWrite={false} />
        </mesh>
      </group>
    </group>
  )
}

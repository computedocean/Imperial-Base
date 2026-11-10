// Deterministic 2D gradient noise + fBm helpers (no dependencies).
// Used by terrain generation, flight-clearance tests and procedural textures.

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function rng(seed: number) {
  return mulberry32(seed)
}

const PERM = new Uint8Array(512)
const GRAD: [number, number][] = []
{
  const r = mulberry32(0x1e5e7)
  const p = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]
  for (let i = 0; i < 256; i++) {
    const a = r() * Math.PI * 2
    GRAD.push([Math.cos(a), Math.sin(a)])
  }
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)

/** Gradient noise in roughly [-0.7, 0.7]. */
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const X = xi & 255
  const Y = yi & 255
  const g = (ix: number, iy: number, dx: number, dy: number) => {
    const gr = GRAD[PERM[ix + PERM[iy]]]
    return gr[0] * dx + gr[1] * dy
  }
  const n00 = g(X, Y, xf, yf)
  const n10 = g(X + 1, Y, xf - 1, yf)
  const n01 = g(X, Y + 1, xf, yf - 1)
  const n11 = g(X + 1, Y + 1, xf - 1, yf - 1)
  const u = fade(xf)
  const v = fade(yf)
  return (n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v
}

export function fbm(x: number, y: number, octaves = 5, lacunarity = 2, gain = 0.5): number {
  let sum = 0
  let amp = 0.5
  let f = 1
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * f, y * f)
    f *= lacunarity
    amp *= gain
  }
  return sum
}

/** Ridged multifractal — sharp mountain crests. Returns ~[0,1]. */
export function ridged(x: number, y: number, octaves = 5): number {
  let sum = 0
  let amp = 0.5
  let f = 1
  let prev = 1
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(noise2(x * f, y * f) * 1.4)
    n = n * n
    sum += n * amp * prev
    prev = n
    f *= 2.03
    amp *= 0.5
  }
  return sum
}

export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

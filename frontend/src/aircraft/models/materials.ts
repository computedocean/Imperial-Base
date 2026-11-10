/**
 * Shared aircraft materials, procedural textures and geometry helpers.
 *
 * Everything here is a lazily-created module-level singleton so that many
 * ships share GPU programs, textures and (via the per-model caches) buffers.
 * Nothing in this file is ever disposed: it lives for the app lifetime.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// ---------------------------------------------------------------------------
// Deterministic RNG (so textures look identical every reload)
// ---------------------------------------------------------------------------
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  return [c, ctx]
}

function finishTexture(c: HTMLCanvasElement, srgb: boolean) {
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 4
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

/** Panel-line plating: light base, varied plates, dark seams, a few vents. */
function drawPanels(ctx: CanvasRenderingContext2D, size: number, seed: number, base: number, varAmt: number, seam: string, grime: boolean) {
  const r = rng(seed)
  ctx.fillStyle = `rgb(${base},${base},${base})`
  ctx.fillRect(0, 0, size, size)
  // recursive subdivision into plates
  const plates: [number, number, number, number][] = []
  const split = (x: number, y: number, w: number, h: number, d: number) => {
    if (d > 4 || (d > 1 && r() < 0.25) || w < size / 14 || h < size / 14) {
      plates.push([x, y, w, h])
      return
    }
    if (w > h ? r() < 0.8 : r() < 0.2) {
      const k = Math.round(w * (0.3 + r() * 0.4))
      split(x, y, k, h, d + 1)
      split(x + k, y, w - k, h, d + 1)
    } else {
      const k = Math.round(h * (0.3 + r() * 0.4))
      split(x, y, w, k, d + 1)
      split(x, y + k, w, h - k, d + 1)
    }
  }
  split(0, 0, size, size, 0)
  for (const [x, y, w, h] of plates) {
    const v = Math.round(base + (r() - 0.5) * varAmt)
    ctx.fillStyle = `rgb(${v},${v},${v})`
    ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = seam
    ctx.lineWidth = 2
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
    // occasional vent / access hatch
    if (r() < 0.18 && w > 40 && h > 30) {
      const vw = w * 0.4, vh = h * 0.3
      const vx = x + (w - vw) * r(), vy = y + (h - vh) * r()
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      for (let i = 0; i < 5; i++) ctx.fillRect(vx, vy + (vh / 5) * i, vw, vh / 10)
    }
    // rivets along edges
    if (r() < 0.3) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'
      for (let i = 6; i < w - 4; i += 10) ctx.fillRect(x + i, y + 4, 2, 2)
    }
  }
  if (grime) {
    for (let i = 0; i < 260; i++) {
      const x = r() * size, y = r() * size, rad = 4 + r() * 30
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad)
      g.addColorStop(0, `rgba(60,50,40,${0.05 + r() * 0.08})`)
      g.addColorStop(1, 'rgba(60,50,40,0)')
      ctx.fillStyle = g
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2)
    }
  }
}

let _panelTex: THREE.CanvasTexture | null = null
/** Neutral grey panel-line texture (used as colour map + bump). */
export function panelTexture() {
  if (_panelTex) return _panelTex
  const [c, ctx] = makeCanvas(512)
  drawPanels(ctx, 512, 7, 200, 26, 'rgba(40,40,44,0.9)', false)
  _panelTex = finishTexture(c, true)
  return _panelTex
}

let _xwTex: THREE.CanvasTexture | null = null
/** Weathered off-white plating for the rebel starfighter. */
export function weatheredTexture() {
  if (_xwTex) return _xwTex
  const [c, ctx] = makeCanvas(512)
  drawPanels(ctx, 512, 21, 225, 22, 'rgba(70,64,58,0.75)', true)
  _xwTex = finishTexture(c, true)
  return _xwTex
}

let _hexTex: THREE.CanvasTexture | null = null
/** Dark hexagonal solar-cell grid for TIE wing panels. */
export function hexTexture() {
  if (_hexTex) return _hexTex
  const S = 512
  const [c, ctx] = makeCanvas(S)
  const r = rng(99)
  ctx.fillStyle = '#0c0d10'
  ctx.fillRect(0, 0, S, S)
  // tileable hex grid: 8 columns across, rows spaced sqrt(3)/2
  const cols = 4
  const w = S / cols // horizontal spacing
  const rad = w / Math.sqrt(3)
  const rowH = rad * 1.5
  const rows = Math.round(S / rowH)
  const rowH2 = S / rows
  for (let j = -1; j <= rows; j++) {
    for (let i = -1; i <= cols; i++) {
      const cx = i * w + (j % 2 ? w / 2 : 0)
      const cy = j * rowH2
      const v = 34 + Math.round(r() * 22)
      ctx.beginPath()
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k * Math.PI) / 3
        const px = cx + Math.cos(a) * (rad - 5)
        const py = cy + Math.sin(a) * (rad - 5)
        if (k === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
      ctx.fillStyle = `rgb(${v},${v + 2},${v + 6})`
      ctx.fill()
      ctx.strokeStyle = 'rgba(95,102,112,0.95)'
      ctx.lineWidth = 4
      ctx.stroke()
    }
  }
  _hexTex = finishTexture(c, true)
  return _hexTex
}

// ---------------------------------------------------------------------------
// Materials (lazy singletons)
// ---------------------------------------------------------------------------
function lazy<T>(make: () => T): () => T {
  let v: T | undefined
  return () => (v ??= make())
}

export const hullGreyMat = lazy(() => {
  const t = panelTexture()
  return new THREE.MeshStandardMaterial({
    name: 'hullGrey', color: '#a4a9b0', map: t, bumpMap: t, bumpScale: 1.2,
    metalness: 0.5, roughness: 0.55,
  })
})

export const gunmetalMat = lazy(() => {
  const t = panelTexture()
  return new THREE.MeshStandardMaterial({
    name: 'gunmetal', color: '#6b717b', map: t, bumpMap: t, bumpScale: 0.8,
    metalness: 0.55, roughness: 0.5,
  })
})

/** Near-black detail parts (vents, gear bays, interior recesses). */
export const darkMetalMat = lazy(() =>
  new THREE.MeshStandardMaterial({ name: 'darkMetal', color: '#2a2e33', metalness: 0.5, roughness: 0.6 }),
)

export const solarPanelMat = lazy(() => {
  const t = hexTexture()
  return new THREE.MeshStandardMaterial({
    name: 'solarPanel', color: '#ffffff', map: t, bumpMap: t, bumpScale: 1.5, metalness: 0.4, roughness: 0.42,
  })
})

export const cockpitGlassMat = lazy(() =>
  new THREE.MeshStandardMaterial({
    name: 'cockpitGlass', color: '#0b1218', emissive: '#0a1a24', emissiveIntensity: 0.4,
    metalness: 0.9, roughness: 0.12,
  }),
)

/** Base engine glow; components clone it per instance to vary thrust. */
function glow(name: string, color: string) {
  return new THREE.MeshStandardMaterial({
    name, color: '#000000', emissive: color, emissiveIntensity: 3, toneMapped: false,
  })
}
export const engineGlowBlueMat = lazy(() => glow('engineGlowBlue', '#4f86ff'))
export const engineGlowRedMat = lazy(() => glow('engineGlowRed', '#ff3c26'))
export const engineGlowOrangeMat = lazy(() => glow('engineGlowOrange', '#ff6a45'))

export const navRedMat = lazy(() =>
  new THREE.MeshStandardMaterial({ name: 'navRed', color: '#000000', emissive: '#ff2a1a', emissiveIntensity: 4, toneMapped: false }),
)
export const navWhiteMat = lazy(() =>
  new THREE.MeshStandardMaterial({ name: 'navWhite', color: '#000000', emissive: '#ffffff', emissiveIntensity: 4, toneMapped: false }),
)

export const xwingWhiteMat = lazy(() => {
  const t = weatheredTexture()
  return new THREE.MeshStandardMaterial({
    name: 'xwingWhite', color: '#e4dfd4', map: t, bumpMap: t, bumpScale: 1,
    metalness: 0.4, roughness: 0.65,
  })
})

/** Faded red/orange squadron stripe. */
export const xwingStripeMat = lazy(() =>
  new THREE.MeshStandardMaterial({ name: 'xwingStripe', color: '#b4553a', metalness: 0.4, roughness: 0.7 }),
)

/** Material lookup by builder key. */
export type MatKey =
  | 'hull' | 'gun' | 'dark' | 'solar' | 'glass' | 'xwhite' | 'stripe' | 'navRed' | 'navWhite'

export function mat(key: MatKey): THREE.Material {
  switch (key) {
    case 'hull': return hullGreyMat()
    case 'gun': return gunmetalMat()
    case 'dark': return darkMetalMat()
    case 'solar': return solarPanelMat()
    case 'glass': return cockpitGlassMat()
    case 'xwhite': return xwingWhiteMat()
    case 'stripe': return xwingStripeMat()
    case 'navRed': return navRedMat()
    case 'navWhite': return navWhiteMat()
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
export type V3 = [number, number, number]
export type V2 = [number, number]

/** Prism/loft along +Z through convex sections (same point count each). Flat-shaded. */
export function loft(sections: { z: number; pts: V2[] }[], capStart = true, capEnd = true): THREE.BufferGeometry {
  const pos: number[] = []
  const tri = (a: V3, b: V3, c: V3, out: V3) => {
    // orient so the normal points away from `out` reference (centre)
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const mx = (a[0] + b[0] + c[0]) / 3 - out[0]
    const my = (a[1] + b[1] + c[1]) / 3 - out[1]
    const mz = (a[2] + b[2] + c[2]) / 3 - out[2]
    if (nx * mx + ny * my + nz * mz < 0) pos.push(...a, ...c, ...b)
    else pos.push(...a, ...b, ...c)
  }
  const cen = (s: { z: number; pts: V2[] }): V3 => {
    let x = 0, y = 0
    for (const p of s.pts) { x += p[0]; y += p[1] }
    return [x / s.pts.length, y / s.pts.length, s.z]
  }
  for (let i = 0; i < sections.length - 1; i++) {
    const A = sections[i], B = sections[i + 1]
    const ca = cen(A), cb = cen(B)
    const mid: V3 = [(ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2, (ca[2] + cb[2]) / 2]
    const n = A.pts.length
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n
      const a: V3 = [A.pts[k][0], A.pts[k][1], A.z]
      const b: V3 = [A.pts[k2][0], A.pts[k2][1], A.z]
      const c: V3 = [B.pts[k2][0], B.pts[k2][1], B.z]
      const d: V3 = [B.pts[k][0], B.pts[k][1], B.z]
      // reference point: section centroid at the quad's z (keeps tapering quads correct)
      tri(a, b, c, mid)
      tri(a, c, d, mid)
    }
  }
  const cap = (s: { z: number; pts: V2[] }, dir: number) => {
    const c = cen(s)
    const out: V3 = [c[0], c[1], c[2] - dir]
    for (let k = 0; k < s.pts.length; k++) {
      const k2 = (k + 1) % s.pts.length
      tri(c, [s.pts[k][0], s.pts[k][1], s.z], [s.pts[k2][0], s.pts[k2][1], s.z], out)
    }
  }
  if (capStart) cap(sections[0], -1)
  if (capEnd) cap(sections[sections.length - 1], 1)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return g
}

/** Chamfered rectangular section helper (CCW), width w, bottom yb, top yt, chamfer c. */
export function chamferRect(w: number, yb: number, yt: number, c: number, x0 = 0): V2[] {
  const h = w / 2
  return [
    [x0 + h - c, yb], [x0 + h, yb + c], [x0 + h, yt - c], [x0 + h - c, yt],
    [x0 - h + c, yt], [x0 - h, yt - c], [x0 - h, yb + c], [x0 - h + c, yb],
  ]
}

function extrude(pts: V2[], depth: number, bevel: number) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))
  const b = Math.min(bevel, depth * 0.45)
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, depth - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b,
    bevelOffset: -b, bevelSegments: 1, curveSegments: 4,
  })
  g.translate(0, 0, -(depth - 2 * b) / 2)
  return g
}

/** Flat plate whose outline is given in (z, y); thickness along X, centred on x = 0. */
export function plateZY(pts: V2[], thickness: number, bevel = 0.05) {
  const g = extrude(pts, thickness, bevel)
  g.rotateY(-Math.PI / 2) // shape x -> world z, depth -> world -x
  return g
}

/** Flat plate whose outline is given in (x, z); thickness along Y, centred on y = 0. */
export function plateXZ(pts: V2[], thickness: number, bevel = 0.04) {
  // rotateX(+90deg) maps shape (x, y) -> world (x, z = y); depth -> world -y (centred)
  const g = extrude(pts, thickness, bevel)
  g.rotateX(Math.PI / 2)
  return g
}

/** Chamfered box w x h x d centred at origin. */
export function bevelBox(w: number, h: number, d: number, bevel = 0.04) {
  const b = Math.min(bevel, w * 0.45, h * 0.45)
  return extrude([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], d, b)
}

/** Cylinder whose axis is along Z (default three cylinders are along Y). */
export function cylZ(rTop: number, rBot: number, len: number, seg = 12, open = false) {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, seg, 1, open)
  g.rotateX(Math.PI / 2) // +Y (top) -> +Z
  return g
}
export function cylX(rTop: number, rBot: number, len: number, seg = 12) {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, seg)
  g.rotateZ(-Math.PI / 2) // +Y (top) -> +X
  return g
}

export interface Xform { p?: V3; r?: V3; s?: V3 | number }
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _v = new THREE.Vector3()
const _s = new THREE.Vector3()

/**
 * Collects many small part geometries keyed by material and merges them into
 * one geometry per material (=> one draw call per material per moving part).
 * UVs are regenerated by box projection in model space so texel density is
 * uniform across every part (uvScale = metres per texture tile).
 */
export class GeoBatch {
  private parts = new Map<MatKey, THREE.BufferGeometry[]>()
  constructor(private uvScale = 4) {}

  add(key: MatKey, geo: THREE.BufferGeometry, x: Xform = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone()
    if (geo.index) geo.dispose()
    _e.set(...(x.r ?? [0, 0, 0]))
    _q.setFromEuler(_e)
    _v.set(...(x.p ?? [0, 0, 0]))
    if (typeof x.s === 'number') _s.setScalar(x.s)
    else _s.set(...(x.s ?? [1, 1, 1]))
    _m.compose(_v, _q, _s)
    g.applyMatrix4(_m)
    if (_m.determinant() < 0) flipWinding(g)
    // strip everything but position/normal (uv regenerated below)
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name)
    g.clearGroups()
    let list = this.parts.get(key)
    if (!list) this.parts.set(key, (list = []))
    list.push(g)
    return this
  }

  build(): Partial<Record<MatKey, THREE.BufferGeometry>> {
    const out: Partial<Record<MatKey, THREE.BufferGeometry>> = {}
    for (const [key, list] of this.parts) {
      const merged = mergeGeometries(list, false)
      for (const g of list) g.dispose()
      if (!merged) continue
      boxUV(merged, this.uvScale)
      merged.computeBoundingSphere()
      merged.computeBoundingBox()
      out[key] = merged
    }
    this.parts.clear()
    return out
  }
}

/** Mirrored (negative-determinant) transforms invert triangle winding; swap back. */
function flipWinding(g: THREE.BufferGeometry) {
  for (const name of ['position', 'normal']) {
    const a = g.attributes[name] as THREE.BufferAttribute | undefined
    if (!a) continue
    const arr = a.array as Float32Array
    for (let i = 0; i < a.count; i += 3) {
      for (let c = 0; c < 3; c++) {
        const i1 = (i + 1) * 3 + c, i2 = (i + 2) * 3 + c
        const t = arr[i1]; arr[i1] = arr[i2]; arr[i2] = t
      }
    }
    a.needsUpdate = true
  }
}

function boxUV(g: THREE.BufferGeometry, scale: number) {
  const p = g.attributes.position as THREE.BufferAttribute
  const n = p.count
  const uv = new Float32Array(n * 2)
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  const nrm = new THREE.Vector3()
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2)
    nrm.subVectors(c, b).cross(_v.subVectors(a, b))
    const ax = Math.abs(nrm.x), ay = Math.abs(nrm.y), az = Math.abs(nrm.z)
    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? a : k === 1 ? b : c
      let u: number, w: number
      if (ax >= ay && ax >= az) { u = v.z; w = v.y }
      else if (ay >= az) { u = v.x; w = v.z }
      else { u = v.x; w = v.y }
      uv[(i + k) * 2] = u / scale
      uv[(i + k) * 2 + 1] = w / scale
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

/** Count triangles across a set of geometries (for stats/reporting). */
export function triCount(geos: (THREE.BufferGeometry | undefined)[]) {
  let t = 0
  for (const g of geos) if (g) t += (g.index ? g.index.count : g.attributes.position.count) / 3
  return t
}

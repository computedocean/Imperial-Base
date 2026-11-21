// Procedural textures (CanvasTexture) — all original, generated at runtime, cached.
import * as THREE from 'three'
import { FACILITIES, HANGAR_DOOR, PADS, PERIMETER_RADIUS } from './layout'
import { fbm, rng } from './noise'

const cache = new Map<string, THREE.Texture>()
/** source canvases of colour textures, so matching normal maps can be derived from the same pixels */
const sources = new Map<string, HTMLCanvasElement>()
let anisotropy = 4

/** Applies the quality preset's anisotropic filtering to every cached texture (call before first render). */
export function setTextureAnisotropy(n: number) {
  anisotropy = n
  for (const t of cache.values()) if (t.anisotropy !== n) { t.anisotropy = n; t.needsUpdate = true }
}

function canvas(size: number) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  return [c, c.getContext('2d')!] as const
}

function finish(c: HTMLCanvasElement, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c)
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = anisotropy
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.generateMipmaps = true
  t.needsUpdate = true
  return t
}

/** Gunmetal hull plating: plates of varying tone, seams, rivets, occasional vents. 1 tile ≈ 8 m. */
export function panelTexture(kind: 'hull' | 'dark' | 'light' = 'hull'): THREE.Texture {
  const key = `panel-${kind}`
  if (cache.has(key)) return cache.get(key)!
  const S = 512
  const [c, g] = canvas(S)
  const r = rng(kind === 'hull' ? 11 : kind === 'dark' ? 23 : 37)
  const base = kind === 'hull' ? [118, 124, 130] : kind === 'dark' ? [58, 62, 68] : [168, 172, 176]
  g.fillStyle = `rgb(${base.join(',')})`
  g.fillRect(0, 0, S, S)
  // plates
  const rows = 8
  for (let y = 0; y < rows; y++) {
    let x = 0
    const h = S / rows
    while (x < S) {
      const w = (Math.floor(r() * 3) + 1) * (S / 16)
      const d = (r() - 0.5) * 22
      g.fillStyle = `rgb(${base.map((v) => Math.max(0, Math.min(255, v + d))).join(',')})`
      g.fillRect(x, y * h, w, h)
      // seams
      g.fillStyle = 'rgba(0,0,0,0.45)'
      g.fillRect(x, y * h, w, 2)
      g.fillRect(x, y * h, 2, h)
      g.fillStyle = 'rgba(255,255,255,0.08)'
      g.fillRect(x + 2, y * h + 2, w - 2, 1)
      // rivets
      if (r() > 0.6) {
        g.fillStyle = 'rgba(0,0,0,0.35)'
        for (let i = 6; i < w - 4; i += 10) {
          g.fillRect(x + i, y * h + 5, 2, 2)
          g.fillRect(x + i, y * h + h - 7, 2, 2)
        }
      }
      // vents
      if (r() > 0.93) {
        g.fillStyle = 'rgba(0,0,0,0.5)'
        for (let i = 0; i < 6; i++) g.fillRect(x + 8, y * h + 10 + i * 6, w - 16, 3)
      }
      x += w
    }
  }
  // grime streaks
  for (let i = 0; i < 140; i++) {
    g.fillStyle = `rgba(40,30,20,${r() * 0.06})`
    g.fillRect(r() * S, r() * S, 1 + r() * 3, 20 + r() * 80)
  }
  sources.set(key, c)
  const t = finish(c)
  cache.set(key, t)
  return t
}

/** Concrete / landing-field slabs with expansion joints and stains. 1 tile ≈ 24 m. */
export function concreteTexture(): THREE.Texture {
  const key = 'concrete'
  if (cache.has(key)) return cache.get(key)!
  const S = 512
  const [c, g] = canvas(S)
  const r = rng(91)
  g.fillStyle = '#7d756b'
  g.fillRect(0, 0, S, S)
  for (let i = 0; i < 9000; i++) {
    const v = 100 + r() * 40
    g.fillStyle = `rgba(${v},${v - 6},${v - 14},0.25)`
    g.fillRect(r() * S, r() * S, 2, 2)
  }
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const d = (r() - 0.5) * 18
      g.fillStyle = `rgba(${d > 0 ? 255 : 0},${d > 0 ? 255 : 0},${d > 0 ? 255 : 0},${Math.abs(d) / 255})`
      g.fillRect(i * 128, j * 128, 128, 128)
    }
  }
  g.fillStyle = 'rgba(20,18,15,0.55)'
  for (let i = 0; i <= 4; i++) {
    g.fillRect(i * 128 - 1, 0, 2, S)
    g.fillRect(0, i * 128 - 1, S, 2)
  }
  for (let i = 0; i < 12; i++) {
    const grd = g.createRadialGradient(r() * S, r() * S, 0, r() * S, r() * S, 30 + r() * 60)
    grd.addColorStop(0, 'rgba(30,25,20,0.18)')
    grd.addColorStop(1, 'rgba(30,25,20,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, S, S)
  }
  sources.set(key, c)
  const t = finish(c)
  cache.set(key, t)
  return t
}

/** Road surface with dashed centre line and edge lines (U across width, V along length). */
export function roadTexture(): THREE.Texture {
  const key = 'road'
  if (cache.has(key)) return cache.get(key)!
  const [c, g] = canvas(256)
  const r = rng(5)
  g.fillStyle = '#3b3a38'
  g.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 3000; i++) {
    const v = 50 + r() * 30
    g.fillStyle = `rgba(${v},${v},${v},0.4)`
    g.fillRect(r() * 256, r() * 256, 2, 2)
  }
  g.fillStyle = '#c9a54a'
  g.fillRect(124, 0, 8, 120)
  g.fillStyle = '#b8b8b0'
  g.fillRect(10, 0, 5, 256)
  g.fillRect(241, 0, 5, 256)
  const t = finish(c)
  cache.set(key, t)
  return t
}

/** Fine ground detail (sand/rock grain) tiled over the terrain. */
export function groundDetailTexture(): THREE.Texture {
  const key = 'ground'
  if (cache.has(key)) return cache.get(key)!
  const S = 256
  const [c, g] = canvas(S)
  const r = rng(77)
  g.fillStyle = '#808080'
  g.fillRect(0, 0, S, S)
  for (let i = 0; i < 12000; i++) {
    const v = 90 + r() * 80
    g.fillStyle = `rgba(${v},${v},${v},0.35)`
    const s = r() < 0.05 ? 3 : 1
    g.fillRect(r() * S, r() * S, s, s)
  }
  const t = finish(c)
  cache.set(key, t)
  return t
}

/** Landing pad markings: concentric rings, Imperial-style cog emblem (original geometric design). */
export function padTexture(): THREE.Texture {
  const key = 'pad'
  if (cache.has(key)) return cache.get(key)!
  const S = 1024
  const [c, g] = canvas(S)
  g.fillStyle = '#50545a'
  g.fillRect(0, 0, S, S)
  const r = rng(3)
  for (let i = 0; i < 20000; i++) {
    const v = 70 + r() * 30
    g.fillStyle = `rgba(${v},${v},${v + 4},0.3)`
    g.fillRect(r() * S, r() * S, 2, 2)
  }
  g.translate(S / 2, S / 2)
  g.strokeStyle = '#d0a83c'
  g.lineWidth = 14
  g.beginPath(); g.arc(0, 0, S * 0.44, 0, Math.PI * 2); g.stroke()
  g.lineWidth = 6
  g.setLineDash([40, 30])
  g.beginPath(); g.arc(0, 0, S * 0.38, 0, Math.PI * 2); g.stroke()
  g.setLineDash([])
  // six-spoke wheel emblem (original geometric mark)
  g.strokeStyle = 'rgba(220,220,215,0.85)'
  g.lineWidth = 10
  g.beginPath(); g.arc(0, 0, S * 0.2, 0, Math.PI * 2); g.stroke()
  g.beginPath(); g.arc(0, 0, S * 0.06, 0, Math.PI * 2); g.stroke()
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    g.beginPath()
    g.moveTo(Math.cos(a) * S * 0.06, Math.sin(a) * S * 0.06)
    g.lineTo(Math.cos(a) * S * 0.2, Math.sin(a) * S * 0.2)
    g.stroke()
  }
  // alignment arrow (east)
  g.fillStyle = '#d0a83c'
  g.beginPath(); g.moveTo(S * 0.3, -30); g.lineTo(S * 0.36, 0); g.lineTo(S * 0.3, 30); g.fill()
  const t = finish(c, true, false)
  cache.set(key, t)
  return t
}

/** Window band texture: rows of lit/unlit windows (emissive map). */
export function windowTexture(): THREE.Texture {
  const key = 'windows'
  if (cache.has(key)) return cache.get(key)!
  const [c, g] = canvas(256)
  const r = rng(19)
  g.fillStyle = '#05070a'
  g.fillRect(0, 0, 256, 256)
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 16; x++) {
      const lit = r() > 0.35
      g.fillStyle = lit ? `rgba(255,${200 + r() * 40},${140 + r() * 60},${0.55 + r() * 0.45})` : 'rgba(40,60,80,0.4)'
      g.fillRect(x * 16 + 2, y * 32 + 6, 12, 18)
    }
  }
  const t = finish(c)
  cache.set(key, t)
  return t
}

// ------------------------------------------------------------------ normal maps

/** Tangent-space normal map from a height field (Sobel), wrapped at the edges. */
function normalFromHeight(h: Float32Array, S: number, strength: number) {
  const [c, g] = canvas(S)
  const img = g.createImageData(S, S)
  const at = (x: number, y: number) => h[((y + S) % S) * S + ((x + S) % S)]
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1))
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1))
      // canvas y runs down while texture v runs up (flipY), hence +dy for the green channel
      let nx = -dx * strength
      let ny = dy * strength
      const nz = 1
      const l = Math.hypot(nx, ny, nz)
      nx /= l
      ny /= l
      const i = (y * S + x) * 4
      img.data[i] = (nx * 0.5 + 0.5) * 255
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255
      img.data[i + 2] = (nz / l * 0.5 + 0.5) * 255
      img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  return finish(c, false)
}

function heightFromCanvas(src: HTMLCanvasElement) {
  const S = src.width
  const d = src.getContext('2d')!.getImageData(0, 0, S, S).data
  const h = new Float32Array(S * S)
  for (let i = 0; i < S * S; i++) h[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255
  return h
}

/** Normal map matching panelTexture(kind) / concreteTexture() pixel-for-pixel (seams recess, plates catch light). */
export function detailNormal(kind: 'hull' | 'dark' | 'light' | 'concrete', strength = 2.2): THREE.Texture {
  const key = `n-${kind}`
  if (cache.has(key)) return cache.get(key)!
  if (kind === 'concrete') concreteTexture()
  else panelTexture(kind)
  const src = sources.get(kind === 'concrete' ? 'concrete' : `panel-${kind}`)!
  const t = normalFromHeight(heightFromCanvas(src), src.width, strength)
  cache.set(key, t)
  return t
}

// ------------------------------------------------------------------ apron (ferrocrete plateau)

/** World size covered by the apron macro texture (square, centred on the origin). */
export const APRON_EXTENT = (PERIMETER_RADIUS + 20) * 2
/** One detail tile = 2 × 2 slabs of 12 m. */
export const APRON_TILE = 24

/** Tiled ferrocrete detail: slab seams with chamfers, aggregate, hairline cracks. Returns colour, normal, roughness. */
export function apronDetail(): { map: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture } {
  const key = 'apron'
  if (cache.has(key)) return { map: cache.get(key)!, normal: cache.get(key + '-n')!, rough: cache.get(key + '-r')! }
  const S = 1024
  const half = S / 2
  const r = rng(404)
  const h = new Float32Array(S * S).fill(0.6)
  const [c, g] = canvas(S)
  const [rc, rg] = canvas(S)
  // per-slab base tone (2 × 2 slabs per tile)
  const tones = [0, 1, 2, 3].map(() => 0.93 + r() * 0.12)
  for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
    const t = tones[sy * 2 + sx]
    g.fillStyle = `rgb(${Math.round(150 * t)},${Math.round(146 * t)},${Math.round(138 * t)})`
    g.fillRect(sx * half, sy * half, half, half)
    const rv = Math.round(200 + r() * 30)
    rg.fillStyle = `rgb(${rv},${rv},${rv})`
    rg.fillRect(sx * half, sy * half, half, half)
  }
  // aggregate speckle + pitting
  const img = g.getImageData(0, 0, S, S)
  for (let i = 0; i < S * S; i++) {
    const x = i % S
    const y = (i / S) | 0
    const n = fbm(x * 0.02, y * 0.02, 3) * 0.06 + (r() - 0.5) * 0.09
    const k = i * 4
    img.data[k] = Math.max(0, Math.min(255, img.data[k] * (1 + n)))
    img.data[k + 1] = Math.max(0, Math.min(255, img.data[k + 1] * (1 + n)))
    img.data[k + 2] = Math.max(0, Math.min(255, img.data[k + 2] * (1 + n * 0.9)))
    h[i] += n * 0.25
    if (r() < 0.0025) h[i] -= 0.35 // pits
  }
  g.putImageData(img, 0, 0)
  // seams: recessed joint + darker sealant + lighter worn chamfer
  const seam = (vertical: boolean, at: number) => {
    for (let d = -5; d <= 5; d++) {
      const depth = Math.abs(d) <= 2 ? 0 : Math.abs(d) <= 4 ? 0.35 : 0.5
      for (let t = 0; t < S; t++) {
        const x = vertical ? (at + d + S) % S : t
        const y = vertical ? t : (at + d + S) % S
        h[y * S + x] = Math.min(h[y * S + x], 0.1 + depth)
      }
    }
    g.fillStyle = 'rgba(28,26,24,0.85)'
    if (vertical) g.fillRect(at - 2, 0, 5, S); else g.fillRect(0, at - 2, S, 5)
    g.fillStyle = 'rgba(210,200,185,0.18)'
    if (vertical) { g.fillRect(at - 5, 0, 2, S); g.fillRect(at + 3, 0, 2, S) } else { g.fillRect(0, at - 5, S, 2); g.fillRect(0, at + 3, S, 2) }
    rg.fillStyle = 'rgb(250,250,250)'
    if (vertical) rg.fillRect(at - 3, 0, 7, S); else rg.fillRect(0, at - 3, S, 7)
  }
  seam(true, 0); seam(true, half); seam(false, 0); seam(false, half)
  // hairline cracks wandering from seams
  g.strokeStyle = 'rgba(30,26,22,0.55)'
  g.lineWidth = 1.2
  for (let i = 0; i < 7; i++) {
    let x = r() * S
    let y = r() * S
    let a = r() * Math.PI * 2
    g.beginPath(); g.moveTo(x, y)
    for (let j = 0; j < 26; j++) {
      a += (r() - 0.5) * 0.9
      x += Math.cos(a) * 6
      y += Math.sin(a) * 6
      g.lineTo(x, y)
      const xi = ((x | 0) + S) % S
      const yi = ((y | 0) + S) % S
      h[yi * S + xi] -= 0.25
    }
    g.stroke()
  }
  // dowel / lifting-anchor plugs at slab corners
  for (const [x, y] of [[half / 2, half / 2], [half * 1.5, half / 2], [half / 2, half * 1.5], [half * 1.5, half * 1.5]]) {
    g.fillStyle = 'rgba(70,68,64,0.8)'
    g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill()
    for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) if (dx * dx + dy * dy < 49) h[((y + dy) | 0) * S + ((x + dx) | 0)] -= 0.15
  }
  const map = finish(c)
  const normal = normalFromHeight(h, S, 3.2)
  const rough = finish(rc, false)
  cache.set(key, map)
  cache.set(key + '-n', normal)
  cache.set(key + '-r', rough)
  return { map, normal, rough }
}

/**
 * Macro texture over the whole base (multiplied ×2 in the shader, so mid-grey = unchanged):
 * per-slab tonal variation, contact grime at building bases, scorch at pads and the hangar mouth,
 * tyre streaks, painted safety markings and wind-blown sand drifting in from the walls.
 */
export function apronMacro(): THREE.Texture {
  const key = 'apron-macro'
  if (cache.has(key)) return cache.get(key)!
  const S = 2048
  const E = APRON_EXTENT
  const [c, g] = canvas(S)
  const r = rng(77)
  const px = (x: number) => (x / E + 0.5) * S
  const pz = (z: number) => (0.5 - z / E) * S // flipY: canvas row 0 = +z edge
  const m = S / E // pixels per metre
  g.fillStyle = 'rgb(128,128,128)'
  g.fillRect(0, 0, S, S)
  // large-scale blotchy weathering (low-res noise, smoothly upscaled)
  {
    const L = 192
    const [lc, lg] = canvas(L)
    const img = lg.createImageData(L, L)
    for (let y = 0; y < L; y++) for (let x = 0; x < L; x++) {
      const v = fbm(x * 0.045, y * 0.045, 4) * 0.5 + fbm(x * 0.17 + 9, y * 0.17, 2) * 0.18
      const k = (y * L + x) * 4
      const b = 128 * (1 + v * 0.22)
      img.data[k] = b; img.data[k + 1] = b * 0.995; img.data[k + 2] = b * 0.985; img.data[k + 3] = 255
    }
    lg.putImageData(img, 0, 0)
    g.imageSmoothingEnabled = true
    g.drawImage(lc, 0, 0, S, S)
  }
  // per-slab tonal variation (12 m slabs, aligned with the detail tile seams)
  const slab = 12
  for (let x = -E / 2; x < E / 2; x += slab) for (let z = -E / 2; z < E / 2; z += slab) {
    const sx = Math.floor(x / slab) * slab
    const sz = Math.floor(z / slab) * slab
    const d = (r() - 0.5) * 0.12 + (r() < 0.04 ? -0.1 : 0) // occasional replaced (darker) slab
    g.fillStyle = d > 0 ? `rgba(255,250,240,${d})` : `rgba(20,18,16,${-d})`
    g.fillRect(px(sx), pz(sz + slab), slab * m, slab * m)
  }
  // contact grime / AO at building bases (blurred)
  g.save()
  g.filter = `blur(${Math.round(5 * m)}px)`
  g.fillStyle = 'rgba(30,26,22,0.55)'
  for (const f of FACILITIES) {
    const pad = 5
    g.fillRect(px(f.x - f.sx / 2 - pad), pz(f.z + f.sz / 2 + pad), (f.sx + pad * 2) * m, (f.sz + pad * 2) * m)
  }
  g.restore()
  // scorch rings at ground pads, the hangar mouth and under the main platform's approach
  const scorch = (x: number, z: number, rad: number, a: number) => {
    const grd = g.createRadialGradient(px(x), pz(z), rad * m * 0.15, px(x), pz(z), rad * m)
    grd.addColorStop(0, `rgba(18,14,12,${a})`)
    grd.addColorStop(0.55, `rgba(30,24,20,${a * 0.6})`)
    grd.addColorStop(1, 'rgba(40,32,26,0)')
    g.fillStyle = grd
    g.beginPath(); g.arc(px(x), pz(z), rad * m, 0, Math.PI * 2); g.fill()
  }
  for (const p of PADS) scorch(p.x, p.z, p.radius * (p.y > 2 ? 1.9 : 1.55), p.y > 2 ? 0.35 : 0.55)
  scorch(HANGAR_DOOR.x + 30, HANGAR_DOOR.z, 55, 0.4)
  // exhaust streaks fanning out of the hangar mouth (fighters taxi east)
  g.save()
  g.filter = `blur(${Math.round(1.2 * m)}px)`
  for (let i = 0; i < 60; i++) {
    const z0 = HANGAR_DOOR.z + (r() - 0.5) * HANGAR_DOOR.width * 0.8
    const len = 25 + r() * 60
    g.strokeStyle = `rgba(25,20,16,${0.08 + r() * 0.12})`
    g.lineWidth = (0.6 + r() * 1.6) * m
    g.beginPath()
    g.moveTo(px(HANGAR_DOOR.x + 2), pz(z0))
    g.quadraticCurveTo(px(HANGAR_DOOR.x + len * 0.5), pz(z0 + (r() - 0.5) * 10), px(HANGAR_DOOR.x + len), pz(z0 + (r() - 0.5) * 30))
    g.stroke()
  }
  g.restore()
  // tyre / skid arcs near the depot and the apron
  g.lineCap = 'round'
  const tyreArc = (cx: number, cz: number, n: number, spread: number) => {
    for (let i = 0; i < n; i++) {
      const a0 = r() * Math.PI * 2
      const rad = 8 + r() * spread
      g.strokeStyle = `rgba(22,20,18,${0.12 + r() * 0.15})`
      g.lineWidth = 0.7 * m
      for (const off of [-1.1, 1.1]) {
        g.beginPath()
        g.arc(px(cx), pz(cz), (rad + off) * m, a0, a0 + 0.6 + r() * 1.2)
        g.stroke()
      }
    }
  }
  tyreArc(254, 230, 14, 22)
  tyreArc(-165, 20, 12, 30)
  tyreArc(-150, -110, 6, 14)
  // painted markings: hatched safety boxes at doors, a taxi line hangar → main pad
  const yellow = 'rgba(255,214,90,0.95)'
  for (const f of FACILITIES) {
    const [dx, dz] = f.door
    const w = 10
    g.save()
    g.translate(px(dx), pz(dz))
    g.strokeStyle = yellow
    g.lineWidth = 0.5 * m
    g.strokeRect(-w / 2 * m, -w / 2 * m, w * m, w * m)
    g.beginPath()
    g.rect(-w / 2 * m, -w / 2 * m, w * m, w * m)
    g.clip()
    g.lineWidth = 0.6 * m
    for (let k = -w; k <= w; k += 2) { g.beginPath(); g.moveTo((k - w) * m, w * m); g.lineTo((k + w) * m, -w * m); g.stroke() }
    g.restore()
  }
  g.strokeStyle = yellow
  g.lineWidth = 0.6 * m
  g.setLineDash([])
  // taxi line from the hangar door to the main platform, only while the platform stands in front of the hangar
  if (Math.hypot(PADS[0].x - HANGAR_DOOR.x, PADS[0].z - HANGAR_DOOR.z) < 150) {
    g.beginPath(); g.moveTo(px(HANGAR_DOOR.x + 2), pz(HANGAR_DOOR.z)); g.lineTo(px(PADS[0].x - PADS[0].radius - 6), pz(PADS[0].z)); g.stroke()
  }
  // red no-go borders around ground pads
  g.strokeStyle = 'rgba(200,60,40,0.85)'
  g.lineWidth = 0.7 * m
  g.setLineDash([3 * m, 2 * m])
  for (const p of PADS) if (p.y < 2) { g.beginPath(); g.arc(px(p.x), pz(p.z), (p.radius + 4) * m, 0, Math.PI * 2); g.stroke() }
  g.setLineDash([])
  // wind-blown sand: warm, brighter drifts creeping in from the walls (strongest on the west/windward side)
  {
    const L = 256
    const [lc, lg] = canvas(L)
    const img = lg.createImageData(L, L)
    for (let y = 0; y < L; y++) for (let x = 0; x < L; x++) {
      const wx = (x / L - 0.5) * E
      const wz = (0.5 - y / L) * E
      const rr = Math.hypot(wx, wz)
      const edge = Math.min(1, Math.max(0, (rr - (PERIMETER_RADIUS - 95)) / 90))
      const windward = 0.65 + 0.35 * Math.max(0, -wx / rr)
      const streak = fbm(wx * 0.012, wz * 0.05, 3) * 0.5 + 0.5
      const a = Math.min(1, edge * windward * (0.55 + streak * 0.7))
      const k = (y * L + x) * 4
      img.data[k] = 196; img.data[k + 1] = 160; img.data[k + 2] = 112; img.data[k + 3] = a * 200
    }
    lg.putImageData(img, 0, 0)
    g.drawImage(lc, 0, 0, S, S)
  }
  const t = finish(c, true, false)
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  cache.set(key, t)
  return t
}

/** Sand ripple normal map for the desert (tiled with the terrain UVs, 1 tile = 18 m). */
export function sandNormal(): THREE.Texture {
  const key = 'sand-n'
  if (cache.has(key)) return cache.get(key)!
  const S = 512
  const r = rng(12)
  const h = new Float32Array(S * S)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S
    const v = y / S
    // tileable ripple field: integer frequencies keep it seamless
    const warp = Math.sin(u * Math.PI * 2 * 2 + Math.sin(v * Math.PI * 2 * 3) * 0.8) * 0.35
    const ripple = Math.sin((v * 22 + warp * 3 + Math.sin(u * Math.PI * 2) * 0.6) * Math.PI * 2)
    h[y * S + x] = ripple * 0.5 * (0.7 + 0.3 * Math.sin(u * Math.PI * 2 * 3 + v * Math.PI * 2)) + (r() - 0.5) * 0.25
  }
  const t = normalFromHeight(h, S, 0.9)
  cache.set(key, t)
  return t
}

/** Soft round sprite for airborne dust. */
export function softDotTexture(): THREE.Texture {
  const key = 'dot'
  if (cache.has(key)) return cache.get(key)!
  const [c, g] = canvas(64)
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.4, 'rgba(255,255,255,0.45)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 64, 64)
  const t = finish(c, true, false)
  cache.set(key, t)
  return t
}

/** Radial light pool (additive ground decal under lamps at night). */
export function lightPoolTexture(): THREE.Texture {
  const key = 'pool'
  if (cache.has(key)) return cache.get(key)!
  const [c, g] = canvas(256)
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128)
  // gaussian falloff reaching exactly zero at the rim, so pools melt into the ground instead of reading as discs
  for (let i = 0; i <= 24; i++) {
    const t = i / 24
    const a = Math.exp(-t * t * 6) * (1 - t * t)
    grd.addColorStop(t, `rgba(255,${Math.round(226 - t * 40)},${Math.round(186 - t * 60)},${a.toFixed(4)})`)
  }
  g.fillStyle = grd
  g.fillRect(0, 0, 256, 256)
  const t = finish(c, true, false)
  cache.set(key, t)
  return t
}

/** Radial green LED diode glow decal for taxiway centerline lighting. */
export function diodeGlowTexture(): THREE.Texture {
  const key = 'diode-glow'
  if (cache.has(key)) return cache.get(key)!
  const [c, g] = canvas(128)
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  for (let i = 0; i <= 16; i++) {
    const t = i / 16
    const a = Math.exp(-t * t * 4.5) * (1 - t * t)
    grd.addColorStop(t, `rgba(45,${Math.round(255 - t * 40)},${Math.round(140 - t * 60)},${a.toFixed(4)})`)
  }
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  const t = finish(c, true, false)
  cache.set(key, t)
  return t
}



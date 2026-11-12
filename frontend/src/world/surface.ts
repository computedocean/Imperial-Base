// Procedural surface textures for the larger set pieces (temple stone, capital-ship plating and
// window lights, weathered timber). Generated once in a canvas, deterministic, tileable.
// They are neutral in colour: the material's own colour tints them.
import * as THREE from 'three'

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

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = c.height = size
  return [c, c.getContext('2d')!]
}

function finish(c: HTMLCanvasElement, srgb: boolean) {
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

function lazy<T>(f: () => T) {
  let v: T | undefined
  return () => (v ??= f())
}

/** Fine grain over the whole canvas (wraps, so tiles do not show a seam). */
function grain(ctx: CanvasRenderingContext2D, size: number, r: () => number, amount: number, count: number) {
  for (let i = 0; i < count; i++) {
    const v = r() < 0.5 ? 0 : 255
    ctx.fillStyle = `rgba(${v},${v},${v},${r() * amount})`
    const s = 1 + Math.floor(r() * 3)
    ctx.fillRect(Math.floor(r() * size), Math.floor(r() * size), s, s)
  }
}

/**
 * Dressed stone in courses: big blocks of slightly different tone, dark recessed joints, chipped
 * edges, rain streaks running down from the joints. One tile = 8 courses.
 */
export const stoneTexture = lazy(() => {
  const S = 1024
  const [c, ctx] = canvas(S)
  const r = rng(4107)
  ctx.fillStyle = '#c9c6c0'
  ctx.fillRect(0, 0, S, S)
  const rows = 8
  const h = S / rows
  for (let j = 0; j < rows; j++) {
    // block widths that add up exactly to the tile, so the pattern wraps
    const widths: number[] = []
    let left = S
    while (left > 0) {
      const w = Math.min(left, Math.round((0.14 + r() * 0.16) * S))
      widths.push(left - w < S * 0.08 ? left : w)
      left -= widths[widths.length - 1]
    }
    let x = (j % 2) * S * 0.07
    for (const w of widths) {
      const tone = 188 + Math.round(r() * 50)
      const warm = Math.round(r() * 10)
      ctx.fillStyle = `rgb(${tone + warm},${tone + Math.round(warm / 2)},${tone - warm})`
      for (const ox of [0, -S]) ctx.fillRect(x + ox + 3, j * h + 3, w - 6, h - 6)
      // soft shading inside the block: lighter top edge, darker bottom
      for (const ox of [0, -S]) {
        const g = ctx.createLinearGradient(0, j * h, 0, (j + 1) * h)
        g.addColorStop(0, 'rgba(255,255,255,0.16)')
        g.addColorStop(0.18, 'rgba(255,255,255,0)')
        g.addColorStop(0.8, 'rgba(0,0,0,0)')
        g.addColorStop(1, 'rgba(0,0,0,0.2)')
        ctx.fillStyle = g
        ctx.fillRect(x + ox + 3, j * h + 3, w - 6, h - 6)
      }
      x += w
    }
  }
  // joints
  ctx.fillStyle = 'rgba(52,46,40,0.9)'
  for (let j = 0; j < rows; j++) ctx.fillRect(0, j * h - 2, S, 5)
  // weathering: streaks, chips, grain
  for (let i = 0; i < 90; i++) {
    const x = r() * S, y = Math.floor(r() * rows) * h, len = 30 + r() * 150
    const g = ctx.createLinearGradient(0, y, 0, y + len)
    g.addColorStop(0, `rgba(40,34,28,${0.1 + r() * 0.22})`)
    g.addColorStop(1, 'rgba(40,34,28,0)')
    ctx.fillStyle = g
    ctx.fillRect(x, y, 3 + r() * 9, len)
  }
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(30,26,22,${0.15 + r() * 0.3})`
    ctx.beginPath()
    ctx.arc(r() * S, r() * S, 1 + r() * 4, 0, Math.PI * 2)
    ctx.fill()
  }
  grain(ctx, S, r, 0.07, 26000)
  return finish(c, true)
})

/**
 * Capital-ship armour: long plates in bands, fine seams, scattered hatches and vents.
 * One tile is meant to cover roughly 120 m.
 */
export const armourTexture = lazy(() => {
  const S = 1024
  const [c, ctx] = canvas(S)
  const r = rng(977)
  ctx.fillStyle = '#c8cacd'
  ctx.fillRect(0, 0, S, S)
  let y = 0
  while (y < S) {
    const bh = Math.min(S - y, 22 + Math.round(r() * 70))
    let x = 0
    while (x < S) {
      const bw = Math.min(S - x, 30 + Math.round(r() * 190))
      const tone = 176 + Math.round(r() * 62)
      ctx.fillStyle = `rgb(${tone},${tone + 1},${tone + 3})`
      ctx.fillRect(x + 1, y + 1, bw - 2, bh - 2)
      if (r() < 0.16) { // a recessed hatch or vent
        ctx.fillStyle = `rgba(30,32,36,${0.45 + r() * 0.4})`
        ctx.fillRect(x + bw * 0.2, y + bh * 0.25, bw * (0.15 + r() * 0.4), bh * 0.5)
      }
      x += bw
    }
    y += bh
  }
  ctx.strokeStyle = 'rgba(36,38,42,0.55)'
  ctx.lineWidth = 1
  for (let i = 0; i < 26; i++) { // long structural seams
    const p = Math.round(r() * S) + 0.5
    ctx.beginPath()
    if (r() < 0.5) { ctx.moveTo(0, p); ctx.lineTo(S, p) } else { ctx.moveTo(p, 0); ctx.lineTo(p, S) }
    ctx.stroke()
  }
  grain(ctx, S, r, 0.05, 20000)
  return finish(c, true)
})

/** Thousands of lit viewports: sparse warm dots in short rows on near-black (an emissive map). */
export const viewportLights = lazy(() => {
  const S = 1024
  const [c, ctx] = canvas(S)
  const r = rng(31)
  ctx.fillStyle = '#16181c' // a faint base glow so the hull is never fully black at night
  ctx.fillRect(0, 0, S, S)
  for (let i = 0; i < 520; i++) {
    const x = Math.floor(r() * S), y = Math.floor(r() * S)
    const n = 1 + Math.floor(r() * 9)
    const warm = r() < 0.75
    for (let k = 0; k < n; k++) {
      if (r() < 0.25) continue
      const b = 150 + Math.round(r() * 105)
      ctx.fillStyle = warm ? `rgb(${b},${Math.round(b * 0.86)},${Math.round(b * 0.6)})` : `rgb(${Math.round(b * 0.7)},${Math.round(b * 0.85)},${b})`
      ctx.fillRect((x + k * 5) % S, y, 2, 2)
    }
  }
  return finish(c, true)
})

/** Weathered planking: long boards with grain, nail heads and sun-bleached patches. */
export const timberTexture = lazy(() => {
  const S = 512
  const [c, ctx] = canvas(S)
  const r = rng(555)
  const boards = 10
  const h = S / boards
  for (let j = 0; j < boards; j++) {
    const tone = 150 + Math.round(r() * 70)
    ctx.fillStyle = `rgb(${tone},${Math.round(tone * 0.92)},${Math.round(tone * 0.84)})`
    ctx.fillRect(0, j * h, S, h)
    for (let i = 0; i < 46; i++) { // grain
      ctx.fillStyle = `rgba(${r() < 0.5 ? 0 : 255},${r() < 0.5 ? 0 : 240},200,${0.04 + r() * 0.07})`
      ctx.fillRect(r() * S, j * h + r() * h, 30 + r() * 160, 1)
    }
    ctx.fillStyle = 'rgba(20,14,8,0.8)'
    ctx.fillRect(0, j * h, S, 2)
    const joint = r() * S
    ctx.fillRect(joint, j * h, 2, h)
    ctx.fillStyle = 'rgba(15,12,10,0.7)'
    for (const dx of [8, -10]) ctx.fillRect((joint + dx + S) % S, j * h + h * 0.3, 3, 3)
  }
  grain(ctx, S, r, 0.06, 9000)
  return finish(c, true)
})

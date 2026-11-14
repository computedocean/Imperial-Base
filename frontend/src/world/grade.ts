// Colour grade as a 3D look-up table, built in code from the time-of-day preset.
//
// The table is applied after tone mapping, on display-referred sRGB values. It folds contrast and
// saturation into one lookup and adds what the separate effects could not: split toning (cool
// shadows against warm highlights, the classic film look) and a slightly lifted black point.
import { LookupTexture } from 'postprocessing'

export interface Grade {
  /** contrast around mid grey: 0 = unchanged, 0.2 = clearly punchier */
  contrast: number
  /** saturation: 0 = unchanged, -1 = grey */
  saturation: number
  /** hue pushed into the shadows and into the highlights (only their hue is used, not their brightness) */
  shadows: string
  highlights: string
  /** strength of the split toning */
  split: number
  /** black point lift, as a fraction of full white */
  lift: number
}

type RGB = [number, number, number]

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** The colour of a tint with its brightness removed, so toning shifts hue without changing exposure. */
function chroma(hex: string): RGB {
  const [r, g, b] = hexToRgb(hex)
  const l = luma(r, g, b)
  return [r - l, g - l, b - l]
}

/** S-curve that keeps 0, 0.5 and 1 fixed and never clips. k = 1 is the identity. */
function sCurve(x: number, k: number) {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const a = Math.pow(x, k)
  return a / (a + Math.pow(1 - x, k))
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/** Grade one display-referred sRGB colour (components 0..1). */
export function gradeColor(rgb: RGB, g: Grade): RGB {
  const k = 1 + g.contrast * 1.5
  let r = sCurve(rgb[0], k)
  let gr = sCurve(rgb[1], k)
  let b = sCurve(rgb[2], k)

  const l = luma(r, gr, b)
  const s = 1 + g.saturation
  r = l + (r - l) * s
  gr = l + (gr - l) * s
  b = l + (b - l) * s

  // split toning: shadows weighted towards black, highlights towards white, mid grey barely touched
  const sh = chroma(g.shadows)
  const hi = chroma(g.highlights)
  const ws = (1 - l) * (1 - l) * g.split
  const wh = l * l * g.split
  r += sh[0] * ws + hi[0] * wh
  gr += sh[1] * ws + hi[1] * wh
  b += sh[2] * ws + hi[2] * wh

  const lift = g.lift
  return [clamp01(lift + r * (1 - lift)), clamp01(lift + gr * (1 - lift)), clamp01(lift + b * (1 - lift))]
}

/** Build the look-up table for a grade. 32 steps per axis is plenty for a smooth curve like this. */
export function buildGradeLut(g: Grade, size = 32): LookupTexture {
  const lut = LookupTexture.createNeutral(size)
  const data = lut.image.data as Float32Array
  for (let i = 0; i < data.length; i += 4) {
    const [r, gr, b] = gradeColor([data[i], data[i + 1], data[i + 2]], g)
    data[i] = r
    data[i + 1] = gr
    data[i + 2] = b
  }
  lut.name = 'grade'
  lut.needsUpdate = true
  return lut
}

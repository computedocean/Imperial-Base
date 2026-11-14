import { describe, expect, it } from 'vitest'
import { gradeColor, type Grade } from './grade'

const NEUTRAL: Grade = { contrast: 0, saturation: 0, shadows: '#808080', highlights: '#808080', split: 0, lift: 0 }

describe('gradeColor', () => {
  it('is the identity for a neutral grade', () => {
    const c = gradeColor([0.2, 0.5, 0.8], NEUTRAL)
    expect(c[0]).toBeCloseTo(0.2, 6)
    expect(c[1]).toBeCloseTo(0.5, 6)
    expect(c[2]).toBeCloseTo(0.8, 6)
  })

  it('contrast darkens shadows, brightens highlights and keeps mid grey', () => {
    const g = { ...NEUTRAL, contrast: 0.2 }
    expect(gradeColor([0.2, 0.2, 0.2], g)[0]).toBeLessThan(0.2)
    expect(gradeColor([0.8, 0.8, 0.8], g)[0]).toBeGreaterThan(0.8)
    expect(gradeColor([0.5, 0.5, 0.5], g)[0]).toBeCloseTo(0.5, 6)
  })

  it('full desaturation gives grey', () => {
    const [r, g, b] = gradeColor([0.9, 0.3, 0.1], { ...NEUTRAL, saturation: -1 })
    expect(r).toBeCloseTo(g, 6)
    expect(g).toBeCloseTo(b, 6)
  })

  it('split toning cools the shadows and warms the highlights', () => {
    const g = { ...NEUTRAL, shadows: '#2a5a80', highlights: '#ffb060', split: 0.2 }
    const dark = gradeColor([0.1, 0.1, 0.1], g)
    const bright = gradeColor([0.9, 0.9, 0.9], g)
    expect(dark[2]).toBeGreaterThan(dark[0]) // bluer
    expect(bright[0]).toBeGreaterThan(bright[2]) // warmer
  })

  it('lift raises black and leaves white alone', () => {
    const g = { ...NEUTRAL, lift: 0.02 }
    expect(gradeColor([0, 0, 0], g)[0]).toBeCloseTo(0.02, 6)
    expect(gradeColor([1, 1, 1], g)[0]).toBeCloseTo(1, 6)
  })

  it('stays inside the displayable range', () => {
    const g: Grade = { contrast: 0.3, saturation: 0.4, shadows: '#0030ff', highlights: '#ff5000', split: 0.5, lift: 0.03 }
    for (const c of [[0, 0, 0], [1, 1, 1], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0]] as [number, number, number][]) {
      for (const v of gradeColor(c, g)) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })
})

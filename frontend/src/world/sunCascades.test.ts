import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { CASCADE_MAX_HALF, cascadeHalfExtents, patchLightsChunk } from './sunCascades'

describe('cascadeHalfExtents', () => {
  it('keeps the first cascade at the tight fit and ends at the maximum', () => {
    const h = cascadeHalfExtents(70, 3)
    expect(h[0]).toBe(70)
    expect(h[2]).toBeCloseTo(CASCADE_MAX_HALF, 6)
  })

  it('spaces cascades by a constant ratio', () => {
    const h = cascadeHalfExtents(70, 3)
    expect(h[1] / h[0]).toBeCloseTo(h[2] / h[1], 6)
  })

  it('returns the single fit for one cascade', () => {
    expect(cascadeHalfExtents(480, 1)).toEqual([480])
  })

  it('never shrinks when the tight fit already exceeds the maximum', () => {
    const h = cascadeHalfExtents(2000, 3)
    expect(h).toEqual([2000, 2000, 2000])
  })
})

describe('patchLightsChunk', () => {
  const stock = THREE.ShaderChunk.lights_fragment_begin

  it('matches the lighting chunk of the installed three', () => {
    expect(patchLightsChunk(stock)).not.toBeNull()
  })

  it('replaces only the directional-light block', () => {
    const patched = patchLightsChunk(stock)!
    expect(patched).toContain('sunShade')
    // the point and spot light blocks are untouched
    expect(patched).toContain('getPointShadow(')
    expect(patched).toContain('getSpotLightInfo(')
    // one unrolled loop per light type, as before
    const loops = (s: string) => s.split('#pragma unroll_loop_start').length
    expect(loops(patched)).toBe(loops(stock))
  })

  it('reports a chunk it does not recognise', () => {
    expect(patchLightsChunk('void main() {}')).toBeNull()
  })
})

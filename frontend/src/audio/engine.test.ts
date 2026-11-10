import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { dopplerFactor } from './engine'

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const ZERO = V(0, 0, 0)

describe('dopplerFactor', () => {
  it('is 1 when nothing moves', () => {
    expect(dopplerFactor(V(100, 0, 0), ZERO, ZERO, ZERO)).toBeCloseTo(1, 6)
  })
  it('raises pitch when a fighter approaches and lowers it after the pass', () => {
    const approaching = dopplerFactor(V(-500, 0, 0), V(150, 0, 0), ZERO, ZERO)
    const receding = dopplerFactor(V(500, 0, 0), V(150, 0, 0), ZERO, ZERO)
    expect(approaching).toBeGreaterThan(1.2)
    expect(receding).toBeLessThan(0.85)
  })
  it('ignores motion perpendicular to the line of sight', () => {
    expect(dopplerFactor(V(0, 0, 300), V(150, 0, 0), ZERO, ZERO)).toBeCloseTo(1, 6)
  })
  it('accounts for a moving listener', () => {
    // listener flying toward a stationary source hears a higher pitch
    expect(dopplerFactor(V(500, 0, 0), ZERO, ZERO, V(100, 0, 0))).toBeGreaterThan(1.1)
  })
  it('stays within the clamped range', () => {
    expect(dopplerFactor(V(-1, 0, 0), V(5000, 0, 0), ZERO, ZERO)).toBeLessThanOrEqual(2)
    expect(dopplerFactor(V(1, 0, 0), V(5000, 0, 0), ZERO, ZERO)).toBeGreaterThanOrEqual(0.5)
  })
})

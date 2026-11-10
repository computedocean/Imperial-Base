import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { terrainHeight } from '../world/layout'
import { LEGS, ROUTE_CLEARANCE, WALKER, bodyAt, footAt, hipAt, solveKnee } from './walkerGait'

describe('heavy walker', () => {
  it('patrols outside the wall on flat ground, clear of both edges', () => {
    expect(ROUTE_CLEARANCE.wall).toBeGreaterThan(30)
    expect(ROUTE_CLEARANCE.plateau).toBeGreaterThan(15)
    for (let t = 0; t < 900; t += 7) {
      const b = bodyAt(t)
      expect(terrainHeight(b.x, b.z)).toBe(0)
    }
  })

  it('walks at its stated speed and faces the way it is going', () => {
    const a = bodyAt(100), b = bodyAt(101)
    const dx = b.x - a.x, dz = b.z - a.z
    expect(Math.hypot(dx, dz)).toBeCloseTo(WALKER.speed, 2)
    // heading h points a +Z-nosed model along (sin h, cos h)
    expect(Math.sin(a.heading)).toBeCloseTo(dx / Math.hypot(dx, dz), 2)
    expect(Math.cos(a.heading)).toBeCloseTo(dz / Math.hypot(dx, dz), 2)
  })

  it('never slides a planted foot, and always has at least three feet down', () => {
    const last = LEGS.map(() => ({ pos: new THREE.Vector3(), planted: false }))
    for (let i = 0; i < 4000; i++) {
      const t = i * 0.01
      let down = 0
      LEGS.forEach((leg, k) => {
        const f = footAt(leg, t)
        if (f.planted) {
          down++
          if (last[k].planted) expect(f.pos.distanceTo(last[k].pos)).toBeLessThan(1e-9)
          expect(f.pos.y).toBe(0)
        } else expect(f.pos.y).toBeGreaterThanOrEqual(0)
        last[k].pos.copy(f.pos)
        last[k].planted = f.planted
      })
      expect(down).toBeGreaterThanOrEqual(3)
    }
  })

  it('moves feet smoothly through the swing (no teleporting)', () => {
    for (const leg of LEGS) {
      const prev = footAt(leg, 0).pos.clone()
      for (let t = 0.01; t < 20; t += 0.01) {
        const p = footAt(leg, t).pos
        expect(p.distanceTo(prev)).toBeLessThan(0.45) // under 45 m/s at the fastest point of a swing
        prev.copy(p)
      }
    }
  })

  it('keeps every foot within reach of its hip, with the knee at the right bone lengths', () => {
    const knee = new THREE.Vector3()
    const fwd = new THREE.Vector3()
    for (const leg of LEGS) {
      for (let t = 0; t < 30; t += 0.05) {
        const hip = hipAt(leg, t)
        const ankle = footAt(leg, t).pos.clone()
        ankle.y += WALKER.ankle
        const b = bodyAt(t)
        fwd.set(Math.sin(b.heading), 0, Math.cos(b.heading))
        expect(solveKnee(hip, ankle, fwd, knee)).toBe(true)
        expect(knee.distanceTo(hip)).toBeCloseTo(WALKER.thigh, 4)
        expect(knee.distanceTo(ankle)).toBeCloseTo(WALKER.shin, 4)
        expect(knee.y).toBeGreaterThan(ankle.y) // the knee never folds below the ankle
      }
    }
  })
})

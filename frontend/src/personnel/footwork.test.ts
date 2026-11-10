import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createDuelState, duelAt } from './duelMoves'
import { Footwork, LEG, STEP, kneeOf } from './footwork'

const DT = 1 / 60

describe('duellist footwork', () => {
  it('holds planted feet still, steps one foot at a time, and never lets a foot stray far', () => {
    const s = createDuelState()
    const fw = new Footwork()
    const prev = [new THREE.Vector3(), new THREE.Vector3()]
    const wasPlanted = [false, false]
    const ideal = new THREE.Vector3()
    let steps = 0
    for (let i = 0; i < 60 * 90; i++) {
      const d = duelAt(i * DT, s).a
      fw.update(d.pos, d.heading, DT, d.lift, d.stance)
      const grounded = d.lift <= 0.03
      if (grounded) expect(fw.feet[0].k < 1 && fw.feet[1].k < 1).toBe(false)
      fw.feet.forEach((f, k) => {
        const planted = f.k >= 1 && grounded
        if (planted && wasPlanted[k]) expect(f.pos.distanceTo(prev[k])).toBeLessThan(1e-9)
        if (!planted && wasPlanted[k]) steps++
        fw.ideal(k as 0 | 1, d.pos, d.heading, ideal, d.stance)
        expect(Math.hypot(f.pos.x - ideal.x, f.pos.z - ideal.z)).toBeLessThan(0.6)
        expect(f.pos.y).toBeGreaterThanOrEqual(d.pos.y - 1e-9)
        wasPlanted[k] = planted
        prev[k].copy(f.pos)
      })
    }
    expect(steps).toBeGreaterThan(40) // they really do move their feet
  })

  it('keeps both ankles within reach of the hips, knees bent forward', () => {
    const s = createDuelState()
    const fw = new Footwork()
    const hip = new THREE.Vector3(), ankle = new THREE.Vector3(), knee = new THREE.Vector3(), fwd = new THREE.Vector3()
    for (let i = 0; i < 60 * 60; i++) {
      const d = duelAt(i * DT, s).b
      fw.update(d.pos, d.heading, DT, d.lift, d.stance)
      fwd.set(Math.sin(d.heading), 0, Math.cos(d.heading))
      fw.feet.forEach((f, k) => {
        const side = k === 0 ? 1 : -1
        hip.set(d.pos.x + fwd.z * LEG.hipHalf * side, d.pos.y + d.lift + LEG.hip - d.crouch, d.pos.z - fwd.x * LEG.hipHalf * side)
        ankle.copy(f.pos)
        ankle.y += LEG.ankle
        // a lunge or the spin may stretch a leg a few centimetres past straight; never more
        expect(hip.distanceTo(ankle)).toBeLessThan(LEG.thigh + LEG.shin + 0.1)
        kneeOf(hip, ankle, fwd, knee)
        expect(knee.distanceTo(hip)).toBeCloseTo(LEG.thigh, 3)
        // the knee sits ahead of the straight hip-to-ankle line (a trailing leg's knee is still behind the hip)
        expect(knee.clone().sub(hip.clone().add(ankle).multiplyScalar(0.5)).dot(fwd)).toBeGreaterThan(-0.02)
      })
    }
  })

  it('places the feet apart in a fighting stance when standing still', () => {
    const fw = new Footwork()
    const pos = new THREE.Vector3(3, 0.4, -2)
    for (let i = 0; i < 30; i++) fw.update(pos, 0.7, DT)
    const [l, r] = fw.feet
    expect(l.pos.distanceTo(r.pos)).toBeCloseTo(2 * Math.hypot(STEP.side, STEP.lead), 5)
    expect(l.pos.y).toBe(0.4)
  })
})

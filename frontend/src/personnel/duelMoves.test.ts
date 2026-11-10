import { describe, expect, it } from 'vitest'
import { DUEL, DUEL_PAD, createDuelState, duelAt } from './duelMoves'

describe('lightsaber duel', () => {
  it('stays on the open pad, well inside its edge', () => {
    const s = createDuelState()
    for (let t = 0; t < 1800; t += 0.37) {
      duelAt(t, s)
      for (const d of [s.a, s.b]) {
        expect(Math.hypot(d.pos.x - DUEL_PAD.x, d.pos.z - DUEL_PAD.z)).toBeLessThan(DUEL_PAD.radius - 4)
        expect(d.pos.y).toBe(DUEL_PAD.y)
        expect(d.lift).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('keeps the fighters at sword range, facing each other', () => {
    const s = createDuelState()
    for (let t = 0; t < 600; t += 0.23) {
      duelAt(t, s)
      const dx = s.b.pos.x - s.a.pos.x, dz = s.b.pos.z - s.a.pos.z
      const gap = Math.hypot(dx, dz)
      expect(gap).toBeGreaterThan(1.6)
      expect(gap).toBeLessThan(2.5)
      // A looks at B and B looks at A
      expect(Math.sin(s.a.heading) * dx + Math.cos(s.a.heading) * dz).toBeCloseTo(gap, 5)
      expect(Math.sin(s.b.heading) * dx + Math.cos(s.b.heading) * dz).toBeCloseTo(-gap, 5)
    }
  })

  it('swings unit-length blades that stay above the deck', () => {
    const s = createDuelState()
    for (let t = 0; t < 120; t += 0.011) {
      duelAt(t, s)
      for (const d of [s.a, s.b]) {
        expect(d.bladeDir.length()).toBeCloseTo(1, 6)
        const tipY = d.hand.y + d.bladeDir.y * (DUEL.blade + 0.13)
        expect(tipY).toBeGreaterThan(DUEL_PAD.y + 0.5)
        expect(d.hand.y).toBeGreaterThan(DUEL_PAD.y + 0.9)
      }
    }
  })

  it('clashes once per stroke, with the blade tips close together at that instant', () => {
    const s = createDuelState()
    for (let n = 3; n < 40; n++) {
      duelAt(n / DUEL.tempo + 1e-4, s)
      expect(s.clash).toBeGreaterThan(0.95)
      const tipA = s.a.hand.clone().addScaledVector(s.a.bladeDir, DUEL.blade)
      const tipB = s.b.hand.clone().addScaledVector(s.b.bladeDir, DUEL.blade)
      expect(tipA.distanceTo(tipB)).toBeLessThan(1.2) // the blades cross between the fighters
      duelAt((n + 0.6) / DUEL.tempo, s)
      expect(s.clash).toBeLessThan(0.02)
    }
  })

  it('lets each side press the attack at some point', () => {
    const s = createDuelState()
    let a = 0, b = 0
    for (let t = 0; t < 120; t += 0.5) { duelAt(t, s); a = Math.max(a, s.a.press); b = Math.max(b, s.b.press) }
    expect(a).toBeGreaterThan(0.5)
    expect(b).toBeGreaterThan(0.5)
  })
})

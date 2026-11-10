import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { DISARM_AT, DUEL, DUEL_PAD, PHASES, RECALL_TO, ROUND_LENGTH, START, createDuelState, duelAt } from './duelMoves'

const DT = 1 / 60

describe('lightsaber duel', () => {
  it('plays every phase of a round in order, then starts another round', () => {
    const s = createDuelState()
    const seen: string[] = []
    for (let t = 0; t < ROUND_LENGTH * 2; t += 0.1) {
      duelAt(t, s)
      if (seen[seen.length - 1] !== s.phase) seen.push(s.phase)
    }
    expect(seen).toEqual([...PHASES, ...PHASES])
    expect(duelAt(ROUND_LENGTH * 3 + 1, s).round).toBe(3)
  })

  it('stays on the open pad, well inside its edge, with nobody below the deck', () => {
    const s = createDuelState()
    for (let t = 0; t < ROUND_LENGTH * 12; t += 0.21) {
      duelAt(t, s)
      for (const d of [s.a, s.b]) {
        expect(Math.hypot(d.pos.x - DUEL_PAD.x, d.pos.z - DUEL_PAD.z)).toBeLessThan(DUEL_PAD.radius - 4)
        expect(d.pos.y).toBe(DUEL_PAD.y)
        expect(d.lift).toBeGreaterThanOrEqual(0)
        expect(d.saber.y).toBeGreaterThan(DUEL_PAD.y)
        expect(d.bladeLen).toBeGreaterThanOrEqual(0)
        expect(d.bladeLen).toBeLessThanOrEqual(1)
        expect(d.bladeDir.length()).toBeCloseTo(1, 5)
      }
    }
  })

  it('moves without teleporting, including across the end of a round', () => {
    const s = createDuelState()
    const prev = { a: new THREE.Vector3(), b: new THREE.Vector3(), ha: new THREE.Vector3(), hb: new THREE.Vector3(), sb: new THREE.Vector3() }
    let first = true
    for (let i = 0; i < 60 * ROUND_LENGTH * 2.2; i++) {
      duelAt(i * DT, s)
      if (!first) {
        expect(s.a.pos.distanceTo(prev.a)).toBeLessThan(0.12) // walking and lunging, never faster than ~7 m/s
        expect(s.b.pos.distanceTo(prev.b)).toBeLessThan(0.12)
        expect(s.a.hand.distanceTo(prev.ha)).toBeLessThan(0.3)
        expect(s.b.hand.distanceTo(prev.hb)).toBeLessThan(0.3)
        expect(s.b.saber.distanceTo(prev.sb)).toBeLessThan(0.3)
      }
      first = false
      prev.a.copy(s.a.pos); prev.b.copy(s.b.pos); prev.ha.copy(s.a.hand); prev.hb.copy(s.b.hand); prev.sb.copy(s.b.saber)
    }
  })

  it('opens with a face-off at a distance: blades off, then the master ignites first', () => {
    const s = createDuelState()
    duelAt(0.3, s)
    expect(s.gap).toBeGreaterThan(6)
    expect(s.a.bladeLen).toBe(0)
    expect(s.b.bladeLen).toBe(0)
    duelAt(1.6, s)
    expect(s.a.bladeLen).toBe(1)
    expect(s.b.bladeLen).toBe(0)
    duelAt(START.circle, s)
    expect(s.b.bladeLen).toBe(1)
  })

  it('has the apprentice drive the master back first, then the master take the initiative', () => {
    const s = createDuelState()
    const mid = new THREE.Vector3()
    const along = (t: number) => {
      duelAt(t, s)
      mid.copy(s.a.pos).add(s.b.pos).multiplyScalar(0.5)
      // direction from the master to the apprentice
      const dx = s.b.pos.x - s.a.pos.x, dz = s.b.pos.z - s.a.pos.z, n = Math.hypot(dx, dz)
      return { x: mid.x, z: mid.z, ux: dx / n, uz: dz / n }
    }
    duelAt(START.attackA + 4, s)
    expect(s.b.press).toBeGreaterThan(0.9)
    expect(s.a.press).toBe(0)
    duelAt(START.attackB + 4, s)
    expect(s.a.press).toBeGreaterThan(0.9)
    expect(s.b.press).toBe(0)
    // deep fighting stances while they exchange blows
    expect(s.a.stance).toBeGreaterThan(2)
    expect(s.a.crouch).toBeGreaterThan(0.1)
    // the master ends the first exchange behind where he started it
    const p0 = along(START.attackA), p1 = along(START.lock)
    expect((p1.x - p0.x) * p1.ux + (p1.z - p0.z) * p1.uz).toBeLessThan(-1)
  })

  it('locks blades face to face, with sparks, then breaks apart', () => {
    const s = createDuelState()
    duelAt(START.lock + 1.5, s)
    expect(s.phase).toBe('lock')
    expect(s.gap).toBeLessThan(1.4)
    expect(s.clash).toBeGreaterThan(0.25)
    // the two blades cross: their midpoints are close together
    const ma = s.a.saber.clone().addScaledVector(s.a.bladeDir, 0.6)
    const mb = s.b.saber.clone().addScaledVector(s.b.bladeDir, 0.6)
    expect(ma.distanceTo(mb)).toBeLessThan(0.7)
    duelAt(START.attackB, s)
    expect(s.gap).toBeGreaterThan(4)
  })

  it('gives the apprentice a full spin and a leap in the second exchange', () => {
    const s = createDuelState()
    let top = 0
    let turned = 0
    let last = duelAt(START.attackB, s).b.heading
    for (let t = START.attackB; t < START.disarm; t += DT) {
      duelAt(t, s)
      top = Math.max(top, s.b.lift)
      turned += Math.abs(s.b.heading - last)
      last = s.b.heading
    }
    expect(top).toBeGreaterThan(0.9)
    expect(turned).toBeGreaterThan(Math.PI * 2)
  })

  it('disarms the apprentice: his saber flies off, goes dark and lands on the deck', () => {
    const s = createDuelState()
    duelAt(DISARM_AT - 0.05, s)
    expect(s.b.armed).toBe(true)
    expect(s.b.bladeLen).toBe(1)
    duelAt(DISARM_AT + 0.02, s)
    expect(s.b.armed).toBe(false)
    expect(s.clash).toBeGreaterThan(0.8)
    duelAt(START.yield + 3, s)
    expect(s.phase).toBe('yield')
    expect(s.b.armed).toBe(false)
    expect(s.b.bladeLen).toBe(0)
    expect(s.b.saber.y).toBeLessThan(DUEL_PAD.y + 0.1) // lying on the deck
    expect(s.b.saber.distanceTo(s.b.hand)).toBeGreaterThan(2)
    // the master holds his blade levelled at the beaten man
    expect(s.a.bladeLen).toBe(1)
    const toB = s.b.pos.clone().sub(s.a.pos).setY(0).normalize()
    expect(s.a.bladeDir.dot(toB)).toBeGreaterThan(0.95)
  })

  it('returns the saber to its owner before the next round', () => {
    const s = createDuelState()
    duelAt(RECALL_TO + 0.01, s)
    expect(s.b.armed).toBe(true)
    expect(s.b.saber.distanceTo(s.b.hand)).toBeLessThan(1e-6)
    duelAt(ROUND_LENGTH - 0.01, s)
    expect(s.a.bladeLen).toBe(0) // both switched off, walking back to their marks
    expect(s.gap).toBeGreaterThan(6.9)
  })

  it('swings blades that never dip into the deck while lit', () => {
    const s = createDuelState()
    for (let t = 0; t < ROUND_LENGTH; t += 0.013) {
      duelAt(t, s)
      for (const d of [s.a, s.b]) {
        if (!d.armed || d.bladeLen < 0.5) continue
        expect(d.saber.y + d.bladeDir.y * (DUEL.blade + 0.13)).toBeGreaterThan(DUEL_PAD.y + 0.15)
      }
    }
  })
})

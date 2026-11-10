import { describe, expect, it } from 'vitest'
import { obstacleBoxes, terrainHeight } from '../world/layout'
import { BARGE, GUNSHIP, GUNSHIP_APPROACH, GUNSHIP_DEPART, GunshipSim, bargeAt } from './visitors'
import { DESTROYER, DestroyerSim } from './destroyer'

describe('visiting gunship', () => {
  const T = GUNSHIP.timing
  it('arrives soon after start-up, lands on its stand, waits, and leaves again', () => {
    const g = new GunshipSim()
    expect(g.update(1).visible).toBe(false)
    let t = GUNSHIP.firstArrival + T.approach / 2
    expect(g.update(t).phase).toBe('approach')
    t = GUNSHIP.firstArrival + T.approach + T.landing + 5
    expect(g.update(t).phase).toBe('landed')
    expect(g.state.gear).toBe(1)
    expect(g.state.pos.y).toBeCloseTo(GUNSHIP.stand.y + GUNSHIP.rest, 5)
    expect(Math.hypot(g.state.pos.x - GUNSHIP.stand.x, g.state.pos.z - GUNSHIP.stand.z)).toBeLessThan(1e-6)
    t += T.landed + T.liftoff + T.depart / 2
    expect(g.update(t).phase).toBe('depart')
    expect(g.state.gear).toBe(0)
    t += T.depart
    expect(g.update(t).visible).toBe(false)
    t += T.away
    expect(g.update(t).phase).toBe('approach') // and round again
  })

  it('moves continuously with no jump between phases', () => {
    const g = new GunshipSim()
    const total = T.approach + T.landing + T.landed + T.liftoff + T.depart
    const prev = g.update(GUNSHIP.firstArrival + 0.01).pos.clone()
    for (let t = GUNSHIP.firstArrival + 0.05; t < GUNSHIP.firstArrival + total - 0.1; t += 0.05) {
      const s = g.update(t)
      expect(s.visible).toBe(true)
      expect(Number.isFinite(s.pos.x + s.pos.y + s.pos.z + s.quat.w)).toBe(true)
      expect(s.pos.distanceTo(prev)).toBeLessThan(40)
      prev.copy(s.pos)
    }
  })

  it('stands inside the wall, clear of buildings, and flies clear of everything', () => {
    const boxes = obstacleBoxes()
    expect(Math.hypot(GUNSHIP.stand.x, GUNSHIP.stand.z)).toBeLessThan(410)
    const span = 14
    for (const b of boxes) {
      const hit = GUNSHIP.stand.x > b.min[0] - span && GUNSHIP.stand.x < b.max[0] + span && GUNSHIP.stand.z > b.min[2] - span && GUNSHIP.stand.z < b.max[2] + span
      expect(hit).toBe(false)
    }
    for (const path of [GUNSHIP_APPROACH, GUNSHIP_DEPART]) {
      for (let i = 0; i <= 2000; i++) {
        const p = path.point(i / 2000)
        expect(p.y - terrainHeight(p.x, p.z)).toBeGreaterThan(25)
        for (const b of boxes) {
          if (p.x > b.min[0] - span && p.x < b.max[0] + span && p.z > b.min[2] - span && p.z < b.max[2] + span) expect(p.y).toBeGreaterThan(b.max[1] + 8)
        }
      }
    }
  })
})

describe('sail barge', () => {
  it('drifts over the dunes without ever touching them, outside the walker lane', () => {
    expect(BARGE.radius).toBeGreaterThan(600)
    const prev = bargeAt(0)
    let last = { ...prev }
    for (let t = 0.5; t < 1200; t += 0.5) {
      const b = bargeAt(t)
      // keel clear of the ground under bow, midships and stern
      for (const k of [-1, 0, 1]) {
        const x = b.x + Math.sin(b.heading) * k * BARGE.length / 2, z = b.z + Math.cos(b.heading) * k * BARGE.length / 2
        expect(b.y - terrainHeight(x, z)).toBeGreaterThan(2)
      }
      expect(Math.hypot(b.x - last.x, b.z - last.z)).toBeCloseTo(BARGE.speed * 0.5, 1)
      expect(Math.abs(b.y - last.y)).toBeLessThan(1.5) // no lurching
      last = { ...b }
    }
  })

  it('faces the way it is going', () => {
    // heading at the middle of a one-second step matches the direction of that step
    const a = bargeAt(40), b = bargeAt(41), mid = bargeAt(40.5)
    const dx = b.x - a.x, dz = b.z - a.z, n = Math.hypot(dx, dz)
    expect(Math.sin(mid.heading)).toBeCloseTo(dx / n, 3)
    expect(Math.cos(mid.heading)).toBeCloseTo(dz / n, 3)
  })
})

describe('star destroyer', () => {
  const T = DESTROYER.timing
  it('drops out of hyperspace, holds station, then jumps away, again and again', () => {
    const d = new DestroyerSim()
    expect(d.update(1).visible).toBe(false)
    const t0 = DESTROYER.firstArrival
    let s = d.update(t0 + 0.02)
    expect(s.phase).toBe('arrive')
    expect(s.visible).toBe(true)
    expect(s.stretch).toBeGreaterThan(8) // a streak of light at first
    const far = s.pos.distanceTo(DESTROYER.station)
    expect(far).toBeGreaterThan(8000)
    s = d.update(t0 + T.arrive + 10)
    expect(s.phase).toBe('station')
    expect(s.stretch).toBe(1)
    expect(s.pos.distanceTo(DESTROYER.station)).toBeLessThan(200) // creeping forward on station
    s = d.update(t0 + T.arrive + T.station + T.jump * 0.9)
    expect(s.phase).toBe('jump')
    expect(s.stretch).toBeGreaterThan(5)
    s = d.update(t0 + T.arrive + T.station + T.jump + 1)
    expect(s.visible).toBe(false)
    s = d.update(t0 + T.arrive + T.station + T.jump + T.away + 0.5)
    expect(s.phase).toBe('arrive')
    expect(d.arrivals).toBe(2)
  })

  it('decelerates hard and smoothly: no backward step, flash only at the moment of arrival', () => {
    const d = new DestroyerSim()
    const t0 = DESTROYER.firstArrival
    let prev = Infinity
    for (let t = t0 + 0.01; t < t0 + T.arrive; t += 0.02) {
      const s = d.update(t)
      const dist = s.pos.distanceTo(DESTROYER.station)
      expect(dist).toBeLessThanOrEqual(prev + 1e-6)
      prev = dist
    }
    expect(d.update(t0 + 0.05).flash).toBeGreaterThan(0.5)
    expect(d.update(t0 + T.arrive + 5).flash).toBe(0)
    // it hangs high above the mountains and far enough away to be seen whole
    expect(DESTROYER.station.y).toBeGreaterThan(3000)
    expect(Math.hypot(DESTROYER.station.x, DESTROYER.station.z)).toBeGreaterThan(4000)
  })
})

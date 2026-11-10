import { describe, expect, it } from 'vitest'
import { obstacleBoxes } from '../world/layout'
import { MARCH, MARCH_LENGTH, MarchSim, TROOPERS, createMarchState, marchAt, plazaHeight, toWorld } from './marchPlan'

describe('march on the temple', () => {
  it('starts with only the leader in view and ends with everyone inside', () => {
    const s = createMarchState()
    marchAt(0.01, s)
    expect(s.leader.visible).toBe(true)
    expect(s.troopers.some((m) => m.visible)).toBe(false)
    expect(s.done).toBe(false)
    marchAt(MARCH_LENGTH / 2, s)
    expect(s.inView).toBeGreaterThan(TROOPERS / 2)
    marchAt(MARCH_LENGTH, s)
    expect(s.inView).toBe(0)
    expect(s.done).toBe(true)
  })

  it('keeps the column in formation: straight files, even ranks, the leader out in front', () => {
    const s = marchAt(30)
    const first = s.troopers[0]
    expect(s.leader.z).toBeCloseTo(first.z - MARCH.lead, 6)
    for (let r = 0; r < MARCH.ranks; r++) {
      for (let f = 0; f < MARCH.files; f++) {
        const m = s.troopers[r * MARCH.files + f]
        expect(m.z).toBeCloseTo(first.z + r * MARCH.rankGap, 6)
        expect(m.x).toBeCloseTo((f - 1.5) * MARCH.fileGap, 6)
        expect(m.phase).toBe(first.phase) // all in step
      }
    }
  })

  it('walks at a steady pace down the open plaza, never through a building', () => {
    const boxes = obstacleBoxes() // the temple itself included: they vanish at its door, just outside the wall
    const s = createMarchState()
    let prev = marchAt(1, s).leader.z
    for (let t = 1.1; t < MARCH_LENGTH; t += 0.1) {
      marchAt(t, s)
      expect(prev - s.leader.z).toBeCloseTo(MARCH.speed * 0.1, 6)
      prev = s.leader.z
      for (const m of [s.leader, ...s.troopers]) {
        if (!m.visible) continue
        const [wx, wz] = toWorld(m.x, m.z)
        for (const b of boxes) expect(wx > b.min[0] && wx < b.max[0] && wz > b.min[2] && wz < b.max[2]).toBe(false)
      }
    }
  })

  it('climbs the three steps and vanishes at the doorway', () => {
    expect(plazaHeight(40)).toBe(0)
    expect(plazaHeight(15)).toBeCloseTo(0.22)
    expect(plazaHeight(12)).toBeCloseTo(0.44)
    expect(plazaHeight(6)).toBeCloseTo(0.66)
    const tDoor = (MARCH.startZ - MARCH.doorZ) / MARCH.speed
    expect(marchAt(tDoor - 0.2).leader.visible).toBe(true)
    expect(marchAt(tDoor - 0.2).leader.y).toBeCloseTo(0.66)
    expect(marchAt(tDoor + 0.2).leader.visible).toBe(false)
  })

  it('lights the blade at the foot of the steps and not before', () => {
    const tSteps = (MARCH.startZ - MARCH.igniteZ) / MARCH.speed
    expect(marchAt(tSteps - 1).blade).toBe(0)
    expect(marchAt(tSteps + 2).blade).toBe(1)
  })

  it('is laid out in front of the temple door, heading into it', () => {
    const [dx, dz] = toWorld(0, 0)
    const [sx, sz] = toWorld(0, MARCH.startZ)
    expect(dx).toBeCloseTo(-209, 6)
    expect(dz).toBeCloseTo(-240, 6)
    expect(sx).toBeGreaterThan(dx + 80) // they come from the east
    expect(sz).toBeCloseTo(dz, 6)
  })

  it('runs on a timer and on command, one march at a time', () => {
    const m = new MarchSim()
    m.update(MARCH.first - 1)
    expect(m.t0).toBeNull()
    m.update(MARCH.first + 0.1)
    expect(m.t0).not.toBeNull()
    expect(m.start(MARCH.first + 5)).toBe(false) // already marching
    m.update(MARCH.first + MARCH_LENGTH + 1)
    expect(m.t0).toBeNull()
    expect(m.start(MARCH.first + MARCH_LENGTH + 2)).toBe(true)
    expect(m.count).toBe(2)
  })
})

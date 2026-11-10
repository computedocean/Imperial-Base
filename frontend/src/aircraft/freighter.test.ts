import { describe, expect, it } from 'vitest'
import { obstacleBoxes, terrainHeight } from '../world/layout'
import { FREIGHTER_ESCAPE, FREIGHTER_PAD, FREIGHTER_REST, FREIGHTER_RETURN, FREIGHTER_TIMING as T, FreighterSim } from './freighter'

describe('impounded freighter', () => {
  it('sits on its pad until it escapes, then runs, vanishes, returns and lands again', () => {
    const f = new FreighterSim()
    f.autoCycle = false
    expect(f.update(500).phase).toBe('impounded')
    expect(f.state.pos.y).toBeCloseTo(FREIGHTER_PAD.y + FREIGHTER_REST, 5)
    expect(f.escape(500)).toBe(true)
    expect(f.escape(501)).toBe(false) // already running
    let t = 500 + T.liftoff / 2
    expect(f.update(t).phase).toBe('liftoff')
    t = 500 + T.liftoff + T.escape / 2
    expect(f.update(t).phase).toBe('escape')
    expect(f.state.gear).toBe(0)
    expect(f.escaping).toBe(true)
    t = 500 + T.liftoff + T.escape + 1
    expect(f.update(t).visible).toBe(false)
    t += T.away + T.return / 2
    expect(f.update(t).phase).toBe('return')
    t += T.return / 2 + T.landing + 1
    expect(f.update(t).phase).toBe('impounded')
    expect(f.state.gear).toBe(1)
    expect(f.progress).toBe(0)
    expect(Math.hypot(f.state.pos.x - FREIGHTER_PAD.x, f.state.pos.z - FREIGHTER_PAD.z)).toBeLessThan(1e-6)
  })

  it('escapes on its own when left alone', () => {
    const f = new FreighterSim()
    expect(f.update(T.autoAfter - 1).phase).toBe('impounded')
    expect(f.update(T.autoAfter + 1).phase).toBe('liftoff')
  })

  it('moves continuously: no jump between phases and no NaNs', () => {
    const f = new FreighterSim()
    f.autoCycle = false
    f.escape(0)
    const prev = f.update(0).pos.clone()
    const total = T.liftoff + T.escape + T.away + T.return + T.landing + 2
    let wasVisible = true
    for (let t = 0.05; t < total; t += 0.05) {
      const s = f.update(t)
      expect(Number.isFinite(s.pos.x + s.pos.y + s.pos.z + s.quat.x + s.quat.w)).toBe(true)
      if (s.visible && wasVisible) expect(s.pos.distanceTo(prev)).toBeLessThan(40) // under 800 m/s
      wasVisible = s.visible
      prev.copy(s.pos)
    }
  })

  it('both flight paths clear the terrain and every building', () => {
    const boxes = obstacleBoxes()
    const span = 16 // half the width of the ship
    for (const path of [FREIGHTER_ESCAPE, FREIGHTER_RETURN]) {
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

import { describe, expect, it } from 'vitest'
import { obstacleBoxes, terrainHeight } from '../world/layout'
import { BOARDING, FREIGHTER_ESCAPE, FREIGHTER_PAD, FREIGHTER_REST, FREIGHTER_RETURN, FREIGHTER_TIMING as T, FreighterSim, runnersAt } from './freighter'

describe('impounded freighter', () => {
  it('waits for its crew, then lifts off, runs, vanishes, returns and lands again', () => {
    const f = new FreighterSim()
    f.autoCycle = false
    expect(f.update(500).phase).toBe('impounded')
    expect(f.state.pos.y).toBeCloseTo(FREIGHTER_PAD.y + FREIGHTER_REST, 5)
    expect(f.escape(500)).toBe(true)
    expect(f.escape(501)).toBe(false) // already under way
    let t = 500 + T.boarding / 2
    expect(f.update(t).phase).toBe('boarding')
    expect(f.state.pos.y).toBeCloseTo(FREIGHTER_PAD.y + FREIGHTER_REST, 5) // still on the pad
    expect(f.state.gear).toBe(1)
    expect(f.escaping).toBe(false)
    const b = 500 + T.boarding
    t = b + T.liftoff / 2
    expect(f.update(t).phase).toBe('liftoff')
    t = b + T.liftoff + T.escape / 2
    expect(f.update(t).phase).toBe('escape')
    expect(f.state.gear).toBe(0)
    expect(f.escaping).toBe(true)
    t = b + T.liftoff + T.escape + 1
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
    expect(f.update(T.autoAfter + 1).phase).toBe('boarding')
    expect(f.update(T.autoAfter + T.boarding + 1).phase).toBe('liftoff')
  })

  it('moves continuously: no jump between phases and no NaNs', () => {
    const f = new FreighterSim()
    f.autoCycle = false
    f.escape(0)
    const prev = f.update(0).pos.clone()
    const total = T.boarding + T.liftoff + T.escape + T.away + T.return + T.landing + 2
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

describe('the crew runs for the ship', () => {
  const yaw = Math.PI / 2
  it('starts well away from the ship and is aboard before it lifts off', () => {
    const [a, b] = runnersAt(0.01, yaw)
    expect(a.visible).toBe(true)
    expect(b.visible).toBe(false) // the second sets off a moment later
    expect(Math.hypot(a.x - FREIGHTER_PAD.x, a.z - FREIGHTER_PAD.z)).toBeGreaterThan(40)
    const end = runnersAt(T.boarding - 0.01, yaw)
    expect(end[0].visible).toBe(false)
    expect(end[1].visible).toBe(false)
    expect(BOARDING.run / BOARDING.speed + BOARDING.stagger + BOARDING.climb).toBeLessThan(T.boarding)
  })

  it('runs straight at the ramp at a sprint, without teleporting, and never through a building', () => {
    const boxes = obstacleBoxes()
    const prev = runnersAt(0.5, yaw).map((r) => ({ ...r }))
    for (let t = 0.52; t < T.boarding; t += 0.02) {
      const now = runnersAt(t, yaw)
      now.forEach((r, i) => {
        if (r.visible && prev[i].visible) {
          const d = Math.hypot(r.x - prev[i].x, r.z - prev[i].z)
          expect(d).toBeLessThan(BOARDING.speed * 0.02 * 1.5 + 0.02)
          expect(r.y).toBeGreaterThanOrEqual(FREIGHTER_PAD.y)
          for (const b of boxes) expect(r.x > b.min[0] && r.x < b.max[0] && r.z > b.min[2] && r.z < b.max[2]).toBe(false)
        }
        prev[i] = { ...r }
      })
    }
  })

  it('has them side by side on the pad, the second a little behind', () => {
    const [a, b] = runnersAt(4, yaw)
    const gap = Math.hypot(a.x - b.x, a.z - b.z)
    expect(gap).toBeGreaterThan(1)
    expect(gap).toBeLessThan(5)
    const da = Math.hypot(a.x - FREIGHTER_PAD.x, a.z - FREIGHTER_PAD.z)
    const db = Math.hypot(b.x - FREIGHTER_PAD.x, b.z - FREIGHTER_PAD.z)
    expect(da).toBeLessThan(db)
  })
})

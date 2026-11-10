import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { obstacleBoxes, terrainHeight } from '../world/layout'
import {
  FlightPath, MAIN_PAD, PATROL_ROUTES, PatrolSim, SHUTTLE_APPROACH, SHUTTLE_CLIMB, SHUTTLE_TIMING, ShuttleSim,
  FUEL_DUMP, XWING_KILL, XWING_PATH, XWING_STRAFE, XWING_TIMING, XWING_WING, XWingSim, orient,
} from './flight'

const boxes = obstacleBoxes()
const MARGIN = 12

function insideBuilding(p: THREE.Vector3, ignore: string[] = []) {
  return boxes.find((b) => !ignore.includes(b.id) &&
    p.x > b.min[0] - MARGIN && p.x < b.max[0] + MARGIN && p.z > b.min[2] - MARGIN && p.z < b.max[2] + MARGIN && p.y < b.max[1] + MARGIN)
}

function minClearance(path: FlightPath, from = 0, to = 1, n = 2000) {
  let min = Infinity
  const p = new THREE.Vector3()
  for (let i = 0; i <= n; i++) {
    path.point(from + ((to - from) * i) / n, p)
    min = Math.min(min, p.y - terrainHeight(p.x, p.z))
  }
  return min
}

function assertNoBuildingHits(path: FlightPath, ignore: string[] = [], n = 2000) {
  const p = new THREE.Vector3()
  for (let i = 0; i <= n; i++) {
    path.point(i / n, p)
    const hit = insideBuilding(p, ignore)
    if (hit) throw new Error(`path enters ${hit.id} at ${p.toArray().map((v) => v.toFixed(0))}`)
  }
}

describe('flight paths clear terrain and buildings', () => {
  it('shuttle approach stays above terrain and outside buildings', () => {
    expect(minClearance(SHUTTLE_APPROACH, 0, 1)).toBeGreaterThan(40)
    assertNoBuildingHits(SHUTTLE_APPROACH)
  })
  it('shuttle climb-out stays above terrain and outside buildings', () => {
    expect(minClearance(SHUTTLE_CLIMB)).toBeGreaterThan(40)
    assertNoBuildingHits(SHUTTLE_CLIMB)
  })
  it('patrol routes keep >= 80 m terrain clearance and avoid all structures', () => {
    for (const r of Object.values(PATROL_ROUTES)) {
      expect(minClearance(r)).toBeGreaterThan(80)
      assertNoBuildingHits(r)
    }
  })
  it('x-wing flyby keeps >= 45 m terrain clearance, even on its strafing dive', () => {
    expect(minClearance(XWING_PATH)).toBeGreaterThan(45)
    assertNoBuildingHits(XWING_PATH)
  })
})

describe('shuttle landing sequence', () => {
  it('runs approach -> descent -> landed -> liftoff -> climbout -> away', () => {
    const sim = new ShuttleSim()
    sim.autoCycle = false
    expect(sim.update(0).visible).toBe(false)
    expect(sim.depart(0)).toBe(false) // cannot depart while away
    expect(sim.arrive(0)).toBe(true)
    let t = 0
    const step = (secs: number) => { for (let i = 0; i < secs * 30; i++) { t += 1 / 30; sim.update(t) } return sim.state }
    let s = step(SHUTTLE_TIMING.approach / 2)
    expect(s.phase).toBe('approach')
    expect(s.wingFold).toBe(0)
    s = step(SHUTTLE_TIMING.approach / 2 + 0.5)
    expect(s.phase).toBe('descent')
    s = step(SHUTTLE_TIMING.descent + 8)
    expect(s.phase).toBe('landed')
    expect(s.pos.y).toBeCloseTo(MAIN_PAD.y, 5)
    expect(s.gear).toBe(1)
    expect(s.wingFold).toBe(1)
    expect(s.ramp).toBeGreaterThan(0.99)
    expect(sim.arrive(t)).toBe(false)
    expect(sim.depart(t)).toBe(true)
    s = step(SHUTTLE_TIMING.liftoff + 0.5)
    expect(s.phase).toBe('climbout')
    expect(s.gear).toBe(0)
    expect(s.ramp).toBe(0)
    s = step(SHUTTLE_TIMING.climbout + 0.5)
    expect(s.phase).toBe('away')
    expect(s.visible).toBe(false)
  })
  it('approach ends exactly over the pad (no position jump into descent)', () => {
    const sim = new ShuttleSim()
    sim.arrive(0)
    const a = sim.update(SHUTTLE_TIMING.approach - 1e-6).pos.clone()
    const b = sim.update(SHUTTLE_TIMING.approach + 1e-6).pos.clone()
    expect(a.distanceTo(b)).toBeLessThan(0.5)
  })
  it('descent touches down on the pad and never sinks below it', () => {
    const sim = new ShuttleSim()
    sim.arrive(0)
    for (let t = SHUTTLE_TIMING.approach; t < SHUTTLE_TIMING.approach + SHUTTLE_TIMING.descent; t += 0.1) {
      expect(sim.update(t).pos.y).toBeGreaterThanOrEqual(MAIN_PAD.y - 1e-6)
    }
  })
})

describe('patrols', () => {
  it('launch, patrol and recover to the hangar without NaNs', () => {
    const sim = new PatrolSim()
    sim.start()
    for (let i = 0; i < 30 * 120; i++) sim.update(1 / 30)
    expect(sim.fighters.every((f) => f.state === 'patrol')).toBe(true)
    for (const f of sim.fighters) expect(Number.isFinite(f.pose.pos.x + f.pose.pos.y + f.pose.pos.z)).toBe(true)
    sim.stop()
    for (let i = 0; i < 30 * 180; i++) sim.update(1 / 30)
    expect(sim.fighters.every((f) => f.state === 'parked')).toBe(true)
  })
  it('formation followers keep separation from the leader', () => {
    const sim = new PatrolSim()
    sim.start(true)
    for (let i = 0; i < 30 * 20; i++) sim.update(1 / 30)
    const [a, b, c] = sim.fighters
    expect(a.pose.pos.distanceTo(b.pose.pos)).toBeGreaterThan(10)
    expect(b.pose.pos.distanceTo(c.pose.pos)).toBeGreaterThan(10)
  })
})

describe('x-wing flyby', () => {
  it('appears, opens s-foils mid-flight and leaves', () => {
    const sim = new XWingSim()
    sim.trigger(0, true)
    expect(sim.update(10).visible).toBe(true)
    expect(sim.update(20).sFoil).toBeGreaterThan(0.9)
    sim.update(80)
    expect(sim.active).toBe(false)
  })
})

describe('orientation', () => {
  it('orient() points a +Z-nosed model along the forward vector', () => {
    const q = orient(new THREE.Vector3(1, 0, 0), 0)
    const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(q)
    expect(nose.x).toBeCloseTo(1, 5)
  })
})

describe('x-wing shoots down the picket fighter', () => {
  const D = XWING_TIMING.duration
  it('the picket closes head-on, is fired on, and is destroyed exactly once', () => {
    const sim = new XWingSim()
    sim.trigger(100, false)
    let prev = Infinity
    for (let k = XWING_KILL.appear + 0.01; k < XWING_KILL.hit - 0.005; k += 0.01) {
      sim.update(100 + k * D)
      expect(sim.picket.visible).toBe(true)
      const d = sim.picket.pos.distanceTo(sim.pose.pos)
      expect(d).toBeLessThan(prev) // always closing
      prev = d
      expect(sim.firing).toBe(k >= XWING_KILL.fire)
      expect(sim.killAt).toBeNull()
    }
    expect(prev).toBeLessThan(XWING_KILL.gap + 400)
    sim.update(100 + (XWING_KILL.hit + 0.001) * D)
    expect(sim.picket.visible).toBe(false)
    expect(sim.firing).toBe(false)
    expect(sim.kills).toBe(1)
    expect(sim.killAt).toBeCloseTo(100 + XWING_KILL.hit * D, 6)
    expect(sim.killPos.distanceTo(sim.pose.pos)).toBeGreaterThan(XWING_KILL.gap * 0.5)
    expect(sim.killPos.distanceTo(sim.pose.pos)).toBeLessThan(XWING_KILL.gap * 1.6)
    sim.update(100 + 0.6 * D)
    expect(sim.kills).toBe(1)
  })
  it('a second flyby brings a second picket', () => {
    const sim = new XWingSim()
    sim.trigger(0, false)
    sim.update(D + 3) // the wingmen trail the leader out by a second or so
    expect(sim.active).toBe(false)
    expect(sim.trigger(200, false)).toBe(true)
    expect(sim.killAt).toBeNull()
    sim.update(200 + 0.5 * D)
    expect(sim.kills).toBe(2)
  })
})

describe('x-wing strafes the fuel dump', () => {
  const D = XWING_TIMING.duration
  it('dives past the dump close enough to hit it, after dealing with the picket', () => {
    expect(XWING_STRAFE.miss).toBeLessThan(220)
    expect(XWING_STRAFE.fire).toBeGreaterThan(XWING_KILL.hit + 0.02) // one fight at a time
    expect(XWING_STRAFE.fire).toBeLessThan(XWING_STRAFE.hit)
    expect(XWING_STRAFE.hit).toBeLessThan(XWING_STRAFE.closest)
    // the depot is inside the wall (apothem 434 m) and clear of every building
    const r = Math.hypot(FUEL_DUMP.x, FUEL_DUMP.z)
    expect(r + FUEL_DUMP.radius).toBeLessThan(420)
    for (const b of boxes) {
      const m = FUEL_DUMP.radius
      const inside = FUEL_DUMP.x > b.min[0] - m && FUEL_DUMP.x < b.max[0] + m && FUEL_DUMP.z > b.min[2] - m && FUEL_DUMP.z < b.max[2] + m
      expect(inside).toBe(false)
    }
  })
  it('opens fire on the way in and destroys it exactly once per pass', () => {
    const sim = new XWingSim()
    sim.trigger(50, false)
    sim.update(50 + (XWING_STRAFE.fire - 0.01) * D)
    expect(sim.strafing).toBe(false)
    sim.update(50 + (XWING_STRAFE.fire + 0.005) * D)
    expect(sim.strafing).toBe(true)
    expect(sim.strikeAt).toBeNull()
    // it is firing at something in front of it
    const toDump = XWING_STRAFE.target.clone().sub(sim.pose.pos).normalize()
    const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(sim.pose.quat)
    expect(nose.dot(toDump)).toBeGreaterThan(0.75)
    sim.update(50 + (XWING_STRAFE.hit + 0.001) * D)
    expect(sim.strikes).toBe(1)
    expect(sim.strikeAt).toBeCloseTo(50 + XWING_STRAFE.hit * D, 6)
    sim.update(50 + 0.8 * D)
    expect(sim.strikes).toBe(1)
    expect(sim.strafing).toBe(false)
    // the hit is remembered after the intruder has gone (the dump keeps burning)
    sim.update(50 + D + 30)
    expect(sim.active).toBe(false)
    expect(sim.strikeAt).not.toBeNull()
    // and the next pass hits it again
    sim.trigger(400, false)
    sim.update(400 + 0.9 * D)
    expect(sim.strikes).toBe(2)
  })
})

describe('x-wing flight of three', () => {
  it('two wingmen follow the leader in formation, never on top of each other', () => {
    const sim = new XWingSim()
    sim.trigger(0, false)
    const D = XWING_TIMING.duration
    for (let k = 0.1; k < 0.95; k += 0.03) {
      sim.update(k * D)
      const [a, b] = sim.wingmen
      expect(a.visible && b.visible).toBe(true)
      for (const w of sim.wingmen) {
        const d = w.pos.distanceTo(sim.pose.pos)
        expect(d).toBeGreaterThan(XWING_WING.spread * 0.8)
        expect(d).toBeLessThan(400)
        expect(w.pos.y - terrainHeight(w.pos.x, w.pos.z)).toBeGreaterThan(40)
      }
      expect(a.pos.distanceTo(b.pos)).toBeGreaterThan(XWING_WING.spread)
    }
    sim.update(D + 5)
    expect(sim.active).toBe(false)
    expect(sim.wingmen.some((w) => w.visible)).toBe(false)
  })
})

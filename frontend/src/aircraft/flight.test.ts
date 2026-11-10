import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { obstacleBoxes, terrainHeight } from '../world/layout'
import {
  FlightPath, MAIN_PAD, PATROL_ROUTES, PatrolSim, SHUTTLE_APPROACH, SHUTTLE_CLIMB, SHUTTLE_TIMING, ShuttleSim,
  XWING_KILL, XWING_PATH, XWING_TIMING, XWingSim, orient,
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
  it('x-wing flyby keeps >= 100 m terrain clearance', () => {
    expect(minClearance(XWING_PATH)).toBeGreaterThan(100)
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
    expect(sim.update(24).sFoil).toBeGreaterThan(0.9)
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
    sim.update(D + 1)
    expect(sim.active).toBe(false)
    expect(sim.trigger(200, false)).toBe(true)
    expect(sim.killAt).toBeNull()
    sim.update(200 + 0.5 * D)
    expect(sim.kills).toBe(2)
  })
})

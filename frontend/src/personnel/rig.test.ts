import { describe, expect, it } from 'vitest'
import { Matrix4, Vector3 } from 'three'
import {
  BODY,
  CHARACTER_HEIGHT,
  PART,
  PART_COUNT,
  computePose,
  createPose,
  gaitCadence,
  poseToMatrices,
  rootMatrix,
  strideLength,
  type Action,
} from './rig'
import { createCrowdSim, distanceToNavGraph, shortestPath } from './sim'
import { NAV_NODES, PERIMETER_RADIUS, WALL_HEIGHT } from '../world/layout'

const ACTIONS: Action[] = ['walk', 'idle', 'work', 'guard', 'salute', 'inspect', 'talk']
const rx = (p: ReturnType<typeof createPose>, part: number) => p.rot[part * 3]

function worldOf(pose: ReturnType<typeof createPose>) {
  const mats = Array.from({ length: PART_COUNT }, () => new Matrix4())
  poseToMatrices(pose, rootMatrix(0, 0, 0, 0, new Matrix4()), mats)
  return mats
}
/** world position of the bottom of the boot under a shin */
function soleY(mats: Matrix4[], shin: number) {
  return new Vector3(0, -(BODY.shin + BODY.sole), 0).applyMatrix4(mats[shin]).y
}

describe('rig', () => {
  it('is an adult-sized human', () => {
    expect(CHARACTER_HEIGHT).toBeGreaterThan(1.7)
    expect(CHARACTER_HEIGHT).toBeLessThan(1.9)
  })

  it('computePose is deterministic', () => {
    for (const a of ACTIONS) {
      for (const ph of [0, 0.37, 12.5, 333.3]) {
        const p1 = computePose(a, ph, 1.4, createPose(), { seed: 0.3, stride: 1.05, carry: a === 'guard' })
        const p2 = computePose(a, ph, 1.4, createPose(), { seed: 0.3, stride: 1.05, carry: a === 'guard' })
        expect(Array.from(p1.rot)).toEqual(Array.from(p2.rot))
        expect(Array.from(p1.pos)).toEqual(Array.from(p2.pos))
      }
    }
  })

  it('produces finite values for every action', () => {
    const p = createPose()
    for (const a of ACTIONS) {
      for (let ph = 0; ph < 60; ph += 0.173) {
        for (const carry of [false, true]) {
          computePose(a, ph, a === 'walk' ? 1.5 : 0, p, { seed: (ph * 7.3) % 1, carry })
          for (const v of p.rot) expect(Number.isFinite(v)).toBe(true)
          for (const v of p.pos) expect(Number.isFinite(v)).toBe(true)
        }
      }
    }
  })

  it('gait: left and right legs are half a cycle apart', () => {
    const a = createPose()
    const b = createPose()
    for (let ph = 0; ph < 2; ph += 0.0625) {
      computePose('walk', ph, 1.4, a)
      computePose('walk', ph + 0.5, 1.4, b)
      expect(rx(a, PART.thighL)).toBeCloseTo(rx(b, PART.thighR), 5)
      expect(rx(a, PART.shinL)).toBeCloseTo(rx(b, PART.shinR), 5)
      expect(rx(a, PART.upperArmL)).toBeCloseTo(rx(b, PART.upperArmR), 5)
      // legs swing opposite (equal and opposite around the common lean offset)
      const mid = (rx(a, PART.thighL) + rx(a, PART.thighR)) / 2
      expect(rx(a, PART.thighL) - mid).toBeCloseTo(-(rx(a, PART.thighR) - mid), 5)
    }
  })

  it('arms swing opposite to the legs', () => {
    const p = computePose('walk', 0.25, 1.4, createPose()) // left leg fully forward
    expect(rx(p, PART.thighL)).toBeLessThan(-0.2)
    expect(rx(p, PART.upperArmL)).toBeGreaterThan(0.1) // left arm back
    expect(rx(p, PART.upperArmR)).toBeLessThan(-0.1) // right arm forward
  })

  it('faster walking = longer strides and higher cadence', () => {
    expect(strideLength(1.8)).toBeGreaterThan(strideLength(1.0))
    expect(gaitCadence(1.8)).toBeGreaterThan(gaitCadence(1.0))
    expect(gaitCadence(1.4)).toBeGreaterThan(0.75)
    expect(gaitCadence(1.4)).toBeLessThan(1.1)
  })

  it('keeps a foot on the ground', () => {
    const p = createPose()
    for (const a of ACTIONS) {
      for (let ph = 0; ph < 30; ph += 0.41) {
        computePose(a, ph, 1.4, p, { seed: 0.6 })
        const m = worldOf(p)
        const low = Math.min(soleY(m, PART.shinL), soleY(m, PART.shinR))
        // inspect kneels on a shin, so its lowest point is the knee/shin: allow a little slack
        expect(low).toBeGreaterThan(-0.06)
        expect(low).toBeLessThan(a === 'inspect' ? 0.2 : 0.05)
      }
    }
  })

  it('characters with different phase offsets do not move identically', () => {
    const a = computePose('idle', 10, 0, createPose(), { seed: 0.1 })
    const b = computePose('idle', 10, 0, createPose(), { seed: 0.8 })
    expect(Array.from(a.rot)).not.toEqual(Array.from(b.rot))
  })
})

describe('sim', () => {
  it('finds paths on the walk graph', () => {
    const ids = Object.keys(NAV_NODES)
    const path = shortestPath(ids.indexOf('gateE'), ids.indexOf('quartersDoor'))
    expect(path.length).toBeGreaterThan(2)
    expect(ids[path[0]]).toBe('gateE')
    expect(ids[path[path.length - 1]]).toBe('quartersDoor')
  })

  it('is deterministic for a seed', () => {
    const a = createCrowdSim({ count: 80, seed: 42 })
    const b = createCrowdSim({ count: 80, seed: 42 })
    const ctx = { shuttleLanded: false, shuttlePad: null }
    for (let i = 0; i < 300; i++) {
      a.update(1 / 30, ctx)
      b.update(1 / 30, ctx)
    }
    expect(JSON.stringify(a.members)).toEqual(JSON.stringify(b.members))
  })

  it('members stay on/near the graph and never NaN over 10,000 steps', () => {
    const sim = createCrowdSim({ count: 150, seed: 7 })
    expect(sim.members.length).toBe(150)
    let landed = false
    let maxWalkerDist = 0
    for (let step = 0; step < 10000; step++) {
      if (step % 2500 === 400) landed = !landed
      sim.update(1 / 20, { shuttleLanded: landed, shuttlePad: { x: -125, z: 20, y: 7 } })
      if (step % 50 !== 0) continue
      sim.members.forEach((m, i) => {
        for (const v of [m.x, m.y, m.z, m.heading, m.speed, m.phase]) expect(Number.isFinite(v)).toBe(true)
        const role = sim.roles[i]
        if (role === 'walker' && m.visible) {
          const d = distanceToNavGraph(m.x, m.z)
          maxWalkerDist = Math.max(maxWalkerDist, d)
          expect(m.y).toBe(0)
        }
        if (role === 'patrol') {
          expect(m.y).toBe(WALL_HEIGHT)
          const r = Math.hypot(m.x, m.z)
          expect(r).toBeGreaterThan(PERIMETER_RADIUS * Math.cos(Math.PI / 8) - 1)
          expect(r).toBeLessThan(PERIMETER_RADIUS + 1)
        }
        if (role === 'shuttle' && m.visible) {
          expect(m.y).toBeGreaterThanOrEqual(0)
          expect(m.y).toBeLessThanOrEqual(7.0001)
        }
      })
    }
    expect(maxWalkerDist).toBeLessThan(6)
  })

  it('keeps walking personnel from occupying the same point', () => {
    const sim = createCrowdSim({ count: 120, seed: 11 })
    const ctx = { shuttleLanded: false, shuttlePad: null }
    let occupied = 0
    for (let step = 0; step < 2000; step++) {
      sim.update(1 / 20, ctx)
      if (step < 80 || step % 25 !== 0) continue
      const walking = sim.members.filter((m, i) => (sim.roles[i] === 'walker' || sim.roles[i] === 'apron') && m.visible && m.action === 'walk')
      for (let i = 0; i < walking.length; i++) {
        for (let j = i + 1; j < walking.length; j++) {
          if (Math.hypot(walking[i].x - walking[j].x, walking[i].z - walking[j].z) < 0.4) occupied++
        }
      }
    }
    expect(occupied).toBe(0)
  })

  it('sends a shuttle team to the pad when the shuttle lands', () => {
    const sim = createCrowdSim({ count: 120, seed: 3 })
    const pad = { x: -125, z: 20, y: 7 }
    for (let i = 0; i < 2400; i++) sim.update(1 / 20, { shuttleLanded: true, shuttlePad: pad })
    const team = sim.members.filter((_, i) => sim.roles[i] === 'shuttle')
    expect(team.length).toBeGreaterThanOrEqual(4)
    expect(team.length).toBeLessThanOrEqual(6)
    for (const m of team) {
      expect(m.visible).toBe(true)
      expect(m.y).toBeCloseTo(7, 3)
      expect(['inspect', 'work']).toContain(m.action)
      expect(Math.hypot(m.x - pad.x, m.z - pad.z)).toBeLessThan(34)
    }
    for (let i = 0; i < 2400; i++) sim.update(1 / 20, { shuttleLanded: false, shuttlePad: pad })
    for (const m of team) expect(m.visible).toBe(false)
  })
})

describe('crowd geometry', () => {
  it('stays within a low-poly triangle budget', async () => {
    const { createPartGeometries } = await import('./Crowd')
    const g = createPartGeometries()
    const tris = (k: keyof typeof g) => (g[k].index ? g[k].index!.count : g[k].getAttribute('position').count) / 3
    const body = tris('pelvis') + tris('torso') + tris('head') + 2 * (tris('upperArm') + tris('forearm') + tris('thigh') + tris('shin'))
    const per = { body, cap: tris('cap'), trooperHelmet: tris('trooperHelmet'), pilotHelmet: tris('pilotHelmet'), rifle: tris('rifle'), coat: tris('coat') }
    console.log('triangles per character', per, Object.fromEntries(Object.keys(g).map((k) => [k, tris(k as keyof typeof g)])))
    expect(body + Math.max(per.cap, per.trooperHelmet, per.pilotHelmet) + per.rifle).toBeLessThan(2600)
  })
})

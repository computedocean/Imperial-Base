// IMPERIAL BASE — decorative personnel simulation (pure TS, no React).
//
// Drives CrowdMember records over the NAV walk graph: commuters between
// buildings (entering / leaving through doors), wall-top patrols, gate guards,
// officer conversation groups, hangar-apron ground crew and a shuttle service
// team that walks out to the landing pad while the shuttle is down.
// Deterministic for a given seed and sequence of update() calls.

import { FACILITIES, GATES, HANGAR_DOOR, NAV_EDGES, NAV_NODES, PADS, PERIMETER_RADIUS, WALL_HEIGHT, perimeterVertices } from '../world/layout'
import { rng } from '../world/noise'
import type { CrowdMember, PersonnelVariant } from './Crowd'

export interface SimContext {
  shuttleLanded: boolean
  shuttlePad: { x: number; z: number; y: number } | null
}

export type CrowdRole = 'walker' | 'patrol' | 'gate' | 'group' | 'apron' | 'shuttle'

export interface CrowdSim {
  members: CrowdMember[]
  /** role per member (same order as members) */
  roles: CrowdRole[]
  update(dt: number, ctx: SimContext): void
}

// ------------------------------------------------------------------ graph

const NODE_IDS = Object.keys(NAV_NODES)
const NODE_INDEX: Record<string, number> = Object.fromEntries(NODE_IDS.map((id, i) => [id, i]))
const NX = NODE_IDS.map((id) => NAV_NODES[id][0])
const NZ = NODE_IDS.map((id) => NAV_NODES[id][1])
const ADJ: number[][] = NODE_IDS.map(() => [])
for (const [a, b] of NAV_EDGES) {
  const ia = NODE_INDEX[a]
  const ib = NODE_INDEX[b]
  if (ia === undefined || ib === undefined) continue
  ADJ[ia].push(ib)
  ADJ[ib].push(ia)
}
const DOORS = NODE_IDS.map((id, i) => (id.endsWith('Door') ? i : -1)).filter((i) => i >= 0)

/** Dijkstra on the small walk graph. Returns node indices from `from` to `to` (inclusive). */
export function shortestPath(from: number, to: number): number[] {
  const n = NODE_IDS.length
  const dist = new Float64Array(n).fill(Infinity)
  const prev = new Int32Array(n).fill(-1)
  const done = new Uint8Array(n)
  dist[from] = 0
  for (;;) {
    let u = -1
    let best = Infinity
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i }
    if (u < 0 || u === to) break
    done[u] = 1
    for (const v of ADJ[u]) {
      const d = best + Math.hypot(NX[u] - NX[v], NZ[u] - NZ[v])
      if (d < dist[v]) { dist[v] = d; prev[v] = u }
    }
  }
  if (from !== to && prev[to] < 0) return [from]
  const path: number[] = []
  for (let c = to; c >= 0; c = prev[c]) {
    path.push(c)
    if (c === from) break
  }
  return path.reverse()
}

/** Distance from (x,z) to the nearest NAV edge segment. */
export function distanceToNavGraph(x: number, z: number): number {
  let best = Infinity
  for (const [a, b] of NAV_EDGES) {
    const ax = NAV_NODES[a][0], az = NAV_NODES[a][1]
    const bx = NAV_NODES[b][0], bz = NAV_NODES[b][1]
    const dx = bx - ax, dz = bz - az
    const l2 = dx * dx + dz * dz
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0
    const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t))
    if (d < best) best = d
  }
  return best
}

// ------------------------------------------------------------------ helpers

const TAU = Math.PI * 2
const wrapAngle = (a: number) => {
  a = (a + Math.PI) % TAU
  if (a < 0) a += TAU
  return a - Math.PI
}
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
const headingTo = (dx: number, dz: number) => Math.atan2(dx, dz)

/** Turn toward a heading with a max rate; returns remaining |error|. */
function turnToward(m: CrowdMember, target: number, rate: number, dt: number): number {
  const d = wrapAngle(target - m.heading)
  const step = rate * dt
  m.heading = wrapAngle(m.heading + (Math.abs(d) <= step ? d : Math.sign(d) * step))
  return Math.abs(wrapAngle(target - m.heading))
}

/** Preferred destinations by uniform. */
const DOOR_BIAS: Partial<Record<PersonnelVariant, string[]>> = {
  scientist: ['resDoor', 'resDoor', 'bunkerDoor', 'intDoor'],
  engineer: ['engDoor', 'engDoor', 'bunkerDoor', 'transDoor', 'apron'],
  analyst: ['intDoor', 'intDoor', 'opsDoor', 'secDoor'],
  technician: ['bunkerDoor', 'engDoor', 'opsDoor', 'secDoor'],
  pilot: ['apron', 'apronN', 'apronS', 'quartersDoor', 'opsDoor'],
  crew: ['apron', 'apronS', 'apronN', 'pad2', 'pad3', 'transDoor'],
  trooper: ['secDoor', 'gateE', 'gateN', 'quartersDoor', 'hub'],
  officer: ['opsDoor', 'hub', 'intDoor', 'quartersDoor', 'secDoor'],
}

// ------------------------------------------------------------------ agent state

interface Walker {
  path: number[]
  idx: number
  lane: number
  baseSpeed: number
  mode: 'walk' | 'pause' | 'inside'
  timer: number
  node: number
}
interface Patrol { t: number; dir: 1 | -1; baseSpeed: number; timer: number; halted: number }
interface Station { x: number; z: number; heading: number }
interface ApronCrew { station: Station; tx: number; tz: number; th: number; timer: number; moving: boolean }
interface GroupMember { cx: number; cz: number; timer: number; salutes: boolean }
interface ShuttleCrew {
  state: 'hidden' | 'out' | 'atPad' | 'back'
  slot: number
  timer: number
  delay: number
}

type Agent =
  | { role: 'walker'; w: Walker }
  | { role: 'patrol'; p: Patrol }
  | { role: 'gate'; heading: number; timer: number }
  | { role: 'group'; g: GroupMember }
  | { role: 'apron'; a: ApronCrew }
  | { role: 'shuttle'; s: ShuttleCrew }

const WALL = perimeterVertices(PERIMETER_RADIUS)
const WALL_SEG = WALL.map((v, i) => {
  const n = WALL[(i + 1) % WALL.length]
  return Math.hypot(n[0] - v[0], n[1] - v[1])
})
const WALL_LEN = WALL_SEG.reduce((a, b) => a + b, 0)

/** Point + tangent heading on the wall-top walkway at arc length t. */
function wallPoint(t: number, out: { x: number; z: number; h: number }) {
  t = ((t % WALL_LEN) + WALL_LEN) % WALL_LEN
  for (let i = 0; i < WALL.length; i++) {
    if (t <= WALL_SEG[i] || i === WALL.length - 1) {
      const a = WALL[i]
      const b = WALL[(i + 1) % WALL.length]
      const f = Math.min(1, t / WALL_SEG[i])
      out.x = a[0] + (b[0] - a[0]) * f
      out.z = a[1] + (b[1] - a[1]) * f
      out.h = headingTo(b[0] - a[0], b[1] - a[1])
      return out
    }
    t -= WALL_SEG[i]
  }
  return out
}

function padRadius(x: number, z: number): number {
  for (const p of PADS) if (Math.abs(p.x - x) < 1 && Math.abs(p.z - z) < 1) return p.radius
  return PADS[0].radius
}

const APRON_CENTER = { x: -175, z: 20 }
const HANGAR_EXIT = { x: HANGAR_DOOR.x + 4, z: HANGAR_DOOR.z }

export function createCrowdSim(opts: { count: number; seed: number }): CrowdSim {
  const r = rng(opts.seed)
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(r() * arr.length) % arr.length]
  const count = Math.max(0, Math.floor(opts.count))
  const members: CrowdMember[] = []
  const roles: CrowdRole[] = []
  const agents: Agent[] = []

  const add = (variant: PersonnelVariant, role: CrowdRole, agent: Agent, x: number, z: number, y = 0, heading = 0): CrowdMember | null => {
    if (members.length >= count) return null
    const m: CrowdMember = { x, y, z, heading, speed: 0, action: 'idle', variant, phase: r() * 1000, visible: true }
    members.push(m)
    roles.push(role)
    agents.push(agent)
    return m
  }

  // --- shuttle service team (start inside the hangar)
  const shuttleN = Math.min(6, Math.max(4, Math.round(count * 0.035)))
  const shuttleVariants: PersonnelVariant[] = ['crew', 'crew', 'engineer', 'crew', 'technician', 'crew']
  for (let i = 0; i < shuttleN; i++) {
    const m = add(shuttleVariants[i], 'shuttle', { role: 'shuttle', s: { state: 'hidden', slot: i, timer: 0, delay: 1 + i * 1.3 + r() * 1.5 } }, HANGAR_EXIT.x, HANGAR_EXIT.z, 0, Math.PI / 2)
    if (m) m.visible = false
  }

  // --- gate guards
  for (const g of GATES) {
    const ox = Math.sin(g.rotY), oz = Math.cos(g.rotY)
    const lx = Math.cos(g.rotY), lz = -Math.sin(g.rotY)
    for (const side of [-1, 1]) {
      const x = g.x - ox * 7 + lx * 8 * side
      const z = g.z - oz * 7 + lz * 8 * side
      const m = add('trooper', 'gate', { role: 'gate', heading: g.rotY, timer: r() * 30 }, x, z, 0, g.rotY)
      if (m) m.action = 'guard'
    }
  }

  // --- wall-top patrols
  const patrolN = Math.max(2, Math.round(count * 0.07))
  for (let i = 0; i < patrolN; i++) {
    const p: Patrol = { t: (i / patrolN) * WALL_LEN + r() * 20, dir: r() < 0.5 ? 1 : -1, baseSpeed: 1.05 + r() * 0.25, timer: 20 + r() * 60, halted: 0 }
    const pt = wallPoint(p.t, { x: 0, z: 0, h: 0 })
    add('trooper', 'patrol', { role: 'patrol', p }, pt.x, pt.z, WALL_HEIGHT, pt.h)
  }

  // --- officer conversation groups
  const groupSpots = count >= 40
    ? [{ x: 11, z: 112 }, { x: 134, z: 120 }, { x: -158, z: 234 }, { x: -60, z: -150 }]
    : [{ x: 11, z: 112 }]
  const groupKinds: PersonnelVariant[][] = [
    ['officer', 'officer', 'analyst', 'trooper'],
    ['officer', 'engineer', 'technician'],
    ['officer', 'officer', 'pilot'],
    ['scientist', 'scientist', 'officer'],
  ]
  groupSpots.forEach((spot, gi) => {
    const kinds = groupKinds[gi % groupKinds.length]
    kinds.forEach((v, k) => {
      const a = (k / kinds.length) * TAU + r() * 0.4
      const rad = 0.95 + r() * 0.3
      const x = spot.x + Math.sin(a) * rad
      const z = spot.z + Math.cos(a) * rad
      const salutes = v === 'trooper'
      const m = add(v, 'group', { role: 'group', g: { cx: spot.x, cz: spot.z, timer: 4 + r() * 10, salutes } }, x, z, 0, headingTo(spot.x - x, spot.z - z))
      if (m) m.action = salutes ? 'guard' : 'talk'
    })
  })

  // --- hangar apron ground crew
  const apronN = Math.max(3, Math.round(count * 0.06))
  const apronVariants: PersonnelVariant[] = ['crew', 'engineer', 'crew', 'technician', 'pilot', 'crew', 'engineer', 'crew']
  const randomStation = (): Station => ({
    x: APRON_CENTER.x - 20 + r() * 42,
    z: APRON_CENTER.z - 32 + r() * 66,
    heading: r() * TAU,
  })
  for (let i = 0; i < apronN; i++) {
    const st = randomStation()
    const m = add(apronVariants[i % apronVariants.length], 'apron', { role: 'apron', a: { station: st, tx: st.x, tz: st.z, th: st.heading, timer: 3 + r() * 15, moving: false } }, st.x, st.z, 0, st.heading)
    if (m) m.action = r() < 0.5 ? 'inspect' : 'work'
  }

  // --- walkers (everyone else)
  const walkerVariants: PersonnelVariant[] = [
    'officer', 'officer', 'trooper', 'trooper', 'trooper', 'engineer', 'engineer', 'technician', 'technician',
    'scientist', 'scientist', 'analyst', 'analyst', 'pilot', 'crew',
  ]
  const chooseDest = (variant: PersonnelVariant, from: number): number => {
    const bias = DOOR_BIAS[variant]
    for (let tries = 0; tries < 6; tries++) {
      let id: number
      if (bias && r() < 0.6) id = NODE_INDEX[pick(bias)]
      else if (r() < 0.55) id = pick(DOORS)
      else id = Math.floor(r() * NODE_IDS.length) % NODE_IDS.length
      if (id !== undefined && id !== from) return id
    }
    return ADJ[from][0] ?? from
  }
  while (members.length < count) {
    const variant = pick(walkerVariants)
    const start = Math.floor(r() * NODE_IDS.length) % NODE_IDS.length
    const dest = chooseDest(variant, start)
    const w: Walker = {
      path: shortestPath(start, dest),
      idx: 1,
      lane: (r() * 2 - 1) * 2.8,
      baseSpeed: 1.15 + r() * 0.45,
      mode: 'walk',
      timer: 0,
      node: start,
    }
    // start somewhere along the first edge so nobody spawns stacked on a node
    let x = NX[start], z = NZ[start], h = r() * TAU
    if (w.path.length > 1) {
      const n1 = w.path[1]
      const f = r() * 0.8
      const dx = NX[n1] - NX[start], dz = NZ[n1] - NZ[start]
      const len = Math.hypot(dx, dz) || 1
      x += dx * f + (dz / len) * w.lane
      z += dz * f - (dx / len) * w.lane
      h = headingTo(dx, dz)
    }
    const m = add(variant, 'walker', { role: 'walker', w }, x, z, 0, h)
    if (m && r() < 0.15 && DOORS.includes(start)) {
      w.mode = 'inside'
      w.timer = r() * 40
      m.visible = false
    }
  }

  const tmpPt = { x: 0, z: 0, h: 0 }

  // ---------------------------------------------------------------- update

  function updateWalker(m: CrowdMember, w: Walker, dt: number) {
    if (w.mode === 'inside') {
      w.timer -= dt
      m.speed = 0
      if (w.timer <= 0) {
        m.visible = true
        w.mode = 'walk'
        const dest = chooseDest(m.variant, w.node)
        w.path = shortestPath(w.node, dest)
        w.idx = 1
        m.x = NX[w.node]
        m.z = NZ[w.node]
        if (w.path.length > 1) m.heading = headingTo(NX[w.path[1]] - m.x, NZ[w.path[1]] - m.z)
      }
      return
    }
    if (w.mode === 'pause') {
      w.timer -= dt
      m.speed = Math.max(0, m.speed - dt * 3)
      if (w.timer <= 0) {
        w.mode = 'walk'
        m.action = 'walk'
      }
      return
    }
    if (w.idx >= w.path.length) {
      // arrived at destination
      const nodeId = NODE_IDS[w.node]
      if (nodeId.endsWith('Door') && r() < 0.8) {
        w.mode = 'inside'
        w.timer = 12 + r() * 70
        m.visible = false
        m.speed = 0
        m.action = 'idle'
        return
      }
      const dest = chooseDest(m.variant, w.node)
      w.path = shortestPath(w.node, dest)
      w.idx = 1
      if (r() < 0.3) {
        w.mode = 'pause'
        w.timer = 2 + r() * 6
        m.action = 'idle'
      }
      return
    }
    const prevN = w.path[w.idx - 1]
    const nextN = w.path[w.idx]
    const ex = NX[nextN] - NX[prevN]
    const ez = NZ[nextN] - NZ[prevN]
    const el = Math.hypot(ex, ez) || 1
    // keep to a lane (signed lateral offset from the edge centreline)
    const tx = NX[nextN] + (ez / el) * w.lane
    const tz = NZ[nextN] - (ex / el) * w.lane
    const dx = tx - m.x
    const dz = tz - m.z
    const dist = Math.hypot(dx, dz)
    if (dist < 1.6) {
      w.node = nextN
      w.idx++
      if (w.idx < w.path.length && r() < 0.04) {
        w.mode = 'pause'
        w.timer = 1.5 + r() * 4
        m.action = 'idle'
      }
      return
    }
    const err = turnToward(m, headingTo(dx, dz), 2.6, dt)
    const want = w.baseSpeed * (err > 1.0 ? 0.35 : err > 0.4 ? 0.75 : 1)
    m.speed += (want - m.speed) * Math.min(1, dt * 2.5)
    m.action = 'walk'
    m.x += Math.sin(m.heading) * m.speed * dt
    m.z += Math.cos(m.heading) * m.speed * dt
    clampWalkerToEdge(m, w)
  }

  function updatePatrol(m: CrowdMember, p: Patrol, dt: number) {
    p.timer -= dt
    if (p.halted > 0) {
      p.halted -= dt
      m.speed = 0
      m.action = 'guard'
      // look outward over the wall
      turnToward(m, headingTo(m.x, m.z), 1.2, dt)
      if (p.halted <= 0) {
        p.timer = 30 + r() * 70
        if (r() < 0.3) p.dir = p.dir === 1 ? -1 : 1
      }
      return
    }
    if (p.timer <= 0) {
      p.halted = 5 + r() * 9
      return
    }
    m.speed += (p.baseSpeed - m.speed) * Math.min(1, dt * 2)
    p.t += p.dir * m.speed * dt
    wallPoint(p.t, tmpPt)
    m.x = tmpPt.x
    m.z = tmpPt.z
    m.y = WALL_HEIGHT
    turnToward(m, p.dir === 1 ? tmpPt.h : tmpPt.h + Math.PI, 3, dt)
    m.action = 'walk'
  }

  function updateGroup(m: CrowdMember, g: GroupMember, dt: number) {
    g.timer -= dt
    m.speed = 0
    turnToward(m, headingTo(g.cx - m.x, g.cz - m.z), 1.5, dt)
    if (g.timer > 0) return
    if (g.salutes) {
      if (m.action === 'salute') { m.action = 'guard'; g.timer = 20 + r() * 30 } else { m.action = 'salute'; g.timer = 2.5 + r() * 1.5 }
    } else {
      m.action = m.action === 'talk' ? (r() < 0.6 ? 'idle' : 'talk') : 'talk'
      g.timer = 5 + r() * 14
    }
  }

  function updateApron(m: CrowdMember, a: ApronCrew, dt: number) {
    if (a.moving) {
      const dx = a.tx - m.x, dz = a.tz - m.z
      const d = Math.hypot(dx, dz)
      if (d < 0.6) {
        a.moving = false
        m.speed = 0
        m.action = r() < 0.55 ? 'inspect' : 'work'
        a.timer = 8 + r() * 22
        return
      }
      const err = turnToward(m, headingTo(dx, dz), 2.5, dt)
      m.speed += ((err > 0.8 ? 0.4 : 1.2) - m.speed) * Math.min(1, dt * 2.5)
      m.x += Math.sin(m.heading) * m.speed * dt
      m.z += Math.cos(m.heading) * m.speed * dt
      m.action = 'walk'
      return
    }
    turnToward(m, a.th, 1.5, dt)
    m.speed = 0
    a.timer -= dt
    if (a.timer > 0) return
    const roll = r()
    if (roll < 0.35) {
      const st = randomStation()
      a.tx = st.x
      a.tz = st.z
      a.th = st.heading
      a.moving = true
    } else {
      m.action = roll < 0.6 ? 'inspect' : roll < 0.85 ? 'work' : 'idle'
      a.th = wrapAngle(a.th + (r() - 0.5) * 1.5)
      a.timer = 6 + r() * 18
    }
  }

  function padSlot(s: ShuttleCrew, pad: { x: number; z: number; y: number }, radius: number, out: { x: number; z: number; h: number }) {
    // spread around the pad facing the craft, avoiding the hangar side bunching
    const a = Math.PI * 0.85 + (s.slot / Math.max(1, shuttleN)) * TAU * 0.92
    const rr = radius * (0.62 + (s.slot % 2) * 0.12)
    out.x = pad.x + Math.cos(a) * rr
    out.z = pad.z + Math.sin(a) * rr
    out.h = headingTo(pad.x - out.x, pad.z - out.z)
    return out
  }

  function updateShuttle(m: CrowdMember, s: ShuttleCrew, dt: number, ctx: SimContext) {
    const pad = ctx.shuttlePad ?? PADS[0]
    const padR = padRadius(pad.x, pad.z)
    const landed = ctx.shuttleLanded
    if (s.state === 'hidden') {
      m.visible = false
      m.speed = 0
      if (landed) {
        s.timer += dt
        if (s.timer > s.delay) {
          s.state = 'out'
          m.visible = true
          m.x = HANGAR_EXIT.x + (s.slot - shuttleN / 2) * 1.2
          m.z = HANGAR_EXIT.z + ((s.slot % 2) - 0.5) * 2
          m.y = 0
          m.heading = Math.PI / 2
        }
      } else s.timer = 0
      return
    }
    if (s.state === 'atPad') {
      m.speed = 0
      padSlot(s, pad, padR, tmpPt)
      turnToward(m, tmpPt.h, 1.5, dt)
      s.timer -= dt
      if (s.timer <= 0) {
        m.action = m.action === 'inspect' ? 'work' : 'inspect'
        s.timer = 7 + r() * 12
      }
      if (!landed) {
        s.state = 'back'
        s.timer = 0
      }
      return
    }
    // moving: out to the pad or back to the hangar
    let tx: number, tz: number
    if (s.state === 'out') {
      if (!landed) { s.state = 'back'; return }
      padSlot(s, pad, padR, tmpPt)
      tx = tmpPt.x
      tz = tmpPt.z
    } else {
      tx = HANGAR_EXIT.x
      tz = HANGAR_EXIT.z + (s.slot - shuttleN / 2) * 1.5
    }
    const dx = tx - m.x, dz = tz - m.z
    const d = Math.hypot(dx, dz)
    if (d < 0.8) {
      if (s.state === 'out') {
        s.state = 'atPad'
        m.action = s.slot % 2 === 0 ? 'inspect' : 'work'
        s.timer = 4 + r() * 10
      } else {
        s.state = 'hidden'
        s.timer = 0
        m.visible = false
        m.y = 0
      }
      m.speed = 0
      return
    }
    const err = turnToward(m, headingTo(dx, dz), 2.6, dt)
    m.speed += ((err > 0.8 ? 0.5 : 1.45) - m.speed) * Math.min(1, dt * 2.5)
    m.x += Math.sin(m.heading) * m.speed * dt
    m.z += Math.cos(m.heading) * m.speed * dt
    m.action = 'walk'
    // pad deck is raised: climb the access ramp over the last metres
    const dPad = Math.hypot(m.x - pad.x, m.z - pad.z)
    m.y = pad.y * smoothstep(padR + 14, padR - 1, dPad)
  }

  /** Keep a walker inside the corridor of the edge they are traversing. */
  function clampWalkerToEdge(m: CrowdMember, w: Walker, maxLat = 4.2) {
    if (w.path.length < 2 || w.idx < 1) return
    const nextN = w.path[Math.min(w.idx, w.path.length - 1)]
    const prevN = w.path[Math.min(w.idx, w.path.length - 1) - 1]
    const ax = NX[prevN], az = NZ[prevN]
    const bx = NX[nextN], bz = NZ[nextN]
    const ex = bx - ax, ez = bz - az
    const el = Math.hypot(ex, ez) || 1
    const tx = ex / el, tz = ez / el
    const lx = tz, lz = -tx
    const vx = m.x - ax, vz = m.z - az
    const along = Math.max(-0.5, Math.min(el + 0.5, vx * tx + vz * tz))
    const lat = Math.max(-maxLat, Math.min(maxLat, vx * lx + vz * lz))
    m.x = ax + tx * along + lx * lat
    m.z = az + tz * along + lz * lat
  }

  /**
   * Soft personal space for people who share the ground. Walkers only slide
   * sideways (then get clamped back onto their corridor) and slow when
   * someone is directly ahead, so a queue forms instead of a stack.
   * Gate guards, wall patrols and conversation groups stay put.
   */
  function separate(dt: number) {
    const CELL = 2.4
    const buckets = new Map<string, number[]>()
    const active: number[] = []
    for (let i = 0; i < members.length; i++) {
      const m = members[i]
      const role = roles[i]
      if (!m.visible || m.action !== 'walk') continue
      if (role !== 'walker' && role !== 'apron') continue
      active.push(i)
      const k = `${Math.floor(m.x / CELL)},${Math.floor(m.z / CELL)}`
      const b = buckets.get(k)
      if (b) b.push(i)
      else buckets.set(k, [i])
    }
    const R = 1.2
    const R2 = R * R
    for (const i of active) {
      const m = members[i]
      const cx = Math.floor(m.x / CELL)
      const cz = Math.floor(m.z / CELL)
      const fx = Math.sin(m.heading)
      const fz = Math.cos(m.heading)
      const rx = Math.cos(m.heading)
      const rz = -Math.sin(m.heading)
      let lat = 0
      let ahead = 0
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const b = buckets.get(`${cx + ox},${cz + oz}`)
          if (!b) continue
          for (const j of b) {
            if (j <= i) continue
            const o = members[j]
            const dx = m.x - o.x
            const dz = m.z - o.z
            const d2 = dx * dx + dz * dz
            if (d2 < 1e-6 || d2 > R2) continue
            const d = Math.sqrt(d2)
            const wgt = (R - d) / R
            const side = (dx * rx + dz * rz) / d
            lat += side * wgt
            const closing = -(dx * fx + dz * fz)
            if (closing > 0.35 * d) ahead = Math.max(ahead, wgt)
            // equal-and-opposite so the pair stays deterministic without a second pass
            const oFx = Math.sin(o.heading)
            const oFz = Math.cos(o.heading)
            const oRx = Math.cos(o.heading)
            const oRz = -Math.sin(o.heading)
            const oSide = -(dx * oRx + dz * oRz) / d
            const oAhead = (dx * oFx + dz * oFz) > 0.35 * d
            if (roles[j] === 'walker') {
              const nudge = Math.max(-1, Math.min(1, oSide * wgt)) * dt * 2.4
              const pass = Math.abs(oSide) < 0.2 ? (j % 2 === 0 ? 1 : -1) : 0
              o.x += oRx * (nudge + pass * 0.85 * dt * wgt)
              o.z += oRz * (nudge + pass * 0.85 * dt * wgt)
              if (oAhead) {
                const ow = agents[j]
                if (ow.role === 'walker') o.speed = Math.min(o.speed, ow.w.baseSpeed * (1 - 0.82 * wgt))
              }
            } else {
              o.x += oRx * Math.max(-1, Math.min(1, oSide * wgt)) * dt * 1.6
              o.z += oRz * Math.max(-1, Math.min(1, oSide * wgt)) * dt * 1.6
            }
          }
        }
      }
      if (roles[i] === 'walker') {
        const nudge = Math.max(-1, Math.min(1, lat)) * dt * 2.4
        const pass = Math.abs(lat) < 0.15 && ahead > 0.2 ? (i % 2 === 0 ? 1 : -1) : 0
        m.x += rx * (nudge + pass * 0.85 * dt * ahead)
        m.z += rz * (nudge + pass * 0.85 * dt * ahead)
        if (ahead > 0.15) {
          const self = agents[i]
          if (self.role === 'walker') m.speed = Math.min(m.speed, self.w.baseSpeed * (1 - 0.82 * Math.min(1, ahead)))
        }
        const self = agents[i]
        if (self.role === 'walker' && self.w.mode === 'walk') clampWalkerToEdge(m, self.w)
      } else {
        m.x += rx * Math.max(-1, Math.min(1, lat)) * dt * 1.6
        m.z += rz * Math.max(-1, Math.min(1, lat)) * dt * 1.6
        if (ahead > 0.2) m.speed *= 1 - 0.55 * Math.min(1, ahead)
      }
    }
    for (const i of active) {
      if (roles[i] !== 'walker') continue
      const self = agents[i]
      if (self.role === 'walker' && self.w.mode === 'walk') clampWalkerToEdge(members[i], self.w)
    }
  }

  function update(rawDt: number, ctx: SimContext) {
    const dt = Math.max(0, Math.min(rawDt, 0.25))
    if (dt === 0) return
    for (let i = 0; i < members.length; i++) {
      const m = members[i]
      const a = agents[i]
      switch (a.role) {
        case 'walker': updateWalker(m, a.w, dt); break
        case 'patrol': updatePatrol(m, a.p, dt); break
        case 'gate':
          m.speed = 0
          a.timer -= dt
          m.action = 'guard'
          turnToward(m, a.heading + 0.25 * Math.sin(a.timer * 0.05), 0.5, dt)
          break
        case 'group': updateGroup(m, a.g, dt); break
        case 'apron': updateApron(m, a.a, dt); break
        case 'shuttle': updateShuttle(m, a.s, dt, ctx); break
      }
    }
    separate(dt)
  }

  return { members, roles, update }
}

/** Facilities with a door node (handy for callers that want to place extra personnel). */
export const DOOR_FACILITIES = FACILITIES.filter((f) => f.interior)

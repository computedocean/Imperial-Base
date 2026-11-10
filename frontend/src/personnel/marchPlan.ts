// The march on the Temple — choreography. Pure TypeScript (no React), deterministic, unit-tested.
// Simulated scenery: it never represents real-world activity.
//
// A hooded knight leads a column of clone troopers in step along the paved approach, up the three low
// steps and in through the great door of the Temple. He ignites his blade as he reaches the steps.
// Each rank disappears into the dark of the doorway; when the last is inside, the scene is over.
//
// Everything here is in the march's LOCAL frame: the door is at the origin, +Z points straight out of
// the door along the approach, X is across the column. MARCH_FRAME / toWorld() place it in the base.
import { TEMPLE } from '../world/layout'

/** Where the local frame sits in the world: the temple door, with local +Z pointing east (+X). */
export const MARCH_FRAME = { position: [TEMPLE.door[0], 0, TEMPLE.door[1]] as [number, number, number], yaw: Math.PI / 2 }

/** Local (x across, z out from the door) to world (x, z). */
export function toWorld(x: number, z: number): [number, number] {
  const c = Math.cos(MARCH_FRAME.yaw), s = Math.sin(MARCH_FRAME.yaw)
  return [MARCH_FRAME.position[0] + x * c + z * s, MARCH_FRAME.position[2] - x * s + z * c]
}

export const MARCH = {
  /** the column walks down the approach (x = 0) from this far out ... */
  startZ: 90,
  /** ... to the door recess, where each figure passes out of sight */
  doorZ: 0.5,
  /** marching pace, m/s */
  speed: 1.9,
  /** troopers per rank, ranks in the column */
  files: 4,
  ranks: 9,
  fileGap: 2.1,
  rankGap: 2.5,
  /** the leader walks this far ahead of the first rank */
  lead: 5.5,
  /** steps per second (left + right = one stride) */
  cadence: 1.85,
  /** where the leader's blade comes on: the foot of the steps */
  igniteZ: 18,
  /** seconds between automatic marches, and before the first */
  every: 300,
  first: 95,
}

export const TROOPERS = MARCH.files * MARCH.ranks

/** The three low steps in front of the door (front edge z, top height). */
const STEPS: [number, number][] = [[16, 0.22], [13.5, 0.44], [11, 0.66]]

/** Ground height on the approach at depth z (local). */
export function plazaHeight(z: number) {
  let y = 0
  for (const [edge, top] of STEPS) if (z <= edge) y = top
  return y
}

/** Seconds from the first step to the last trooper passing through the door. */
export const MARCH_LENGTH = (MARCH.startZ - MARCH.doorZ + MARCH.lead + (MARCH.ranks - 1) * MARCH.rankGap) / MARCH.speed + 0.5

export interface Marcher { x: number; y: number; z: number; visible: boolean; /** stride phase, radians */ phase: number }
export interface MarchState {
  leader: Marcher
  /** 0 = blade off .. 1 = fully lit */
  blade: number
  troopers: Marcher[]
  /** true once everyone is inside */
  done: boolean
  /** how many are still in view (leader included) */
  inView: number
}

const mk = (): Marcher => ({ x: 0, y: 0, z: 0, visible: false, phase: 0 })
export function createMarchState(): MarchState {
  return { leader: mk(), blade: 0, troopers: Array.from({ length: TROOPERS }, mk), done: false, inView: 0 }
}

function place(m: Marcher, x: number, z: number, t: number, offset: number) {
  m.x = x
  m.z = z
  m.y = plazaHeight(z)
  // in view from the first step until the doorway swallows them
  m.visible = t >= 0 && z > MARCH.doorZ && z <= MARCH.startZ + 0.001
  m.phase = (t * MARCH.cadence + offset) * Math.PI
}

/** Where everyone is `t` seconds after the march begins (local frame). Everyone faces -Z, towards the door. */
export function marchAt(t: number, out: MarchState = createMarchState()): MarchState {
  const head = MARCH.startZ - MARCH.speed * Math.max(0, t) // the leader's depth
  place(out.leader, 0, head, t, 0)
  out.blade = Math.min(1, Math.max(0, (MARCH.igniteZ - head) / 1.2))
  let n = out.leader.visible ? 1 : 0
  for (let r = 0; r < MARCH.ranks; r++) {
    for (let f = 0; f < MARCH.files; f++) {
      const m = out.troopers[r * MARCH.files + f]
      const z = head + MARCH.lead + r * MARCH.rankGap
      // the whole column is in step: everyone's left foot lands together
      place(m, (f - (MARCH.files - 1) / 2) * MARCH.fileGap, z, t, 0)
      // ranks that have not yet reached the start line are still out of sight behind it
      if (m.visible) n++
    }
  }
  out.inView = n
  out.done = t >= MARCH_LENGTH
  return out
}

/** Runs the march on a timer or on command. */
export class MarchSim {
  /** start time of the current march, or null when none is under way */
  t0: number | null = null
  auto = true
  private next = MARCH.first
  /** counts marches started, so the feed can announce each one once */
  count = 0

  start(now: number) {
    if (this.t0 !== null) return false
    this.t0 = now
    this.count++
    return true
  }

  /** Seconds into the current march, or -1. */
  elapsed(now: number) { return this.t0 === null ? -1 : now - this.t0 }

  update(now: number) {
    if (this.t0 !== null && now - this.t0 >= MARCH_LENGTH) {
      this.t0 = null
      this.next = now + MARCH.every
    }
    if (this.t0 === null && this.auto && now >= this.next) this.start(now)
  }
}

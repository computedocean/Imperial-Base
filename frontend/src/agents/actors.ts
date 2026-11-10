// Real-agent character motion. Every movement is driven by confirmed hook-derived state
// (status, active tool, department) from the backend — nothing here invents work.
import * as THREE from 'three'
import type { AgentInfo } from '../state/types'
import { INTERIORS, stationForTool, type InteriorLayout, type Station, toWorld } from '../interiors/layouts'
import type { DepartmentId } from '../world/layout'
import { HIDE_AFTER_S, UNENGAGED_GRACE_S } from './liveness'

export type ActorAction = 'walk' | 'idle' | 'work' | 'talk'

export interface Actor {
  id: string
  dept: DepartmentId
  pos: THREE.Vector3
  heading: number
  speed: number
  action: ActorAction
  phase: number
  path: THREE.Vector3[]
  stationKey: string | null
  faceTo: number | null
  leaving: boolean
  gone: boolean
}

const WALK = 2.6 // m/s indoors
const COMPLETED_LINGER_S = 5 * 60

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export function layoutFor(dept: string): InteriorLayout {
  return INTERIORS[dept as DepartmentId] ?? INTERIORS.engineering!
}

/** Agents that should currently have a body in the base. */
export function isPresent(a: AgentInfo, now: number) {
  if (now - a.last_event_at > HIDE_AFTER_S) return false
  if (a.engaged === false && now - a.last_event_at > UNENGAGED_GRACE_S) return false // opened, never used
  if (a.status === 'disconnected') return a.ended_at != null && now - a.ended_at < 60
  if (a.status === 'completed') return a.ended_at != null && now - a.ended_at < COMPLETED_LINGER_S
  return true
}

/** The spot an agent should stand at, given its confirmed state. */
export function desiredSpot(a: AgentInfo, occupied: Set<string>): { key: string; x: number; z: number; face: number | null; action: ActorAction } {
  const l = layoutFor(a.department)
  const h = hash(a.id)
  const lounge = () => {
    const [x, z] = l.lounge[h % l.lounge.length]
    const ang = ((h >> 4) % 12) / 12 * Math.PI * 2
    return { key: `lounge-${h % l.lounge.length}-${a.id}`, x: x + Math.cos(ang) * 1.6, z: z + Math.sin(ang) * 1.6, face: null, action: 'idle' as const }
  }
  if (a.status === 'idle' || a.status === 'completed' || a.status === 'disconnected' || a.stale) return lounge()
  let types = stationForTool(a.active_tool)
  if (a.status === 'delegating') types = ['holotable', 'briefing', 'console']
  if (a.status === 'active' && !a.active_tool) types = ['console', 'terminal', 'lab']
  let pick: Station | undefined
  for (const t of types) {
    const cands = l.stations.filter((s) => s.type === t)
    if (!cands.length) continue
    for (let i = 0; i < cands.length; i++) {
      const s = cands[(h + i) % cands.length]
      if (!occupied.has(s.id) || s.type === 'holotable' || s.type === 'briefing') { pick = s; break }
    }
    if (pick) break
  }
  if (!pick) return lounge()
  if (pick.type === 'holotable' || pick.type === 'briefing') {
    const ang = ((h % 16) / 16) * Math.PI * 2
    const R = pick.type === 'holotable' ? 4.2 : 5
    return { key: pick.id, x: pick.x + Math.cos(ang) * R, z: pick.z + Math.sin(ang) * R, face: Math.atan2(-Math.cos(ang), -Math.sin(ang)), action: a.status === 'delegating' ? 'talk' : 'work' }
  }
  // stand in front of the station, facing it (stations face +Z locally; operator stands at local +z)
  const off = pick.type === 'rack' ? 1.4 : 1.1
  const x = pick.x + Math.sin(pick.rot) * off
  const z = pick.z + Math.cos(pick.rot) * off
  return { key: pick.id, x, z, face: pick.rot + Math.PI, action: a.status === 'waiting' ? 'idle' : 'work' }
}

export class ActorSystem {
  actors = new Map<string, Actor>()
  private booted = false

  sync(agents: Record<string, AgentInfo>, now: number) {
    const occupied = new Set<string>()
    for (const act of this.actors.values()) if (act.stationKey) occupied.add(act.stationKey)
    for (const a of Object.values(agents)) {
      const present = isPresent(a, now)
      let act = this.actors.get(a.id)
      if (!present) {
        if (act && !act.leaving) this.leave(act, a)
        continue
      }
      const l = layoutFor(a.department)
      if (!act) {
        const [ex, ez] = l.entry
        const spot = desiredSpot(a, occupied)
        const start = this.booted
          ? new THREE.Vector3(...toWorld(l, ex, ez))
          : new THREE.Vector3(...toWorld(l, spot.x, spot.z)) // agents already on duty when the page loads start at their post
        act = {
          id: a.id, dept: l.id, pos: start, heading: 0, speed: 0, action: 'idle', phase: (hash(a.id) % 1000) / 100,
          path: [], stationKey: null, faceTo: null, leaving: false, gone: false,
        }
        this.actors.set(a.id, act)
      }
      if (act.leaving) continue
      if (act.stationKey) occupied.delete(act.stationKey)
      const spot = desiredSpot(a, occupied)
      occupied.add(spot.key)
      if (spot.key !== act.stationKey || act.path.length === 0 && act.pos.distanceToSquared(new THREE.Vector3(...toWorld(l, spot.x, spot.z))) > 1) {
        act.stationKey = spot.key
        act.path = [new THREE.Vector3(...toWorld(l, spot.x, spot.z))]
        act.faceTo = spot.face
        act.action = spot.action
      } else {
        act.action = spot.action
        act.faceTo = spot.face
      }
    }
    this.booted = true
  }

  private leave(act: Actor, a: AgentInfo) {
    const l = layoutFor(a.department)
    act.leaving = true
    act.stationKey = null
    act.path = [new THREE.Vector3(...toWorld(l, l.entry[0], l.entry[1]))]
  }

  update(dt: number) {
    for (const act of this.actors.values()) {
      act.phase += dt
      if (act.path.length) {
        const target = act.path[0]
        const d = new THREE.Vector3().subVectors(target, act.pos)
        d.y = 0
        const dist = d.length()
        if (dist < 0.15) {
          act.pos.copy(target)
          act.path.shift()
          if (!act.path.length && act.leaving) act.gone = true
        } else {
          const step = Math.min(dist, WALK * dt)
          act.pos.addScaledVector(d.normalize(), step)
          act.pos.y = target.y
          const want = Math.atan2(d.x, d.z)
          act.heading = turn(act.heading, want, dt * 6)
          act.speed = WALK
          continue
        }
      }
      act.speed = 0
      if (act.faceTo != null) act.heading = turn(act.heading, act.faceTo, dt * 4)
    }
    for (const [id, act] of this.actors) if (act.gone) this.actors.delete(id)
  }
}

function turn(cur: number, want: number, k: number) {
  let d = want - cur
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return cur + d * Math.min(1, k)
}

export const actorSystem = new ActorSystem()

// One definition of "who is on the base right now", shared by the roster, the top bar,
// the facility counts and the 3D characters. Everything is derived from confirmed hook state.
import type { AgentInfo } from '../state/types'

/** Agents with no event for this long are no longer shown as on duty. */
export const HIDE_AFTER_S = 12 * 3600
/** A session that was opened but never prompted and never used a tool is dropped after this. */
export const UNENGAGED_GRACE_S = 15 * 60
/** A permission prompt or failure older than this is assumed to be abandoned, not pending. */
export const ATTENTION_WINDOW_S = 60 * 60

export type Duty = 'attention' | 'busy' | 'standby' | 'off'

const age = (a: AgentInfo, now: number) => now - a.last_event_at

/** On the base: not signed off, heard from recently, and not an empty session that never did anything. */
export function isOnDuty(a: AgentInfo, now: number) {
  if (a.status === 'disconnected' || a.status === 'completed') return false
  if (age(a, now) > HIDE_AFTER_S) return false
  if (a.engaged === false && age(a, now) > UNENGAGED_GRACE_S) return false
  return true
}

/** Blocked on the Commander: waiting for a permission, or its last turn failed. */
export function needsAttention(a: AgentInfo, now: number) {
  return isOnDuty(a, now) && (a.status === 'waiting' || a.status === 'failed') && age(a, now) < ATTENTION_WINDOW_S
}

/** Confirmed to be doing something right now (not stale). */
export function isBusy(a: AgentInfo, now: number) {
  return isOnDuty(a, now) && !a.stale && (a.status === 'working' || a.status === 'delegating')
}

export function dutyOf(a: AgentInfo, now: number): Duty {
  if (!isOnDuty(a, now)) return 'off'
  if (needsAttention(a, now)) return 'attention'
  if (isBusy(a, now)) return 'busy'
  return 'standby'
}

export interface DutyCounts { attention: number; busy: number; standby: number; onDuty: number }

export function dutyCounts(agents: Iterable<AgentInfo>, now: number): DutyCounts {
  const c: DutyCounts = { attention: 0, busy: 0, standby: 0, onDuty: 0 }
  for (const a of agents) {
    const d = dutyOf(a, now)
    if (d === 'off') continue
    c[d]++
    c.onDuty++
  }
  return c
}

const RANK: Record<Duty, number> = { attention: 0, busy: 1, standby: 2, off: 3 }

/** Sort key for a roster row: the most urgent duty among the agent and its descendants, then recency. */
export function rosterRank(a: AgentInfo, all: Record<string, AgentInfo>, now: number, depth = 0): number {
  let r = RANK[dutyOf(a, now)]
  if (depth < 4) for (const id of a.children) if (all[id]) r = Math.min(r, rosterRank(all[id], all, now, depth + 1))
  return r
}

export interface DayStats { sessions: number; subagents: number; toolCalls: number; errors: number; tokens: number }

/** Totals over agents that reported at least one event since `since` (epoch seconds). */
export function statsSince(agents: Iterable<AgentInfo>, since: number): DayStats {
  const s: DayStats = { sessions: 0, subagents: 0, toolCalls: 0, errors: 0, tokens: 0 }
  for (const a of agents) {
    if (a.last_event_at < since) continue
    if (a.kind === 'main') { if (a.engaged !== false) s.sessions++ } else s.subagents++
    s.toolCalls += a.tool_calls
    s.errors += a.errors
    s.tokens += a.tokens?.total_tokens ?? 0
  }
  return s
}

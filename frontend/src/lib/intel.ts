// Command overview and ISB (Imperial Security Bureau) analysis. Pure functions over confirmed state only:
// hook events, agent records and Orders notices. Nothing here invents activity; when the base cannot see the
// data (link offline) the assessment says so instead of guessing.
import { isOnDuty, needsAttention } from '../agents/liveness'
import type { AgentInfo, HookEvent, OrderInfo } from '../state/types'

const keyOf = (e: HookEvent) => (e.agent_id ? `agent:${e.agent_id}` : `session:${e.session_id}`)

/** Event time in epoch seconds, or null when the timestamp cannot be read. */
export function eventTime(e: HookEvent): number | null {
  const t = Date.parse(e.ts) / 1000
  return Number.isFinite(t) ? t : null
}

export const isFailure = (e: HookEvent) => e.event.includes('Fail') || !!e.error
export const isPermission = (e: HookEvent) =>
  e.event === 'PermissionRequest' || (e.event === 'Notification' && !!e.notification_type?.includes('permission'))

/** Two event lists merged without duplicates (by id), oldest first. */
export function mergeEvents(a: HookEvent[], b: HookEvent[]): HookEvent[] {
  const m = new Map<number, HookEvent>()
  for (const e of a) m.set(e.id, e)
  for (const e of b) m.set(e.id, e)
  return [...m.values()].sort((x, y) => x.id - y.id)
}

/** The oldest event time in a list: how far back the data reaches. */
export function coverageSince(events: HookEvent[]): number | null {
  let min: number | null = null
  for (const e of events) {
    const t = eventTime(e)
    if (t !== null && (min === null || t < min)) min = t
  }
  return min
}

export interface ActivityBucket { start: number; end: number; events: number; failures: number; permissions: number }

/** Events counted into `count` equal buckets covering the `spanS` seconds that end at `now`. */
export function activityBuckets(events: HookEvent[], now: number, spanS: number, count: number): ActivityBucket[] {
  const size = spanS / count
  const start = now - spanS
  const out: ActivityBucket[] = Array.from({ length: count }, (_, i) => ({
    start: start + i * size, end: start + (i + 1) * size, events: 0, failures: 0, permissions: 0,
  }))
  for (const e of events) {
    const t = eventTime(e)
    if (t === null || t < start || t > now) continue
    const b = out[Math.min(count - 1, Math.floor((t - start) / size))]
    b.events++
    if (isFailure(e)) b.failures++
    if (isPermission(e)) b.permissions++
  }
  return out
}

export interface DepartmentLoad { id: string; onDuty: number; busy: number; attention: number }

/** On-duty agents per department, for the occupancy bars. */
export function departmentLoad(agents: Iterable<AgentInfo>, now: number): Record<string, DepartmentLoad> {
  const m: Record<string, DepartmentLoad> = {}
  for (const a of agents) {
    if (!isOnDuty(a, now)) continue
    const d = (m[a.department] ??= { id: a.department, onDuty: 0, busy: 0, attention: 0 })
    d.onDuty++
    if (needsAttention(a, now)) d.attention++
    else if (!a.stale && (a.status === 'working' || a.status === 'delegating')) d.busy++
  }
  return m
}

// ---------------------------------------------------------------- incidents
export type Severity = 'high' | 'medium' | 'low'
export type IncidentKind = 'turn-failure' | 'tool-failure' | 'permission' | 'guard'
export interface Incident {
  id: string
  ts: number
  severity: Severity
  kind: IncidentKind
  title: string
  detail: string
  /** the roster key of the agent involved, when known */
  agentKey: string | null
  source: 'agent' | 'orders'
}

export const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 }
export const KIND_LABEL: Record<IncidentKind, string> = {
  'turn-failure': 'Failed turn', 'tool-failure': 'Tool failure', permission: 'Authorisation request', guard: 'Orders guard refusal',
}

/** Incidents recorded in hook events: failed turns, failed tools and permission requests. */
export function incidentsFromEvents(events: HookEvent[], agents: Record<string, AgentInfo>): Incident[] {
  const out: Incident[] = []
  for (const e of events) {
    const ts = eventTime(e)
    if (ts === null) continue
    const key = keyOf(e)
    const who = agents[key]?.name ?? e.agent_type ?? `session ${e.session_id.slice(0, 8)}`
    const base = { id: `ev:${e.id}`, ts, agentKey: key, source: 'agent' as const }
    if (e.event === 'StopFailure') {
      out.push({ ...base, severity: 'high', kind: 'turn-failure', title: `${who}: turn failed`, detail: e.error ?? 'No error text reported' })
    } else if (e.event === 'PostToolUseFailure' || (e.tool_name && e.error)) {
      out.push({ ...base, severity: 'medium', kind: 'tool-failure', title: `${who}: ${e.tool_name ?? 'tool'} failed`, detail: [e.tool_target, e.error].filter(Boolean).join(' · ') || 'No error text reported' })
    } else if (isPermission(e)) {
      out.push({ ...base, severity: 'low', kind: 'permission', title: `${who} requested authorisation`, detail: e.tool_name ? `Tool: ${e.tool_name}${e.tool_target ? ` (${e.tool_target})` : ''}` : e.message ?? 'Permission prompt' })
    }
  }
  return out
}

const GUARD_PREFIX = 'Not allowed without your approval'

/** Actions the Orders guard refused (reported as notices in the Commander's chat). */
export function incidentsFromOrders(orders: Record<string, OrderInfo>): Incident[] {
  const out: Incident[] = []
  for (const o of Object.values(orders)) {
    o.messages.forEach((m, i) => {
      if (m.role !== 'notice' || !m.text.startsWith(GUARD_PREFIX)) return
      out.push({
        id: `order:${o.id}:${i}`, ts: m.ts, severity: 'medium', kind: 'guard', source: 'orders', agentKey: o.agent_id,
        title: `Orders guard refused an action · ${o.title || 'order'}`, detail: m.text,
      })
    })
  }
  return out
}

export interface IncidentFilter { query?: string; severity?: Severity | 'all'; kind?: IncidentKind | 'all'; since?: number }

/** Newest first; search covers the title, the detail and the agent's name and role. */
export function filterIncidents(list: Incident[], f: IncidentFilter, agents: Record<string, AgentInfo> = {}): Incident[] {
  const q = (f.query ?? '').trim().toLowerCase()
  return list
    .filter((x) => (f.severity && f.severity !== 'all' ? x.severity === f.severity : true))
    .filter((x) => (f.kind && f.kind !== 'all' ? x.kind === f.kind : true))
    .filter((x) => (f.since !== undefined ? x.ts >= f.since : true))
    .filter((x) => {
      if (!q) return true
      const a = x.agentKey ? agents[x.agentKey] : undefined
      return `${x.title} ${x.detail} ${KIND_LABEL[x.kind]} ${a?.name ?? ''} ${a?.role ?? ''} ${a?.project ?? ''}`.toLowerCase().includes(q)
    })
    .sort((a, b) => b.ts - a.ts)
}

// ---------------------------------------------------------------- alert level
export type AlertLevel = 'unknown' | 'nominal' | 'guarded' | 'elevated' | 'high'
export interface Assessment { level: AlertLevel; score: number; reasons: string[] }

export const ALERT_LABEL: Record<AlertLevel, string> = {
  unknown: 'Unknown', nominal: 'Nominal', guarded: 'Guarded', elevated: 'Elevated', high: 'High',
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * The ISB alert level: a stated rule over confirmed signals, not an external threat feed.
 * Score: 3 per failed agent awaiting you, 1 per agent waiting for authorisation, 1 per tool failure in the last
 * hour (at most 4), 2 per Orders guard refusal in the last hour, 2 when the capture hook is not installed.
 * 0 = nominal, 1–3 guarded, 4–7 elevated, 8+ high. With the link offline the level is unknown.
 */
export function assessAlert(input: {
  connected: boolean
  hookInstalled: boolean | null
  agents: Iterable<AgentInfo>
  incidents: Incident[]
  now: number
}): Assessment {
  if (!input.connected) return { level: 'unknown', score: 0, reasons: ['Agent link offline: the base has no current data to assess.'] }
  let failed = 0
  let waiting = 0
  for (const a of input.agents) {
    if (!needsAttention(a, input.now)) continue
    if (a.status === 'failed') failed++
    else waiting++
  }
  const hour = input.now - 3600
  const tool = input.incidents.filter((x) => x.kind === 'tool-failure' && x.ts >= hour).length
  const guard = input.incidents.filter((x) => x.kind === 'guard' && x.ts >= hour).length
  const reasons: string[] = []
  let score = 0
  if (failed) { score += 3 * failed; reasons.push(`${plural(failed, 'agent')} reporting a failed turn`) }
  if (waiting) { score += waiting; reasons.push(`${plural(waiting, 'agent')} waiting for your authorisation`) }
  if (tool) { score += Math.min(4, tool); reasons.push(`${plural(tool, 'tool failure')} in the last hour`) }
  if (guard) { score += 2 * guard; reasons.push(`${plural(guard, 'Orders guard refusal')} in the last hour`) }
  if (input.hookInstalled === false) { score += 2; reasons.push('Capture hook not installed: new sessions are not reported') }
  const level: AlertLevel = score === 0 ? 'nominal' : score <= 3 ? 'guarded' : score <= 7 ? 'elevated' : 'high'
  if (!reasons.length) reasons.push('No failures, refusals or pending authorisations.')
  return { level, score, reasons }
}

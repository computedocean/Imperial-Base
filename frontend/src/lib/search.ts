// Command search (Ctrl+K): ranking, plus the record entries (agents, missions, events, case files, simulated
// aircraft) built from data the interface already holds. Nothing is fetched for search, so it shows only what the
// panels can already show, and it works (empty) when no data has loaded.
import { dutyOf } from '../agents/liveness'
import type { AgentInfo, HookEvent, TaskInfo } from '../state/types'
import { facilityById } from '../world/layout'
import type { CaseFile } from './cases'

export interface SearchItem {
  id: string
  label: string
  group: string
  /** a short second line: status, department, shortcut… */
  hint?: string
  /** extra words that should match but are not shown */
  keywords?: string
  run: () => void
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/** How well one query token matches an item: 0 = not at all. Label matches beat keyword matches. */
function tokenScore(tok: string, label: string, labelWords: string[], rest: string): number {
  if (label === tok) return 100
  if (label.startsWith(tok)) return 80
  if (labelWords.some((w) => w.startsWith(tok))) return 60
  if (label.includes(tok)) return 40
  if (words(rest).some((w) => w.startsWith(tok))) return 25
  if (rest.includes(tok)) return 15
  return 0
}

/** Every query token must match somewhere; the score is the sum of the token scores. */
export function scoreItem(query: string, item: SearchItem): number {
  const toks = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (!toks.length) return 1
  const label = item.label.toLowerCase()
  const lw = words(item.label)
  const rest = `${item.group} ${item.hint ?? ''} ${item.keywords ?? ''}`.toLowerCase()
  let total = 0
  for (const t of toks) {
    const s = tokenScore(t, label, lw, rest)
    if (!s) return 0
    total += s
  }
  return total
}

/** Best matches first; ties keep the order the items were given in. An empty query returns the first `limit`. */
export function rankItems(query: string, items: SearchItem[], limit = 40): SearchItem[] {
  if (!query.trim()) return items.slice(0, limit)
  return items
    .map((item, i) => ({ item, i, s: scoreItem(query, item) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.item)
}

/** Index of the next option for arrow, Home and End keys in a list or a tab strip (wraps around). */
export function stepIndex(current: number, key: string, count: number, orientation: 'vertical' | 'horizontal' = 'vertical'): number {
  if (count <= 0) return -1
  const next = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight'
  const prev = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft'
  if (key === next) return (current + 1 + count) % count
  if (key === prev) return (current - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return current
}

// ---------------------------------------------------------------- record entries
export type SearchTarget =
  | { kind: 'agent'; id: string }
  | { kind: 'mission'; agentId: string }
  | { kind: 'event'; agentKey: string | null }
  | { kind: 'case'; id: string }
  | { kind: 'aircraft'; id: string }

export interface RecordEntry extends Omit<SearchItem, 'run'> { target: SearchTarget }

export interface RecordInput {
  agents: Record<string, AgentInfo>
  tasks: Record<string, TaskInfo>
  events: HookEvent[]
  cases: CaseFile[]
  /** simulated craft (scenery), already labelled by the caller */
  aircraft: { id: string; label: string; state: string }[]
  now: number
}

const EVENT_LABEL: Record<string, string> = {
  StopFailure: 'Failed turn', PostToolUseFailure: 'Tool failure', PermissionRequest: 'Authorisation request',
  SessionStart: 'Session start', SessionEnd: 'Session end', SubagentStart: 'Subagent deployed', SubagentStop: 'Subagent complete',
}

/** The event's search label, or null for routine tool calls (too many to be useful as search results). */
function eventLabel(e: HookEvent): string | null {
  if (e.event === 'PreToolUse' && (e.tool_name === 'Agent' || e.tool_name === 'Task')) return `Delegation${e.delegation ? `: ${e.delegation}` : ''}`
  if (e.event === 'Notification' && e.notification_type?.includes('permission')) return 'Authorisation request'
  const base = EVENT_LABEL[e.event]
  if (!base) return null
  return e.tool_name && (e.event === 'PostToolUseFailure' || e.event === 'PermissionRequest') ? `${base}: ${e.tool_name}` : base
}

const hhmm = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })
const MAX_AGENTS = 200
const MAX_TASKS = 120
const MAX_EVENTS = 150

/** Search entries for every record type, newest first within each group. Pure: no store, no fetch. */
export function recordEntries(d: RecordInput): RecordEntry[] {
  const out: RecordEntry[] = []
  const agents = Object.values(d.agents).sort((a, b) => b.last_event_at - a.last_event_at).slice(0, MAX_AGENTS)
  for (const a of agents) {
    const duty = dutyOf(a, d.now)
    out.push({
      id: `agent:${a.id}`, group: 'Agents', label: a.name,
      hint: `${a.role} · ${duty === 'attention' ? 'needs you' : duty === 'off' ? 'off duty' : a.status} · ${facilityById[a.department]?.short ?? a.department}${a.project ? ` · ${a.project}` : ''}`,
      keywords: `${a.role} ${a.status} ${a.active_tool ?? ''} ${a.assignment ?? ''} ${a.agent_type ?? ''} ${a.project ?? ''} ${a.department}`,
      target: { kind: 'agent', id: a.id },
    })
  }
  const tasks = Object.values(d.tasks).sort((a, b) => b.started_at - a.started_at).slice(0, MAX_TASKS)
  for (const t of tasks) {
    out.push({
      id: `task:${t.id}`, group: 'Missions', label: t.title,
      hint: `${t.status.replace('_', ' ')} · ${d.agents[t.agent_id]?.name ?? 'agent'}`,
      keywords: `${t.summary ?? ''} ${t.kind} ${t.status}`,
      target: { kind: 'mission', agentId: t.agent_id },
    })
  }
  let shown = 0
  for (let i = d.events.length - 1; i >= 0 && shown < MAX_EVENTS; i--) {
    const e = d.events[i]
    const label = eventLabel(e)
    if (!label) continue
    const ts = Date.parse(e.ts) / 1000
    const key = e.agent_id ? `agent:${e.agent_id}` : `session:${e.session_id}`
    const who = d.agents[key]?.name ?? e.agent_type ?? `session ${e.session_id.slice(0, 8)}`
    out.push({
      id: `event:${e.id}`, group: 'Events', label,
      hint: `${who}${Number.isFinite(ts) ? ` · ${hhmm(ts)}` : ''}`,
      keywords: `${e.event} ${e.tool_name ?? ''} ${e.tool_target ?? ''} ${e.error ?? ''} ${e.agent_type ?? ''} ${e.project ?? ''}`,
      target: { kind: 'event', agentKey: key },
    })
    shown++
  }
  for (const c of [...d.cases].sort((a, b) => b.updated_at - a.updated_at)) {
    out.push({
      id: `case:${c.id}`, group: 'Case files', label: c.title,
      hint: `${c.id} · ${c.status} · ${c.notes.length} note${c.notes.length === 1 ? '' : 's'} · this browser`,
      keywords: `isb investigation ${c.notes.map((n) => n.text).join(' ')}`,
      target: { kind: 'case', id: c.id },
    })
  }
  for (const a of d.aircraft) {
    out.push({ id: `air:${a.id}`, group: 'Aircraft', label: a.label, hint: `SIM · ${a.state}`, keywords: 'aircraft craft scenery simulation follow', target: { kind: 'aircraft', id: a.id } })
  }
  return out
}

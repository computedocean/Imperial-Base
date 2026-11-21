import { describe, expect, it } from 'vitest'
import type { AgentInfo, HookEvent, OrderInfo } from '../state/types'
import {
  activityBuckets, assessAlert, coverageSince, departmentLoad, filterIncidents, incidentsFromEvents, incidentsFromOrders,
  mergeEvents, type Incident,
} from './intel'

const NOW = Date.parse('2026-11-20T12:00:00Z') / 1000
const iso = (secondsAgo: number) => new Date((NOW - secondsAgo) * 1000).toISOString()

function ev(id: number, event: string, secondsAgo: number, extra: Partial<HookEvent> = {}): HookEvent {
  return { id, ts: iso(secondsAgo), event, session_id: 'sess-0001', ...extra }
}

function agent(id: string, extra: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id, kind: 'main', session_id: id, agent_type: null, role: 'Lead Developer', department: 'engineering', name: `Cmdr. ${id}`,
    parent_id: null, project: 'proj', cwd: null, model: null, status: 'working', activity: '', assignment: null, active_tool: null,
    active_tool_target: null, started_at: NOW - 600, last_event_at: NOW - 30, last_event: 'PreToolUse', ended_at: null, tool_calls: 0,
    errors: 0, last_error: null, completion_summary: null, children: [], tokens: null, current_task_id: null, stale: false,
    activity_known: true, duration_s: 600, ...extra,
  }
}

describe('mergeEvents and coverage', () => {
  it('dedupes by id and sorts oldest first', () => {
    const a = [ev(3, 'Stop', 10), ev(1, 'SessionStart', 300)]
    const b = [ev(2, 'PreToolUse', 100), ev(3, 'Stop', 10)]
    expect(mergeEvents(a, b).map((e) => e.id)).toEqual([1, 2, 3])
  })
  it('reports the oldest readable timestamp', () => {
    expect(coverageSince([ev(1, 'Stop', 50), ev(2, 'Stop', 500), { ...ev(3, 'Stop', 0), ts: 'garbage' }])).toBe(NOW - 500)
    expect(coverageSince([])).toBeNull()
  })
})

describe('activityBuckets', () => {
  it('counts events, failures and permission requests into the right bucket', () => {
    const events = [
      ev(1, 'PreToolUse', 30), ev(2, 'PostToolUseFailure', 40, { tool_name: 'Bash', error: 'exit 1' }),
      ev(3, 'PermissionRequest', 330), ev(4, 'Stop', 3599),
      ev(5, 'Stop', 4000), // outside the hour
      { ...ev(6, 'Stop', 0), ts: 'not a date' },
    ]
    const b = activityBuckets(events, NOW, 3600, 12)
    expect(b).toHaveLength(12)
    expect(b.reduce((n, x) => n + x.events, 0)).toBe(4)
    expect(b[11]).toMatchObject({ events: 2, failures: 1, permissions: 0 })
    expect(b[10]).toMatchObject({ events: 1, permissions: 1 })
    expect(b[0].events).toBe(1)
    expect(b[0].start).toBe(NOW - 3600)
    expect(b[11].end).toBe(NOW)
  })
})

describe('incidents', () => {
  const agents = { 'session:sess-0001': agent('session:sess-0001', { name: 'Cmdr. Korda-41' }) }
  const events = [
    ev(1, 'StopFailure', 60, { error: 'rate limited' }),
    ev(2, 'PostToolUseFailure', 120, { tool_name: 'Edit', tool_target: 'app.py', error: 'no match' }),
    ev(3, 'PermissionRequest', 180, { tool_name: 'Bash' }),
    ev(4, 'Notification', 200, { notification_type: 'permission_prompt' }),
    ev(5, 'Notification', 210, { notification_type: 'idle_prompt' }),
    ev(6, 'PreToolUse', 220, { tool_name: 'Read' }),
  ]
  it('classifies failed turns, tool failures and permission requests, and nothing else', () => {
    const list = incidentsFromEvents(events, agents)
    expect(list.map((x) => [x.kind, x.severity])).toEqual([
      ['turn-failure', 'high'], ['tool-failure', 'medium'], ['permission', 'low'], ['permission', 'low'],
    ])
    expect(list[0].title).toBe('Cmdr. Korda-41: turn failed')
    expect(list[1].detail).toBe('app.py · no match')
    expect(list[0].agentKey).toBe('session:sess-0001')
  })
  it('reads Orders guard refusals from notices only', () => {
    const order: OrderInfo = {
      id: 'o1', session_id: 's', agent_id: 'session:s', title: 'Tidy notes', status: 'idle', created_at: NOW - 100, updated_at: NOW - 10, turns: 1,
      messages: [
        { role: 'commander', text: 'Not allowed without your approval: pretend', ts: NOW - 90 },
        { role: 'notice', text: 'Not allowed without your approval: Write C:/Windows/x', ts: NOW - 50 },
        { role: 'notice', text: 'Stopped by the Commander.', ts: NOW - 40 },
      ],
    }
    const list = incidentsFromOrders({ o1: order })
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ kind: 'guard', severity: 'medium', agentKey: 'session:s', ts: NOW - 50, source: 'orders' })
  })
  it('filters by severity, kind, time and text, newest first', () => {
    const list = incidentsFromEvents(events, agents)
    expect(filterIncidents(list, { severity: 'low' }).map((x) => x.id)).toEqual(['ev:3', 'ev:4'])
    expect(filterIncidents(list, { kind: 'tool-failure' }).map((x) => x.id)).toEqual(['ev:2'])
    expect(filterIncidents(list, { since: NOW - 130 }).map((x) => x.id)).toEqual(['ev:1', 'ev:2'])
    expect(filterIncidents(list, { query: 'APP.PY' }).map((x) => x.id)).toEqual(['ev:2'])
    expect(filterIncidents(list, { query: 'korda' }, agents)).toHaveLength(4)
    expect(filterIncidents(list, { query: 'nothing like this' })).toHaveLength(0)
  })
})

describe('assessAlert', () => {
  const inc = (kind: Incident['kind'], secondsAgo: number): Incident => ({ id: `${kind}${secondsAgo}`, ts: NOW - secondsAgo, kind, severity: 'medium', title: '', detail: '', agentKey: null, source: 'agent' })

  it('is unknown when the link is down, whatever else is true', () => {
    const a = assessAlert({ connected: false, hookInstalled: false, agents: [agent('x', { status: 'failed' })], incidents: [], now: NOW })
    expect(a.level).toBe('unknown')
  })
  it('is nominal with nothing to report', () => {
    const a = assessAlert({ connected: true, hookInstalled: true, agents: [agent('x')], incidents: [], now: NOW })
    expect(a).toMatchObject({ level: 'nominal', score: 0 })
  })
  it('scores waiting and failed agents, recent tool failures (capped) and guard refusals', () => {
    const agents = [agent('a', { status: 'waiting' }), agent('b', { status: 'failed' })]
    const incidents = [...Array.from({ length: 6 }, (_, i) => inc('tool-failure', 60 + i)), inc('tool-failure', 7200), inc('guard', 100)]
    const a = assessAlert({ connected: true, hookInstalled: true, agents, incidents, now: NOW })
    // 1 waiting + 3 failed + min(4, 6) tool + 2 guard = 10
    expect(a.score).toBe(10)
    expect(a.level).toBe('high')
    expect(a.reasons).toContain('6 tool failures in the last hour')
  })
  it('ignores stale attention (older than the attention window) and counts a missing hook', () => {
    const old = agent('a', { status: 'waiting', last_event_at: NOW - 2 * 3600 })
    const a = assessAlert({ connected: true, hookInstalled: false, agents: [old], incidents: [], now: NOW })
    expect(a).toMatchObject({ level: 'guarded', score: 2 })
  })
  it('crosses into elevated at 4', () => {
    const a = assessAlert({ connected: true, hookInstalled: true, agents: [agent('b', { status: 'failed' }), agent('c', { status: 'waiting' })], incidents: [], now: NOW })
    expect(a).toMatchObject({ level: 'elevated', score: 4 })
  })
})

describe('departmentLoad', () => {
  it('counts on-duty agents only, split into busy and attention', () => {
    const m = departmentLoad([
      agent('a'), agent('b', { status: 'waiting' }), agent('c', { status: 'completed' }),
      agent('d', { department: 'security', status: 'idle' }), agent('e', { stale: true }),
    ], NOW)
    expect(m.engineering).toEqual({ id: 'engineering', onDuty: 3, busy: 1, attention: 1 })
    expect(m.security).toEqual({ id: 'security', onDuty: 1, busy: 0, attention: 0 })
  })
})

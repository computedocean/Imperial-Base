import { describe, expect, it } from 'vitest'
import type { AgentInfo } from '../state/types'
import { describeEvent } from '../state/store'
import { ATTENTION_WINDOW_S, HIDE_AFTER_S, UNENGAGED_GRACE_S, dutyCounts, dutyOf, isOnDuty, rosterRank, statsSince } from './liveness'

const NOW = 1_800_000_000
function agent(over: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'session:a', kind: 'main', session_id: 'a', agent_type: 'main', role: 'Lead Developer', department: 'engineering',
    name: 'Cmdr. Test-10', parent_id: null, project: 'demo', cwd: null, model: null, status: 'working', activity: '',
    assignment: null, active_tool: null, active_tool_target: null, started_at: NOW - 100, last_event_at: NOW - 5,
    last_event: 'PreToolUse', ended_at: null, tool_calls: 3, errors: 0, last_error: null, completion_summary: null,
    children: [], tokens: null, current_task_id: null, stale: false, activity_known: true, duration_s: 100, engaged: true,
    ...over,
  }
}

describe('duty classification', () => {
  it('counts a confirmed working agent as busy and an idle one as standby', () => {
    expect(dutyOf(agent(), NOW)).toBe('busy')
    expect(dutyOf(agent({ status: 'delegating' }), NOW)).toBe('busy')
    expect(dutyOf(agent({ status: 'idle' }), NOW)).toBe('standby')
    expect(dutyOf(agent({ status: 'active' }), NOW)).toBe('standby')
  })

  it('does not call a stale agent busy: its activity is unknown', () => {
    expect(dutyOf(agent({ stale: true, last_event_at: NOW - 3600 }), NOW)).toBe('standby')
  })

  it('takes signed-off, long-silent and never-used sessions off duty', () => {
    expect(isOnDuty(agent({ status: 'disconnected' }), NOW)).toBe(false)
    expect(isOnDuty(agent({ status: 'completed' }), NOW)).toBe(false)
    expect(isOnDuty(agent({ status: 'idle', last_event_at: NOW - HIDE_AFTER_S - 1 }), NOW)).toBe(false)
    const ghost = { status: 'active' as const, engaged: false, tool_calls: 0 }
    expect(isOnDuty(agent({ ...ghost, last_event_at: NOW - 60 }), NOW)).toBe(true) // just opened: still on the base
    expect(isOnDuty(agent({ ...ghost, last_event_at: NOW - UNENGAGED_GRACE_S - 1 }), NOW)).toBe(false)
  })

  it('flags waiting and failed agents for attention, but not abandoned ones', () => {
    expect(dutyOf(agent({ status: 'waiting' }), NOW)).toBe('attention')
    expect(dutyOf(agent({ status: 'failed' }), NOW)).toBe('attention')
    expect(dutyOf(agent({ status: 'waiting', stale: true, last_event_at: NOW - ATTENTION_WINDOW_S - 1 }), NOW)).toBe('standby')
  })

  it('counts each on-duty agent exactly once', () => {
    const c = dutyCounts([agent(), agent({ status: 'idle' }), agent({ status: 'waiting' }), agent({ status: 'disconnected' })], NOW)
    expect(c).toEqual({ attention: 1, busy: 1, standby: 1, onDuty: 3 })
  })
})

describe('roster order and day statistics', () => {
  it('ranks a lead by its most urgent subagent', () => {
    const child = agent({ id: 'agent:c', kind: 'subagent', status: 'waiting', parent_id: 'session:a' })
    const lead = agent({ status: 'idle', children: ['agent:c'] })
    const other = agent({ id: 'session:b', status: 'working' })
    const all = { [lead.id]: lead, [child.id]: child, [other.id]: other }
    expect(rosterRank(lead, all, NOW)).toBeLessThan(rosterRank(other, all, NOW))
  })

  it('sums only agents seen since the cut-off and skips never-used sessions', () => {
    const s = statsSince([
      agent({ tokens: { total_tokens: 1000 } }),
      agent({ id: 'agent:c', kind: 'subagent', tool_calls: 2, errors: 1 }),
      agent({ id: 'session:g', engaged: false, tool_calls: 0 }),
      agent({ id: 'session:old', last_event_at: NOW - 90000, tool_calls: 99 }),
    ], NOW - 86400)
    expect(s).toEqual({ sessions: 1, subagents: 1, toolCalls: 5, errors: 1, tokens: 1000 })
  })
})

describe('feed lines', () => {
  it('announces a permission request with the tool that is blocked', () => {
    const a = agent()
    const line = describeEvent({ id: 1, ts: '', event: 'PermissionRequest', session_id: 'a', tool_name: 'Bash' }, { [a.id]: a })
    expect(line?.tone).toBe('warn')
    expect(line?.text).toContain('Bash')
  })
})

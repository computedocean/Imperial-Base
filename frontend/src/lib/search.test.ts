import { describe, expect, it } from 'vitest'
import { rankItems, recordEntries, scoreItem, stepIndex, type SearchItem } from './search'
import { demoData } from './demo'
import type { CaseFile } from './cases'

const item = (id: string, label: string, group = 'Agents', keywords = ''): SearchItem => ({ id, label, group, keywords, run: () => {} })

describe('command search ranking', () => {
  const items = [
    item('a1', 'Cmdr. Korda-41', 'Agents', 'lead developer engineering working'),
    item('a2', 'Lt. Varrin-22', 'Agents', 'code reviewer security failed'),
    item('f1', 'Security Operations Center', 'Facilities', 'security isb'),
    item('p1', 'ISB', 'Panels', 'imperial security bureau intelligence incidents'),
    item('t1', 'Hangar', 'Tours'),
  ]
  it('returns everything in order for an empty query', () => {
    expect(rankItems('  ', items).map((x) => x.id)).toEqual(['a1', 'a2', 'f1', 'p1', 't1'])
  })
  it('prefers label matches over keyword matches', () => {
    // the facility matches on its label; the other two only on keywords, so they keep their given order
    expect(rankItems('security', items).map((x) => x.id)).toEqual(['f1', 'a2', 'p1'])
  })
  it('requires every token to match', () => {
    expect(rankItems('security failed', items).map((x) => x.id)).toEqual(['a2'])
    expect(rankItems('korda nonsense', items)).toEqual([])
  })
  it('matches word starts inside labels and is case-insensitive', () => {
    expect(rankItems('VARR', items)[0].id).toBe('a2')
    expect(rankItems('ops', items)).toEqual([]) // not a word start or substring of anything
    expect(rankItems('operations', items)[0].id).toBe('f1')
  })
  it('scores exact > prefix > word start > substring', () => {
    const exact = scoreItem('isb', item('x', 'ISB'))
    const prefix = scoreItem('isb', item('x', 'ISB files'))
    const wordStart = scoreItem('isb', item('x', 'Open ISB'))
    const sub = scoreItem('isb', item('x', 'Crisbane'))
    expect(exact).toBeGreaterThan(prefix)
    expect(prefix).toBeGreaterThan(wordStart)
    expect(wordStart).toBeGreaterThan(sub)
    expect(sub).toBeGreaterThan(0)
  })
  it('respects the limit', () => {
    expect(rankItems('', items, 2)).toHaveLength(2)
  })
})

describe('stepIndex (keyboard navigation for lists and tab strips)', () => {
  it('moves and wraps vertically', () => {
    expect(stepIndex(0, 'ArrowDown', 3)).toBe(1)
    expect(stepIndex(2, 'ArrowDown', 3)).toBe(0)
    expect(stepIndex(0, 'ArrowUp', 3)).toBe(2)
    expect(stepIndex(1, 'Home', 3)).toBe(0)
    expect(stepIndex(1, 'End', 3)).toBe(2)
    expect(stepIndex(1, 'ArrowRight', 3)).toBe(1)
  })
  it('uses left and right for horizontal strips', () => {
    expect(stepIndex(0, 'ArrowRight', 4, 'horizontal')).toBe(1)
    expect(stepIndex(0, 'ArrowLeft', 4, 'horizontal')).toBe(3)
    expect(stepIndex(0, 'ArrowDown', 4, 'horizontal')).toBe(0)
  })
  it('returns -1 for an empty list', () => {
    expect(stepIndex(0, 'ArrowDown', 0)).toBe(-1)
  })
})

describe('recordEntries (agents, missions, events, case files, aircraft)', () => {
  const now = 1_800_000_000
  const d = demoData(now)
  const agents = Object.fromEntries(d.agents.map((a) => [a.id, a]))
  const tasks = Object.fromEntries(d.tasks.map((t) => [t.id, t]))
  const cases: CaseFile[] = [{
    id: 'ISB-1', title: 'Repeated test timeouts', agentKey: 'agent:demo-t1', incidentIds: ['ev:1'], status: 'open',
    opened_at: now - 100, updated_at: now - 50, notes: [{ ts: now - 50, text: 'Runner limit is 300 s' }],
  }]
  const aircraft = [{ id: 'shuttle', label: 'Imperial shuttle', state: 'on the pad' }]
  const entries = recordEntries({ agents, tasks, events: d.events, cases, aircraft, now })
  const groups = (g: string) => entries.filter((e) => e.group === g)

  it('does not crash and returns nothing when no data is loaded', () => {
    expect(recordEntries({ agents: {}, tasks: {}, events: [], cases: [], aircraft: [], now })).toEqual([])
  })

  it('covers every record type', () => {
    expect(groups('Agents')).toHaveLength(d.agents.length)
    expect(groups('Missions')).toHaveLength(d.tasks.length)
    expect(groups('Events').length).toBeGreaterThan(0)
    expect(groups('Case files')).toHaveLength(1)
    expect(groups('Aircraft')).toHaveLength(1)
  })

  it('labels simulated aircraft as SIM and case files as browser-local', () => {
    expect(groups('Aircraft')[0].hint).toMatch(/^SIM/)
    expect(groups('Case files')[0].hint).toMatch(/this browser/)
  })

  it('finds a failed turn by its error text and points at the agent', () => {
    const items = entries.map((e) => ({ ...e, run: () => {} }))
    const hit = rankItems('time limit', items).find((i) => i.group === 'Events')
    expect(hit).toBeDefined()
    const entry = entries.find((e) => e.id === hit!.id)!
    expect(entry.target).toEqual({ kind: 'event', agentKey: 'agent:demo-t1' })
  })

  it('finds a case file by its title and by a word in its notes', () => {
    const items = entries.map((e) => ({ ...e, run: () => {} }))
    expect(rankItems('timeouts', items)[0].id).toBe('case:ISB-1')
    expect(rankItems('300', items).some((i) => i.id === 'case:ISB-1')).toBe(true)
  })

  it('keeps only meaningful events, newest first', () => {
    const ev = groups('Events')
    expect(ev.every((e) => !e.label.startsWith('PreToolUse'))).toBe(true)
    expect(ev[0].label).toMatch(/PermissionRequest|Authorisation/)
  })
})

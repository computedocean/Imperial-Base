import { describe, expect, it } from 'vitest'
import { demoData, isDemoUrl } from './demo'
import { incidentsFromEvents } from './intel'

const NOW = 1_800_000_000

describe('demo mode', () => {
  it('is only on for an explicit ?demo=1 or ?demo=true', () => {
    expect(isDemoUrl('?demo=1')).toBe(true)
    expect(isDemoUrl('?x=2&demo=true')).toBe(true)
    expect(isDemoUrl('')).toBe(false)
    expect(isDemoUrl('?demo=0')).toBe(false)
    expect(isDemoUrl('?demo')).toBe(false)
  })

  const d = demoData(NOW)
  const byId = Object.fromEntries(d.agents.map((a) => [a.id, a]))

  it('labels every assignment, task and error as demo', () => {
    for (const a of d.agents) expect(a.assignment).toMatch(/\(demo\)$/)
    for (const t of d.tasks) expect(t.title).toMatch(/\(demo\)$/)
    for (const e of d.events) if (e.error) expect(e.error).toMatch(/\(demo\)/)
    for (const p of d.agents.map((a) => a.project)) expect(p).toMatch(/^demo-/)
    expect(d.ordersInfo.enabled).toBe(false)
  })

  it('keeps parent and child links consistent', () => {
    for (const a of d.agents) {
      for (const c of a.children) expect(byId[c]?.parent_id).toBe(a.id)
      if (a.parent_id) expect(byId[a.parent_id]?.children).toContain(a.id)
    }
    for (const t of d.tasks) expect(byId[t.agent_id]).toBeDefined()
  })

  it('has unique, ordered event ids within the last hour', () => {
    const ids = d.events.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
    for (const e of d.events) {
      const t = Date.parse(e.ts) / 1000
      expect(t).toBeLessThanOrEqual(NOW)
      expect(t).toBeGreaterThan(NOW - 3600)
    }
  })

  it('contains each kind of incident the ISB panel shows', () => {
    const kinds = new Set(incidentsFromEvents(d.events, byId).map((x) => x.kind))
    expect(kinds).toEqual(new Set(['turn-failure', 'tool-failure', 'permission']))
  })
})

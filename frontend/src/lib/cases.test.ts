import { describe, expect, it } from 'vitest'
import { MAX_CASES, MAX_NOTE_CHARS, addNote, linkIncident, openCase, parseCases, removeCase, setCaseStatus, type CaseFile } from './cases'

const T = 1_800_000_000

describe('case files', () => {
  it('opens a case newest first with a fallback title and an optional incident', () => {
    let c = openCase([], { title: '  ', agentKey: 'session:a' }, T, 'c1')
    c = openCase(c, { title: 'Tool failures on Engineering', incidentId: 'ev:9' }, T + 1, 'c2')
    expect(c.map((x) => x.id)).toEqual(['c2', 'c1'])
    expect(c[1]).toMatchObject({ title: 'Untitled investigation', agentKey: 'session:a', status: 'open', incidentIds: [] })
    expect(c[0].incidentIds).toEqual(['ev:9'])
  })

  it('adds trimmed, length-limited notes and ignores empty ones', () => {
    let c = openCase([], { title: 'x' }, T, 'c1')
    c = addNote(c, 'c1', '   ', T + 5)
    expect(c[0].notes).toHaveLength(0)
    c = addNote(c, 'c1', `  ${'a'.repeat(MAX_NOTE_CHARS + 50)}  `, T + 6)
    expect(c[0].notes[0].text).toHaveLength(MAX_NOTE_CHARS)
    expect(c[0].updated_at).toBe(T + 6)
  })

  it('closes, reopens, links incidents once and removes', () => {
    let c = openCase([], { title: 'x' }, T, 'c1')
    c = setCaseStatus(c, 'c1', 'closed', T + 1)
    expect(c[0].status).toBe('closed')
    const same = setCaseStatus(c, 'c1', 'closed', T + 2)
    expect(same[0].updated_at).toBe(T + 1)
    c = linkIncident(c, 'c1', 'ev:1', T + 3)
    c = linkIncident(c, 'c1', 'ev:1', T + 4)
    expect(c[0].incidentIds).toEqual(['ev:1'])
    expect(removeCase(c, 'c1')).toEqual([])
  })

  it('makes room by dropping the oldest closed case first', () => {
    let c: CaseFile[] = []
    for (let i = 0; i < MAX_CASES; i++) c = openCase(c, { title: `case ${i}` }, T + i, `c${i}`)
    c = setCaseStatus(c, 'c5', 'closed', T + 500)
    c = openCase(c, { title: 'one more' }, T + 600, 'new')
    expect(c).toHaveLength(MAX_CASES)
    expect(c.find((x) => x.id === 'c5')).toBeUndefined()
    expect(c.find((x) => x.id === 'c0')).toBeDefined()
    c = openCase(c, { title: 'and another' }, T + 700, 'new2')
    expect(c.find((x) => x.id === 'c0')).toBeUndefined() // no closed case left: the oldest goes
  })

  it('parses stored data defensively', () => {
    expect(parseCases(null)).toEqual([])
    expect(parseCases('not json')).toEqual([])
    expect(parseCases('{"a":1}')).toEqual([])
    const good = { id: 'c1', title: 't', status: 'open', opened_at: T, updated_at: T, agentKey: 'session:x', incidentIds: ['ev:1', 5], notes: [{ ts: T, text: 'n' }, { ts: 'x', text: 'bad' }] }
    const bad = [{ id: 'c2', title: 't', status: 'weird', opened_at: T, updated_at: T }, { title: 'no id' }, null, 'str']
    const out = parseCases(JSON.stringify([good, ...bad]))
    expect(out).toHaveLength(1)
    expect(out[0].incidentIds).toEqual(['ev:1'])
    expect(out[0].notes).toEqual([{ ts: T, text: 'n' }])
  })
})

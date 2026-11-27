// ISB case files: investigations the Commander opens on an agent or an incident, with dated notes.
// Kept in this browser only (localStorage), never sent to the backend. Demo mode uses its own key so demo
// cases never mix with real ones. Notes are rendered as plain text.
import { create } from 'zustand'

export interface CaseNote { ts: number; text: string }
export interface CaseFile {
  id: string
  title: string
  agentKey: string | null
  incidentIds: string[]
  status: 'open' | 'closed'
  opened_at: number
  updated_at: number
  notes: CaseNote[]
}

export const MAX_CASES = 100
export const MAX_NOTES = 200
export const MAX_NOTE_CHARS = 2000
export const MAX_TITLE_CHARS = 120

const clip = (s: string, n: number) => s.trim().slice(0, n)

export function openCase(cases: CaseFile[], init: { title: string; agentKey?: string | null; incidentId?: string | null }, now: number, id: string): CaseFile[] {
  const title = clip(init.title, MAX_TITLE_CHARS) || 'Untitled investigation'
  const c: CaseFile = {
    id, title, agentKey: init.agentKey ?? null, incidentIds: init.incidentId ? [init.incidentId] : [], status: 'open',
    opened_at: now, updated_at: now, notes: [],
  }
  // the newest first; the oldest closed cases make room when the limit is reached
  const next = [c, ...cases]
  while (next.length > MAX_CASES) {
    const i = next.map((x) => x.status).lastIndexOf('closed')
    next.splice(i > 0 ? i : next.length - 1, 1)
  }
  return next
}

function update(cases: CaseFile[], id: string, fn: (c: CaseFile) => CaseFile | null): CaseFile[] {
  return cases.map((c) => (c.id === id ? fn(c) ?? c : c))
}

export function addNote(cases: CaseFile[], id: string, text: string, now: number): CaseFile[] {
  const t = clip(text, MAX_NOTE_CHARS)
  if (!t) return cases
  return update(cases, id, (c) => ({ ...c, notes: [...c.notes, { ts: now, text: t }].slice(-MAX_NOTES), updated_at: now }))
}

export function setCaseStatus(cases: CaseFile[], id: string, status: CaseFile['status'], now: number): CaseFile[] {
  return update(cases, id, (c) => (c.status === status ? null : { ...c, status, updated_at: now }))
}

export function linkIncident(cases: CaseFile[], id: string, incidentId: string, now: number): CaseFile[] {
  return update(cases, id, (c) => (c.incidentIds.includes(incidentId) ? null : { ...c, incidentIds: [...c.incidentIds, incidentId].slice(-200), updated_at: now }))
}

export function removeCase(cases: CaseFile[], id: string): CaseFile[] {
  return cases.filter((c) => c.id !== id)
}

const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Stored cases, validated field by field; anything malformed is dropped rather than trusted. */
export function parseCases(raw: string | null): CaseFile[] {
  if (!raw) return []
  let data: unknown
  try { data = JSON.parse(raw) } catch { return [] }
  if (!Array.isArray(data)) return []
  const out: CaseFile[] = []
  for (const c of data.slice(0, MAX_CASES)) {
    if (!c || typeof c !== 'object') continue
    const x = c as Record<string, unknown>
    if (!isStr(x.id) || !isStr(x.title) || !isNum(x.opened_at) || !isNum(x.updated_at)) continue
    if (x.status !== 'open' && x.status !== 'closed') continue
    const notes = Array.isArray(x.notes)
      ? x.notes.filter((n): n is CaseNote => !!n && isNum((n as CaseNote).ts) && isStr((n as CaseNote).text))
          .slice(-MAX_NOTES).map((n) => ({ ts: n.ts, text: n.text.slice(0, MAX_NOTE_CHARS) }))
      : []
    out.push({
      id: x.id.slice(0, 64), title: x.title.slice(0, MAX_TITLE_CHARS), status: x.status, opened_at: x.opened_at, updated_at: x.updated_at,
      agentKey: isStr(x.agentKey) ? x.agentKey.slice(0, 200) : null,
      incidentIds: Array.isArray(x.incidentIds) ? x.incidentIds.filter(isStr).slice(-200) : [],
      notes,
    })
  }
  return out
}

// ---------------------------------------------------------------- store (browser persistence)
const storageKey = (demo: boolean) => (demo ? 'imperial.isb.cases.demo' : 'imperial.isb.cases')

function load(demo: boolean): CaseFile[] {
  try { return parseCases(localStorage.getItem(storageKey(demo))) } catch { return [] }
}

function newId() {
  const r = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `ISB-${Date.now().toString(36).toUpperCase().slice(-5)}-${r}`
}

interface CaseState {
  demo: boolean
  cases: CaseFile[]
  /** the case the ISB panel should show (set by command search); null shows the list */
  focusId: string | null
  focus(id: string | null): void
  /** switch between the real and the demo case book */
  useBook(demo: boolean): void
  open(init: { title: string; agentKey?: string | null; incidentId?: string | null }): string
  note(id: string, text: string): void
  setStatus(id: string, status: CaseFile['status']): void
  link(id: string, incidentId: string): void
  remove(id: string): void
}

export const useCases = create<CaseState>((set, get) => {
  const commit = (cases: CaseFile[]) => {
    try { localStorage.setItem(storageKey(get().demo), JSON.stringify(cases)) } catch { /* storage full or blocked: keep in memory */ }
    set({ cases })
  }
  const now = () => Date.now() / 1000
  return {
    demo: false,
    cases: load(false),
    focusId: null,
    focus(id) { set({ focusId: id }) },
    useBook(demo) { if (demo !== get().demo) set({ demo, cases: load(demo), focusId: null }) },
    open(init) { const id = newId(); commit(openCase(get().cases, init, now(), id)); return id },
    note(id, text) { commit(addNote(get().cases, id, text, now())) },
    setStatus(id, status) { commit(setCaseStatus(get().cases, id, status, now())) },
    link(id, incidentId) { commit(linkIncident(get().cases, id, incidentId, now())) },
    remove(id) { commit(removeCase(get().cases, id)); if (get().focusId === id) set({ focusId: null }) },
  }
})

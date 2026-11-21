// Imperial Security Bureau: the base's internal security and intelligence desk. Everything here is derived from
// confirmed signals (hook events, agent state, Orders notices). Case files are the Commander's own notes, kept in
// this browser. Simulated contacts are scenery and tagged SIM.
import { useEffect, useMemo, useState } from 'react'
import { isOnDuty } from '../agents/liveness'
import { useCases, type CaseFile } from '../lib/cases'
import { useEventHistory } from '../lib/history'
import {
  ALERT_LABEL, KIND_LABEL, assessAlert, filterIncidents, incidentsFromEvents, incidentsFromOrders, type Incident, type IncidentKind, type Severity,
} from '../lib/intel'
import { useSimStatus } from '../sim/world'
import { useStore } from '../state/store'
import { facilityById } from '../world/layout'
import { Chips, Empty, SearchField, SectionHead, Skeleton, SourceTag, StatusDot, ago, useTick } from './common'
import { IconCheck, IconFolder, IconPlus, IconShield } from './icons'

type View = 'incidents' | 'cases' | 'posture'
type Window = '1h' | '24h' | 'all'

function useIncidents() {
  const agents = useStore((s) => s.agents)
  const orders = useStore((s) => s.orders)
  const { events, loading, error } = useEventHistory()
  const incidents = useMemo(() => [...incidentsFromEvents(events, agents), ...incidentsFromOrders(orders)], [events, agents, orders])
  return { incidents, loading, error }
}

// ---------------------------------------------------------------- alert level
function AlertLevelCard({ incidents }: { incidents: Incident[] }) {
  useTick(15000)
  const connected = useStore((s) => s.connected)
  const demo = useStore((s) => s.demo)
  const agents = useStore((s) => s.agents)
  const ingest = useStore((s) => s.ingest)
  const a = assessAlert({ connected: connected || demo, hookInstalled: demo ? true : ingest?.hook_installed ?? null, agents: Object.values(agents), incidents, now: Date.now() / 1000 })
  return (
    <section className={`card alert-level lvl-${a.level}`} aria-live="polite">
      <div className="al-row">
        <IconShield size={22} />
        <div className="al-main">
          <div className="al-kicker">ISB alert level {demo && <SourceTag kind="demo" />}</div>
          <div className="al-value">{ALERT_LABEL[a.level]}</div>
        </div>
        <div className="al-scale" aria-hidden="true">
          {(['nominal', 'guarded', 'elevated', 'high'] as const).map((l) => <span key={l} className={l === a.level ? 'on' : ''} />)}
        </div>
      </div>
      <ul className="al-reasons">{a.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      <details className="al-rule">
        <summary>How the level is set</summary>
        <p>A fixed rule over confirmed signals, not an external threat feed: 3 points per agent reporting a failed turn,
          1 per agent waiting for authorisation, 1 per tool failure in the last hour (at most 4), 2 per Orders guard refusal
          in the last hour, and 2 if the capture hook is not installed. 0 is nominal, 1 to 3 guarded, 4 to 7 elevated,
          8 or more high. With the agent link offline the level is unknown.</p>
      </details>
    </section>
  )
}

// ---------------------------------------------------------------- incidents
const SEV_OPTS = (counts: Record<Severity | 'all', number>) => [
  ['all', 'All', counts.all], ['high', 'High', counts.high], ['medium', 'Medium', counts.medium], ['low', 'Low', counts.low],
] as const

function CaseMenu({ incident, onDone }: { incident: Incident; onDone: () => void }) {
  const cases = useCases((s) => s.cases)
  const { open, link } = useCases()
  const agents = useStore((s) => s.agents)
  const openCases = cases.filter((c) => c.status === 'open')
  const agentName = incident.agentKey ? agents[incident.agentKey]?.name : undefined
  return (
    <div className="case-menu" role="group" aria-label="File this incident">
      <button type="button" className="btn sm" onClick={() => { open({ title: agentName ? `${agentName}: ${KIND_LABEL[incident.kind].toLowerCase()}` : incident.title, agentKey: incident.agentKey, incidentId: incident.id }); onDone() }}>
        <IconPlus size={12} /> New case
      </button>
      {openCases.slice(0, 5).map((c) => (
        <button key={c.id} type="button" className="btn ghost sm" disabled={c.incidentIds.includes(incident.id)} onClick={() => { link(c.id, incident.id); onDone() }} title={`Add to ${c.title}`}>
          {c.incidentIds.includes(incident.id) ? <IconCheck size={12} /> : <IconFolder size={12} />} {c.title.length > 26 ? `${c.title.slice(0, 25)}…` : c.title}
        </button>
      ))}
    </div>
  )
}

function IncidentRow({ x }: { x: Incident }) {
  const agents = useStore((s) => s.agents)
  const select = useStore((s) => s.select)
  const [filing, setFiling] = useState(false)
  const a = x.agentKey ? agents[x.agentKey] : undefined
  return (
    <li className={`incident sev-${x.severity}`}>
      <div className="inc-head">
        <span className={`sev-badge sev-${x.severity}`}>{x.severity}</span>
        <span className="inc-kind">{KIND_LABEL[x.kind]}</span>
        <time className="inc-time" dateTime={new Date(x.ts * 1000).toISOString()} title={new Date(x.ts * 1000).toLocaleString()}>{ago(x.ts)}</time>
      </div>
      <div className="inc-title">{x.title}</div>
      <div className="inc-detail">{x.detail}</div>
      <div className="inc-actions">
        {a && <button type="button" className="btn ghost sm" onClick={() => select({ kind: 'agent', id: a.id })}>Inspect {a.name}</button>}
        <button type="button" className="btn ghost sm" aria-expanded={filing} onClick={() => setFiling((v) => !v)}><IconFolder size={12} /> File to case</button>
      </div>
      {filing && <CaseMenu incident={x} onDone={() => setFiling(false)} />}
    </li>
  )
}

function IncidentsView({ incidents, loading, error }: { incidents: Incident[]; loading: boolean; error: string | null }) {
  useTick(15000)
  const agents = useStore((s) => s.agents)
  const [query, setQuery] = useState('')
  const [sev, setSev] = useState<Severity | 'all'>('all')
  const [kind, setKind] = useState<IncidentKind | 'all'>('all')
  const [win, setWin] = useState<Window>('24h')
  const now = Date.now() / 1000
  const since = win === '1h' ? now - 3600 : win === '24h' ? now - 86400 : undefined
  const scoped = useMemo(() => filterIncidents(incidents, { since, kind, query }, agents), [incidents, since, kind, query, agents])
  const counts = { all: scoped.length, high: 0, medium: 0, low: 0 }
  for (const x of scoped) counts[x.severity]++
  const list = sev === 'all' ? scoped : scoped.filter((x) => x.severity === sev)
  return (
    <>
      <div className="panel-tools">
        <SearchField value={query} onChange={setQuery} label="Search incidents, agents, tools" />
        <Chips label="Severity" value={sev} onChange={setSev} options={SEV_OPTS(counts)} />
        <div className="tool-row">
          <Chips label="Time window" value={win} onChange={setWin} options={[['1h', '1 h'], ['24h', '24 h'], ['all', 'All loaded']] as const} />
          <label className="select-label">
            <span className="sr-only">Incident type</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as IncidentKind | 'all')} aria-label="Incident type">
              <option value="all">All types</option>
              {(Object.keys(KIND_LABEL) as IncidentKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </label>
        </div>
      </div>
      {error && <div className="notice warn" role="status">Stored history unavailable ({error}). Showing incidents from live events only.</div>}
      {loading ? <Skeleton rows={5} /> : list.length === 0 ? (
        <Empty title={incidents.length ? 'No incidents match' : 'No incidents recorded'}>
          {incidents.length ? 'Try a wider time window or clear the search.' : 'Failed turns, tool failures, authorisation requests and Orders guard refusals will be listed here.'}
        </Empty>
      ) : (
        <ul className="incident-list" aria-label="Incidents">{list.slice(0, 120).map((x) => <IncidentRow key={x.id} x={x} />)}</ul>
      )}
      {list.length > 120 && <div className="list-foot">Showing the newest 120 of {list.length}. Narrow the filters to see older ones.</div>}
    </>
  )
}

// ---------------------------------------------------------------- case files
function CaseDetail({ c, incidents, onBack }: { c: CaseFile; incidents: Incident[]; onBack: () => void }) {
  const agents = useStore((s) => s.agents)
  const select = useStore((s) => s.select)
  const { note, setStatus, remove } = useCases()
  const [text, setText] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const a = c.agentKey ? agents[c.agentKey] : undefined
  const byId = useMemo(() => Object.fromEntries(incidents.map((x) => [x.id, x])), [incidents])
  const add = () => { if (text.trim()) { note(c.id, text); setText('') } }
  return (
    <div className="case-detail">
      <button type="button" className="btn ghost sm back" onClick={onBack}>← All case files</button>
      <div className="case-head">
        <div>
          <div className="case-id mono">{c.id}</div>
          <h3 className="case-title">{c.title}</h3>
          <div className="case-meta">Opened {new Date(c.opened_at * 1000).toLocaleString()} · updated {ago(c.updated_at)}</div>
        </div>
        <span className={`case-status ${c.status}`}>{c.status}</span>
      </div>
      <dl className="kv-grid">
        <dt>Subject</dt>
        <dd>{a ? <button type="button" className="link" onClick={() => select({ kind: 'agent', id: a.id })}>{a.name} · {a.role}</button> : c.agentKey ? 'Agent no longer on record' : 'No agent linked'}</dd>
        <dt>Evidence</dt><dd>{c.incidentIds.length} linked incident{c.incidentIds.length === 1 ? '' : 's'}</dd>
      </dl>
      {c.incidentIds.length > 0 && (
        <ul className="evidence">
          {c.incidentIds.map((id) => {
            const x = byId[id]
            return <li key={id} className={x ? `sev-${x.severity}` : 'gone'}>{x ? <><b>{KIND_LABEL[x.kind]}</b> · {x.title} <span className="muted">· {ago(x.ts)}</span></> : <span className="muted">{id}: not in the loaded history (older, or pruned from the store)</span>}</li>
          })}
        </ul>
      )}
      <SectionHead title="Notes" meta={c.notes.length} />
      {c.notes.length === 0 && <div className="muted small">No notes yet.</div>}
      <ol className="notes">
        {c.notes.map((n, i) => <li key={i}><time className="mono">{new Date(n.ts * 1000).toLocaleString([], { hour12: false })}</time><p>{n.text}</p></li>)}
      </ol>
      {c.status === 'open' && (
        <div className="note-compose">
          <textarea rows={3} maxLength={2000} value={text} placeholder="Add a finding, a decision or a next step…" aria-label="New note"
            onChange={(e) => setText(e.target.value)} onKeyUp={(e) => e.stopPropagation()}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add() } }} />
          <button type="button" className="btn primary" disabled={!text.trim()} onClick={add} title="Ctrl+Enter">Add note</button>
        </div>
      )}
      <div className="btn-row">
        {c.status === 'open'
          ? <button type="button" className="btn" onClick={() => setStatus(c.id, 'closed')}>Close case</button>
          : <button type="button" className="btn" onClick={() => setStatus(c.id, 'open')}>Reopen case</button>}
        {!confirmDelete
          ? <button type="button" className="btn ghost danger" onClick={() => setConfirmDelete(true)}>Delete…</button>
          : <><button type="button" className="btn danger" onClick={() => { remove(c.id); onBack() }}>Delete permanently</button><button type="button" className="btn ghost" onClick={() => setConfirmDelete(false)}>Keep</button></>}
      </div>
    </div>
  )
}

function CasesView({ incidents }: { incidents: Incident[] }) {
  const cases = useCases((s) => s.cases)
  const open = useCases((s) => s.open)
  const agents = useStore((s) => s.agents)
  const current = useCases((s) => s.focusId)
  const setCurrent = useCases((s) => s.focus)
  const [title, setTitle] = useState('')
  const [filter, setFilter] = useState<'open' | 'closed' | 'all'>('open')
  const c = current ? cases.find((x) => x.id === current) : undefined
  if (c) return <CaseDetail c={c} incidents={incidents} onBack={() => setCurrent(null)} />
  const list = cases.filter((x) => filter === 'all' || x.status === filter).sort((a, b) => b.updated_at - a.updated_at)
  const counts = { open: cases.filter((x) => x.status === 'open').length, closed: cases.filter((x) => x.status === 'closed').length }
  const create = () => { const id = open({ title }); setTitle(''); setCurrent(id) }
  return (
    <>
      <div className="note-compose new-case">
        <input type="text" value={title} maxLength={120} placeholder="New case title" aria-label="New case title"
          onChange={(e) => setTitle(e.target.value)} onKeyUp={(e) => e.stopPropagation()}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && title.trim()) create() }} />
        <button type="button" className="btn primary" disabled={!title.trim()} onClick={create}><IconPlus size={12} /> Open case</button>
      </div>
      <div className="panel-tools">
        <Chips label="Case status" value={filter} onChange={setFilter} options={[['open', 'Open', counts.open], ['closed', 'Closed', counts.closed], ['all', 'All', cases.length]] as const} />
        <SourceTag kind="local" />
      </div>
      {list.length === 0 ? (
        <Empty title={cases.length ? 'No cases in this view' : 'No case files'}>
          {cases.length ? 'Switch the status filter to see the rest.' : 'Open a case from an incident (File to case) or type a title above. Notes stay in this browser.'}
        </Empty>
      ) : (
        <ul className="case-list">
          {list.map((x) => (
            <li key={x.id}>
              <button type="button" className="case-item" onClick={() => setCurrent(x.id)}>
                <span className={`case-status ${x.status}`}>{x.status}</span>
                <span className="ci-title">{x.title}</span>
                <span className="ci-meta">{x.agentKey && agents[x.agentKey] ? `${agents[x.agentKey].name} · ` : ''}{x.incidentIds.length} evidence · {x.notes.length} notes · {ago(x.updated_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

// ---------------------------------------------------------------- posture, personnel, contacts
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

function PostureView() {
  useTick(10000)
  const demo = useStore((s) => s.demo)
  const ingest = useStore((s) => s.ingest)
  const orders = useStore((s) => s.ordersInfo)
  const agents = useStore((s) => s.agents)
  const select = useStore((s) => s.select)
  const sim = useSimStatus()
  const now = Date.now() / 1000
  const personnel = Object.values(agents).filter((a) => a.department === 'security' && (isOnDuty(a, now) || now - a.last_event_at < 3600))
  const loop = LOOPBACK.has(location.hostname)
  const checks: { ok: boolean | null; label: string; detail: string }[] = [
    { ok: loop, label: 'Served from this machine', detail: loop ? `Page origin ${location.host}` : `Page origin ${location.host} is not a loopback address` },
    { ok: demo ? null : ingest ? ingest.hook_installed : null, label: 'Capture hook installed', detail: demo ? 'Not checked in demo mode' : ingest ? (ingest.hook_installed ? 'New Claude Code sessions report to the base' : 'Run python scripts\\install_hooks.py') : 'Unknown until the link is live' },
    { ok: orders ? !orders.enabled : null, label: 'Orders channel off', detail: !orders ? 'Unknown until the link is live' : orders.enabled ? `On: agents may edit files in ${orders.folder}, guarded to that folder` : 'Only observation is possible (default)' },
  ]
  const contacts = [
    { on: sim.xwingActive, text: sim.xwingActive ? 'Hostile starfighters attacking the eastern sector' : 'No hostile starfighters on scopes' },
    { on: sim.freighterPhase === 'liftoff' || sim.freighterPhase === 'escape', text: `Impounded freighter: ${sim.freighterPhase === 'impounded' ? 'secured on Pad 3' : sim.freighterPhase}` },
    { on: sim.gunshipPhase !== 'away', text: `Bounty hunter gunship: ${sim.gunshipPhase === 'away' ? 'out of the system' : sim.gunshipPhase}` },
  ]
  return (
    <>
      <section className="card">
        <SectionHead title="Security posture" meta={demo ? <SourceTag kind="demo" /> : undefined} />
        <ul className="checks">
          {checks.map((c) => (
            <li key={c.label} className={c.ok === null ? 'unknown' : c.ok ? 'pass' : 'fail'}>
              <span className="chk-mark" aria-hidden="true">{c.ok === null ? '?' : c.ok ? '✓' : '!'}</span>
              <span className="chk-label">{c.label}<span className="sr-only">: {c.ok === null ? 'unknown' : c.ok ? 'yes' : 'no'}</span></span>
              <span className="chk-detail">{c.detail}</span>
            </li>
          ))}
        </ul>
        <div className="card-foot">The server-side controls (loopback binding, Host and Origin checks, Orders isolation) are described in SECURITY.md. This list shows what the interface can confirm.</div>
      </section>
      <section className="card">
        <SectionHead title="ISB personnel" meta={`${personnel.length} · ${facilityById.security.short}`} />
        {personnel.length === 0 ? <Empty title="No ISB personnel on duty">Review, audit, security and lint subagents report to the Security Operations Center.</Empty> : (
          <ul className="mini-roster">
            {personnel.map((a) => (
              <li key={a.id}><button type="button" onClick={() => select({ kind: 'agent', id: a.id })}><StatusDot s={a.status} /><b>{a.name}</b><span>{a.status}{a.active_tool ? ` · ${a.active_tool}` : ''} · {ago(a.last_event_at)}</span></button></li>
            ))}
          </ul>
        )}
      </section>
      <section className="card subtle">
        <SectionHead title="Perimeter contacts" meta={<SourceTag kind="sim" />} />
        <ul className="contacts">{contacts.map((c) => <li key={c.text} className={c.on ? 'on' : ''}>{c.text}</li>)}</ul>
        <div className="card-foot">Scenery simulation. These contacts are not real and never affect the alert level.</div>
      </section>
    </>
  )
}

export function IsbPanel() {
  const demo = useStore((s) => s.demo)
  const useBook = useCases((s) => s.useBook)
  useEffect(() => useBook(demo), [demo, useBook])
  const openCount = useCases((s) => s.cases.filter((c) => c.status === 'open').length)
  const { incidents, loading, error } = useIncidents()
  const focusId = useCases((s) => s.focusId)
  const [view, setView] = useState<View>(focusId ? 'cases' : 'incidents')
  useEffect(() => { if (focusId) setView('cases') }, [focusId])
  const day = Date.now() / 1000 - 86400
  const recent = incidents.filter((x) => x.ts >= day).length
  return (
    <div className="panel-body isb">
      <div className="panel-intro">
        <span className="kicker">Imperial Security Bureau</span>
        <span className="muted">Internal security and intelligence for the garrison</span>
      </div>
      <AlertLevelCard incidents={incidents} />
      <Chips size="md" label="ISB section" value={view} onChange={setView} options={[['incidents', 'Incidents', recent], ['cases', 'Case files', openCount], ['posture', 'Posture']] as const} />
      {view === 'incidents' && <IncidentsView incidents={incidents} loading={loading} error={error} />}
      {view === 'cases' && <CasesView incidents={incidents} />}
      {view === 'posture' && <PostureView />}
    </div>
  )
}

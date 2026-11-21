// Command Overview: is the base healthy, and does anything need the Commander? One screen, real data only.
import { useMemo, useState } from 'react'
import { dutyCounts, needsAttention } from '../agents/liveness'
import { activityBuckets, coverageSince, departmentLoad, filterIncidents, incidentsFromEvents, incidentsFromOrders, type ActivityBucket } from '../lib/intel'
import { HISTORY_LIMIT, useEventHistory } from '../lib/history'
import { useSimStatus } from '../sim/world'
import { useStore, type RosterFilter } from '../state/store'
import { FACILITIES, facilityById } from '../world/layout'
import { Chips, Empty, SectionHead, Skeleton, SourceTag, activate, ago, clock, useTick } from './common'
import { IconAlert, IconChevron } from './icons'

function openRoster(filter: RosterFilter) {
  const st = useStore.getState()
  st.setRosterFilter(filter)
  st.setPanel('agents')
}

// ---------------------------------------------------------------- system status board
type Tone = 'ok' | 'warn' | 'bad' | 'idle'
function StatusRow({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone: Tone }) {
  return (
    <div className={`status-row tone-${tone}`}>
      <span className="sr-ind" aria-hidden="true" />
      <span className="sr-label">{label}</span>
      <span className="sr-value">{value}</span>
      {detail && <span className="sr-detail">{detail}</span>}
    </div>
  )
}

function Meter({ pct, label }: { pct: number | undefined; label: string }) {
  const v = pct === undefined ? null : Math.max(0, Math.min(100, pct))
  const tone = v === null ? 'idle' : v >= 90 ? 'bad' : v >= 75 ? 'warn' : 'ok'
  return (
    <div className={`meter tone-${tone}`}>
      <div className="meter-head"><span>{label}</span><b>{v === null ? '—' : `${Math.round(v)}%`}</b></div>
      <div className="meter-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v ?? undefined}><span style={{ width: `${v ?? 0}%` }} /></div>
    </div>
  )
}

function SystemBoard() {
  const connected = useStore((s) => s.connected)
  const demo = useStore((s) => s.demo)
  const ingest = useStore((s) => s.ingest)
  const orders = useStore((s) => s.ordersInfo)
  const system = useStore((s) => s.system)
  return (
    <section className="card">
      <SectionHead title="System status" meta={demo ? <SourceTag kind="demo" /> : <SourceTag kind="live" />} />
      <div className="status-list">
        <StatusRow label="Agent link" tone={demo ? 'idle' : connected ? 'ok' : 'bad'} value={demo ? 'Not connected' : connected ? 'Live' : 'Offline'}
          detail={demo ? 'Demo mode never opens the live link' : connected ? 'WebSocket to the local server' : 'Retrying. Start the base with start.cmd'} />
        <StatusRow label="Capture hook" tone={!ingest ? 'idle' : ingest.hook_installed ? 'ok' : 'warn'} value={!ingest ? 'Unknown' : ingest.hook_installed ? 'Installed' : 'Not installed'}
          detail={ingest && !ingest.hook_installed ? 'python scripts\\install_hooks.py' : undefined} />
        <StatusRow label="Event store" tone={ingest ? 'ok' : 'idle'} value={ingest ? `${ingest.events_stored.toLocaleString()} events` : demo ? 'Demo sample' : 'Unknown'}
          detail={ingest ? `${ingest.ingested_this_run.toLocaleString()} received since the server started` : undefined} />
        <StatusRow label="Orders channel" tone={!orders ? 'idle' : orders.enabled ? 'warn' : 'ok'} value={!orders ? 'Unknown' : orders.enabled ? 'Enabled' : 'Off'}
          detail={!orders ? undefined : orders.enabled ? `Agents may edit files in the ${orders.folder} folder only` : orders.reason ?? 'Off by default (IMPERIAL_ORDERS=1 to enable)'} />
      </div>
      <div className="meters">
        <Meter label="Host CPU" pct={system?.cpu_pct} />
        <Meter label="Host memory" pct={system?.mem_pct} />
      </div>
      <div className="card-foot">
        {system ? <>Host sampled {ago(system.ts)}{system.cpu_count ? ` · ${system.cpu_count} cores` : ''}{system.mem_total_gb ? ` · ${system.mem_total_gb.toFixed(0)} GB` : ''}{demo ? ' · demo values' : ''}</> : 'Host telemetry arrives when the link is live.'}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- duty summary
function DutySummary() {
  useTick(15000)
  const agents = useStore((s) => s.agents)
  const now = Date.now() / 1000
  const d = useMemo(() => dutyCounts(Object.values(agents), now), [agents, Math.floor(now / 15)]) // eslint-disable-line react-hooks/exhaustive-deps
  const tiles: { id: RosterFilter; label: string; n: number; tone: string; hint: string }[] = [
    { id: 'attention', label: 'Need you', n: d.attention, tone: d.attention ? 'crit' : 'quiet', hint: 'Waiting for your authorisation, or the last turn failed' },
    { id: 'working', label: 'Working', n: d.busy, tone: d.busy ? 'ok' : 'quiet', hint: 'Confirmed working right now' },
    { id: 'waiting', label: 'Standby', n: d.standby, tone: 'quiet', hint: 'Awaiting orders, or activity unknown' },
    { id: 'live', label: 'On duty', n: d.onDuty, tone: 'quiet', hint: 'All agents currently on the base' },
  ]
  return (
    <div className="tiles" role="group" aria-label="Agents by duty">
      {tiles.map((t) => (
        <button key={t.id} type="button" className={`tile ${t.tone}`} title={t.hint} onClick={() => openRoster(t.id)}>
          <b>{t.n}</b><span>{t.label}</span>
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- activity chart
function ActivityChart({ buckets, span }: { buckets: ActivityBucket[]; span: '1h' | '24h' }) {
  const max = Math.max(1, ...buckets.map((b) => b.events))
  const total = buckets.reduce((n, b) => n + b.events, 0)
  const fails = buckets.reduce((n, b) => n + b.failures, 0)
  const W = 300
  const H = 84
  const gap = 2
  const bw = (W - gap * (buckets.length - 1)) / buckets.length
  const label = `Hook events over the last ${span === '1h' ? 'hour' : '24 hours'}: ${total} events, ${fails} failures. Busiest interval ${max} events.`
  return (
    <figure className="chart">
      <div className="chart-legend" aria-hidden="true">
        <span><i className="sw ev" />Events <b>{total}</b></span>
        <span><i className="sw fail" />Failures <b>{fails}</b></span>
        <span className="chart-max">peak {max}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
        {[0.5, 1].map((f) => <line key={f} x1="0" x2={W} y1={H - H * f + 0.5} y2={H - H * f + 0.5} className="grid" />)}
        {buckets.map((b, i) => {
          const h = (b.events / max) * (H - 2)
          const fh = (b.failures / max) * (H - 2)
          const x = i * (bw + gap)
          return (
            <g key={i}>
              <title>{`${clock(b.start)}–${clock(b.end)}: ${b.events} events, ${b.failures} failures, ${b.permissions} authorisation requests`}</title>
              <rect x={x} y={0} width={bw} height={H} className="hit" />
              {b.events > 0 && <rect x={x} y={H - h} width={bw} height={Math.max(1, h)} className="bar-ev" />}
              {b.failures > 0 && <rect x={x} y={H - fh} width={bw} height={Math.max(1.5, fh)} className="bar-fail" />}
            </g>
          )
        })}
        <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} className="axis" />
      </svg>
      <figcaption className="chart-axis" aria-hidden="true">
        <span>{clock(buckets[0].start)}</span><span>{clock(buckets[Math.floor(buckets.length / 2)].start)}</span><span>now</span>
      </figcaption>
    </figure>
  )
}

function ActivityCard() {
  useTick(30000)
  const demo = useStore((s) => s.demo)
  const { events, loading, error, fetchedAt } = useEventHistory()
  const [span, setSpan] = useState<'1h' | '24h'>('1h')
  const now = Date.now() / 1000
  const buckets = useMemo(() => (span === '1h' ? activityBuckets(events, now, 3600, 12) : activityBuckets(events, now, 86400, 24)), [events, span, Math.floor(now / 30)]) // eslint-disable-line react-hooks/exhaustive-deps
  const since = coverageSince(events)
  const partial = since !== null && since > now - (span === '1h' ? 3600 : 86400) && events.length >= HISTORY_LIMIT
  return (
    <section className="card">
      <SectionHead title="Hook activity" meta={demo ? <SourceTag kind="demo" /> : <SourceTag kind="live" />}>
        <Chips label="Time span" value={span} onChange={setSpan} options={[['1h', '1 h'], ['24h', '24 h']] as const} />
      </SectionHead>
      {loading ? <Skeleton rows={4} /> : events.length === 0 ? (
        <Empty title="No hook events yet">Activity appears here once a Claude Code session with the capture hook starts working.</Empty>
      ) : <ActivityChart buckets={buckets} span={span} />}
      <div className="card-foot">
        {error ? <span className="t-warn">History unavailable ({error}). Showing live events only.</span>
          : demo ? 'Demo sample: fictional events.'
          : events.length === 0 ? <>No events stored yet{fetchedAt ? ` · checked ${ago(fetchedAt)}` : ''}</> : <>Latest {Math.min(events.length, HISTORY_LIMIT).toLocaleString()} stored events{since ? `, back to ${new Date(since * 1000).toLocaleString([], { hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}{partial ? ' (older events not shown)' : ''}{fetchedAt ? ` · refreshed ${ago(fetchedAt)}` : ''}</>}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- alerts
function AlertsCard() {
  useTick(10000)
  const agents = useStore((s) => s.agents)
  const orders = useStore((s) => s.orders)
  const select = useStore((s) => s.select)
  const setPanel = useStore((s) => s.setPanel)
  const { events } = useEventHistory()
  const now = Date.now() / 1000
  const waiting = Object.values(agents).filter((a) => needsAttention(a, now)).sort((a, b) => b.last_event_at - a.last_event_at)
  const recent = useMemo(() => filterIncidents([...incidentsFromEvents(events, agents), ...incidentsFromOrders(orders)], { since: now - 3600 }, agents)
    // a failed turn of an agent already listed above would be shown twice
    .filter((x) => x.severity !== 'low' && !(x.kind === 'turn-failure' && x.agentKey && waiting.some((a) => a.id === x.agentKey)))
    .slice(0, 4), [events, agents, orders, waiting.map((a) => a.id).join(), Math.floor(now / 10)]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="card">
      <SectionHead title="Needs attention" meta={waiting.length + recent.length || 'none'}>
        <button type="button" className="btn ghost sm" onClick={() => setPanel('isb')}>ISB register <IconChevron size={12} /></button>
      </SectionHead>
      {waiting.length === 0 && recent.length === 0 && <Empty title="All clear">No agent is waiting for you and nothing failed in the last hour.</Empty>}
      <ul className="alert-list">
        {waiting.map((a) => (
          <li key={a.id}>
            <button type="button" className={`alert-item ${a.status === 'failed' ? 'sev-high' : 'sev-warn'}`} onClick={() => { setPanel('agents'); select({ kind: 'agent', id: a.id }) }}>
              <IconAlert size={14} />
              <span className="ai-main"><b>{a.name}</b> {a.status === 'failed' ? 'reports a failed turn' : 'awaits your authorisation'}</span>
              <span className="ai-meta">{a.project ?? facilityById[a.department]?.short} · {ago(a.last_event_at)}</span>
            </button>
          </li>
        ))}
        {recent.map((x) => (
          <li key={x.id}>
            <button type="button" className={`alert-item sev-${x.severity}`} onClick={() => x.agentKey && agents[x.agentKey] ? select({ kind: 'agent', id: x.agentKey }) : setPanel('isb')}>
              <span className={`sev-dot sev-${x.severity}`} aria-hidden="true" />
              <span className="ai-main">{x.title}</span>
              <span className="ai-meta">{x.detail} · {ago(x.ts)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------- departments
function DepartmentsCard() {
  useTick(15000)
  const agents = useStore((s) => s.agents)
  const now = Date.now() / 1000
  const load = useMemo(() => departmentLoad(Object.values(agents), now), [agents, Math.floor(now / 15)]) // eslint-disable-line react-hooks/exhaustive-deps
  const max = Math.max(1, ...Object.values(load).map((d) => d.onDuty))
  const total = Object.values(load).reduce((n, d) => n + d.onDuty, 0)
  const openFacility = (id: (typeof FACILITIES)[number]['id']) => {
    const st = useStore.getState()
    st.enterInterior(null)
    st.setCameraMode('orbit')
    st.select({ kind: 'facility', id })
  }
  return (
    <section className="card">
      <SectionHead title="Department occupancy" meta={`${total} on duty`} />
      <ul className="dept-list">
        {FACILITIES.map((f) => {
          const d = load[f.id]
          return (
            <li key={f.id} className="dept" role="button" tabIndex={0} title={`View ${f.name}`} onClick={() => openFacility(f.id)} onKeyDown={activate(() => openFacility(f.id))}>
              <span className="dept-name">{f.short}</span>
              <span className="dept-track" aria-hidden="true">
                {d && <span className="dept-fill" style={{ width: `${(d.onDuty / max) * 100}%` }}>
                  {d.attention > 0 && <span className="dept-attn" style={{ width: `${(d.attention / d.onDuty) * 100}%` }} />}
                </span>}
              </span>
              <span className="dept-n">{d?.onDuty ?? 0}{d?.attention ? <em> · {d.attention} need you</em> : null}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------- simulation (scenery)
const SHUTTLE: Record<string, string> = { away: 'in deep space', approach: 'on approach', descent: 'on final descent', landed: 'on the pad', liftoff: 'lifting off', climbout: 'climbing out' }
function SimulationCard() {
  const s = useSimStatus()
  const setPanel = useStore((x) => x.setPanel)
  const items = [
    `Shuttle ${SHUTTLE[s.shuttlePhase] ?? s.shuttlePhase}`,
    s.patrolActive ? `${s.fighters.length} TIE patrol craft airborne` : 'TIE patrols in the hangar',
    s.xwingActive ? 'Hostile starfighter attack under way' : 'No hostile contacts',
    s.dumpBurning ? 'Fuel depot burning' : null,
  ].filter(Boolean)
  return (
    <section className="card subtle">
      <SectionHead title="Scenery simulation" meta={<SourceTag kind="sim" />}>
        <button type="button" className="btn ghost sm" onClick={() => setPanel('aircraft')}>Air control <IconChevron size={12} /></button>
      </SectionHead>
      <p className="sim-line">{items.join(' · ')}.</p>
      <div className="card-foot">Aircraft, vehicles and personnel are scenery. They are not agents and not telemetry.</div>
    </section>
  )
}

export function OverviewPanel() {
  return (
    <div className="panel-body overview">
      <DutySummary />
      <AlertsCard />
      <ActivityCard />
      <SystemBoard />
      <DepartmentsCard />
      <SimulationCard />
    </div>
  )
}

import { AnimatePresence, MotionConfig, motion, type Transition } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { STATUS_COLOR } from '../agents/AgentLayer'
import { dutyCounts, dutyOf, isOnDuty, needsAttention, rosterRank, statsSince } from '../agents/liveness'
import { SoundControl, SoundMixPanel, useSound } from '../audio/AudioLayer'
import { doorPrompt, enterAt, exitInterior } from '../camera/CameraRig'
import { INTERIORS } from '../interiors/layouts'
import { commands, useSimStatus } from '../sim/world'
import { QUALITY, useStore, type CameraMode, type Quality, type RosterFilter, type TourId } from '../state/store'
import type { AgentInfo, HookEvent, TaskInfo } from '../state/types'
import { IconAlert, IconBranch, IconClock, IconClose, IconMoon, IconSun } from './icons'
import { OrdersChat } from './OrdersChat'
import { FACILITIES, PLANET, facilityById, type DepartmentId } from '../world/layout'

/** Frames per second, read once a second from the renderer statistics the scene publishes. */
function FrameRate() {
  const [s, setS] = useState<{ fps: number; calls: number; triangles: number } | null>(null)
  useEffect(() => {
    const id = setInterval(() => setS((window as any).__imperialStats ?? null), 1000)
    return () => clearInterval(id)
  }, [])
  if (!s) return null
  const tone = s.fps >= 50 ? 'ok' : s.fps >= 30 ? 'warn' : 'bad'
  return <span className={`pill ${tone}`} title={`Frames per second. ${s.calls} draw calls, ${s.triangles.toLocaleString()} triangles per frame.`}>{s.fps} FPS</span>
}

const ago = (ts: number) => {
  const s = Math.max(0, Date.now() / 1000 - ts)
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
const dur = (s: number) => (s < 60 ? `${s.toFixed(0)}s` : s < 3600 ? `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`)
const fmtTokens = (n?: number) => (n == null ? '—' : n > 1e6 ? `${(n / 1e6).toFixed(2)}M` : n > 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`)

// shared motion presets (UI only; the 3D scene is driven by three.js, not motion)
const EASE: Transition = { type: 'spring', stiffness: 420, damping: 36, mass: 0.8 }
const FAST: Transition = { duration: 0.18, ease: [0.2, 0.7, 0.2, 1] }
const rowIn = {
  initial: { opacity: 0, x: -14 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 14, transition: FAST },
  transition: EASE,
}

function useTick(ms = 1000) {
  const [, set] = useState(0)
  useEffect(() => { const t = setInterval(() => set((x) => x + 1), ms); return () => clearInterval(t) }, [ms])
}

function agentHaystack(a: AgentInfo) {
  return `${a.name} ${a.role} ${a.status} ${a.active_tool ?? ''} ${a.project ?? ''} ${a.department} ${facilityById[a.department]?.name ?? ''} ${a.assignment ?? ''} ${a.client_label ?? ''}`.toLowerCase()
}

function matchesRoster(a: AgentInfo, filter: RosterFilter, query: string, now: number) {
  if (filter === 'live' && !isOnDuty(a, now)) return false
  if (filter === 'attention' && !needsAttention(a, now)) return false
  if (filter === 'working' && a.status !== 'working' && a.status !== 'delegating' && a.status !== 'active') return false
  if (filter === 'waiting' && a.status !== 'waiting' && a.status !== 'idle') return false
  if (filter === 'failed' && a.status !== 'failed') return false
  return !query || agentHaystack(a).includes(query)
}

function SearchField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return <input className="search" type="search" value={value} placeholder={label} aria-label={label} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
}

// ------------------------------------------------------------------ top bar
const MODES: { id: CameraMode; label: string; key: string }[] = [
  { id: 'orbit', label: 'Exterior', key: '1' },
  { id: 'tactical', label: 'Tactical', key: '2' },
  { id: 'firstperson', label: 'First-person', key: '3' },
  { id: 'thirdperson', label: 'Third-person', key: '4' },
  { id: 'cinematic', label: 'Cinematic', key: '5' },
]

function BaseClock() {
  useTick(1000)
  const tasks = useStore((s) => s.tasks)
  const running = useMemo(() => Object.values(tasks).filter((t) => t.status === 'in_progress').length, [tasks])
  const now = new Date()
  return (
    <div className="clock" title="Local time · missions in progress">
      <IconClock size={13} />
      <span className="mono">{now.toLocaleTimeString([], { hour12: false })}</span>
      <span className="sep" />
      <span className="ms"><b>{running}</b> MISSION{running === 1 ? '' : 'S'} IN PROGRESS</span>
    </div>
  )
}

const TOD_LABEL: Record<string, string> = { golden: 'GOLDEN HOUR', dusk: 'DUSK', night: 'NIGHT' }
function TimeButton() {
  const tod = useStore((s) => s.timeOfDay)
  const cycle = useStore((s) => s.cycleTimeOfDay)
  return <button className="with-ico" onClick={cycle} title="Time of day (N)" aria-label={`Time of day: ${TOD_LABEL[tod]}. Click to change`}>{tod === 'night' ? <IconMoon /> : <IconSun />} {TOD_LABEL[tod]}</button>
}

/** Opens the roster on the agents that are blocked on the Commander and selects the most recent one. */
function showAttention() {
  const st = useStore.getState()
  const now = Date.now() / 1000
  const first = Object.values(st.agents).filter((a) => needsAttention(a, now)).sort((a, b) => b.last_event_at - a.last_event_at)[0]
  st.setRosterFilter('attention')
  st.setPanel('agents')
  if (first) st.select({ kind: 'agent', id: first.id })
}

function TopBar() {
  useTick(15000) // duty counts also change with the passing of time (stale, signed off)
  const { connected, ingest, quality, setQuality, cameraMode, setCameraMode, agents, interior } = useStore()
  const now = Date.now() / 1000
  const duty = useMemo(() => dutyCounts(Object.values(agents), now), [agents, Math.floor(now / 15)]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const bits = [duty.attention ? `${duty.attention} need you` : '', duty.busy ? `${duty.busy} working` : ''].filter(Boolean)
    document.title = `${bits.length ? `(${bits.join(' · ')}) ` : ''}Imperial Base`
  }, [duty.attention, duty.busy])
  return (
    <motion.div className="topbar" initial={{ y: -56, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -56, opacity: 0 }} transition={EASE}>
      <div className="brand">
        <div className="emblem" />
        <div>
          <div className="title">IMPERIAL BASE</div>
          <div className="sub">{PLANET.installation} · {PLANET.name} · {PLANET.sector}</div>
        </div>
      </div>
      <div className="modes" role="toolbar" aria-label="Camera mode">
        {MODES.map((m) => (
          <button key={m.id} aria-pressed={cameraMode === m.id} className={`mode ${cameraMode === m.id ? 'on' : ''}`} onClick={() => setCameraMode(m.id)} title={`Hotkey ${m.key}`}>
            {cameraMode === m.id && <motion.span layoutId="mode-hl" className="mode-hl" transition={EASE} />}
            <span className="lbl">{m.label}</span>
          </button>
        ))}
        <AnimatePresence>
          {interior && <motion.button key="exit" className="warn" onClick={() => exitInterior()} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }} transition={FAST}>Exit {facilityById[interior].short}</motion.button>}
        </AnimatePresence>
      </div>
      <BaseClock />
      <div className="status">
        <span className={`pill ${connected ? 'ok live' : 'bad'}`}>{connected ? '● AGENT LINK LIVE' : '○ AGENT LINK OFFLINE'}</span>
        {duty.attention > 0 && <button className="pill attn" onClick={showAttention} title="Agents waiting for your permission, or whose last turn failed">{duty.attention} NEED{duty.attention === 1 ? 'S' : ''} YOU</button>}
        <span className={`pill ${duty.busy ? 'ok' : ''}`} title="Agents confirmed working right now">{duty.busy} WORKING</span>
        <span className="pill standby" title="Agents on the base awaiting orders, or whose current activity is unknown">{duty.standby} STANDBY</span>
        {ingest && !ingest.hook_installed && <span className="pill warn" title={`Run: python scripts\\install_hooks.py — spool: ${ingest.spool}`}>HOOK NOT INSTALLED</span>}
        <FrameRate />
        <TimeButton />
        <SoundControl />
        <select value={quality} onChange={(e) => setQuality(e.target.value as Quality)} title="Graphics quality">
          {(Object.keys(QUALITY) as Quality[]).map((q) => <option key={q} value={q}>{q.toUpperCase()}</option>)}
        </select>
      </div>
    </motion.div>
  )
}

// ------------------------------------------------------------------ agent roster
function StatusDot({ s }: { s: AgentInfo['status'] }) {
  return <span className={`dot ${BUSY.has(s) ? 'pulse' : ''}`} style={{ background: STATUS_COLOR[s], color: STATUS_COLOR[s] }} />
}

function AgentRow({ a, depth, all, visible }: { a: AgentInfo; depth: number; all: Record<string, AgentInfo>; visible: (a: AgentInfo) => boolean }) {
  const select = useStore((s) => s.select)
  const follow = useStore((s) => s.follow)
  const sel = useStore((s) => s.selection?.kind === 'agent' && s.selection.id === a.id)
  const kids = a.children.map((c) => all[c]).filter((k): k is AgentInfo => !!k && visible(k))
  const duty = dutyOf(a, Date.now() / 1000)
  return (
    <>
      <motion.div layout="position" {...rowIn} role="button" tabIndex={0} className={`agent-row ${sel ? 'sel' : ''} duty-${duty}`} style={{ paddingLeft: 8 + depth * 16 }} title="Click to inspect · double-click to follow" onClick={() => select({ kind: 'agent', id: a.id })} onDoubleClick={() => duty !== 'off' && follow({ kind: 'agent', id: a.id })} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select({ kind: 'agent', id: a.id }) } }}>
        {depth > 0 && <IconBranch className="branch" size={12} />}
        <StatusDot s={a.status} />
        <div className="ar-main">
          <div className="ar-name">{a.name} <span className="ar-role">{a.role}</span>{a.client && a.client !== 'claude-code' && <span className="ar-client">{a.client_label ?? a.client}</span>}{duty === 'attention' && <span className="ar-attn">{a.status === 'failed' ? 'FAILED' : 'NEEDS YOU'}</span>}</div>
          <div className="ar-sub">{a.status}{a.active_tool ? ` · ${a.active_tool}` : ''} · {facilityById[a.department]?.short ?? a.department} · {a.project ?? '—'} · {ago(a.last_event_at)}{a.stale ? ' · activity unknown' : ''}</div>
        </div>
      </motion.div>
      <AnimatePresence initial={false}>{kids.map((k) => <AgentRow key={k.id} a={k} depth={depth + 1} all={all} visible={visible} />)}</AnimatePresence>
    </>
  )
}

function DayStats() {
  const agents = useStore((s) => s.agents)
  const tasks = useStore((s) => s.tasks)
  const midnight = new Date().setHours(0, 0, 0, 0) / 1000
  const st = useMemo(() => statsSince(Object.values(agents), midnight), [agents, midnight])
  const missions = useMemo(() => Object.values(tasks).filter((t) => t.started_at >= midnight && t.kind !== 'report').length, [tasks, midnight])
  return (
    <div className="daystats" title="Totals for agents that reported at least one event since local midnight. Tokens are whole-session totals, read after each turn.">
      <div><b>{st.sessions}</b><span>sessions</span></div>
      <div><b>{st.subagents}</b><span>subagents</span></div>
      <div><b>{missions}</b><span>missions</span></div>
      <div><b>{fmtTokens(st.toolCalls)}</b><span>tool calls</span></div>
      <div><b className={st.errors ? 'err' : ''}>{st.errors}</b><span>errors</span></div>
      <div><b>{st.tokens ? fmtTokens(st.tokens) : '—'}</b><span>tokens</span></div>
    </div>
  )
}

const ROSTER_FILTERS: [RosterFilter, string][] = [['live', 'On duty'], ['working', 'Working'], ['attention', 'Needs you'], ['waiting', 'Standby'], ['failed', 'Failed'], ['all', 'All']]

function AgentsPanel() {
  useTick(5000)
  const agents = useStore((s) => s.agents)
  const ingest = useStore((s) => s.ingest)
  const connected = useStore((s) => s.connected)
  const filter = useStore((s) => s.rosterFilter)
  const setFilter = useStore((s) => s.setRosterFilter)
  const [showAll, setShowAll] = useState(false)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const bucket = Math.floor(Date.now() / 5000) // re-evaluate the time-based rules with the 5 s tick
  const self = useMemo(() => (a: AgentInfo) => {
    const t = Date.now() / 1000
    // ended and long-silent agents stay out unless asked for (the "All" filter or the checkbox)
    const recent = showAll || filter === 'all' || isOnDuty(a, t) || (a.status === 'completed' && t - a.last_event_at < 3600)
    return recent && matchesRoster(a, filter, q, t)
  }, [showAll, filter, q, bucket]) // eslint-disable-line react-hooks/exhaustive-deps
  const visible = useMemo(() => {
    const keep = (a: AgentInfo): boolean => self(a) || a.children.some((id) => agents[id] && keep(agents[id]))
    return keep
  }, [agents, self])
  const roots = useMemo(() => {
    const t = Date.now() / 1000
    return Object.values(agents)
      .filter((a) => a.kind === 'main' || !a.parent_id || !agents[a.parent_id])
      .filter((a) => visible(a))
      .map((a) => ({ a, rank: rosterRank(a, agents, t) }))
      .sort((x, y) => x.rank - y.rank || y.a.last_event_at - x.a.last_event_at)
      .slice(0, 150)
      .map((x) => x.a)
  }, [agents, visible])
  const shown = useMemo(() => Object.values(agents).filter(self).length, [agents, self])
  const unfiltered = !q && filter === 'live'
  return (
    <div className="panel-body">
      <DayStats />
      <div className="panel-tools">
        <SearchField value={query} onChange={setQuery} label="Search agents" />
        <div className="chips" role="toolbar" aria-label="Agent status">
          {ROSTER_FILTERS.map(([id, label]) => (
            <button key={id} className={filter === id ? 'on' : ''} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>
        <label><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> include ended sessions</label>
        <span className="tool-count">{shown} shown</span>
      </div>
      {!connected && <div className="empty">Backend not reachable. Start it with <code>start.cmd</code>. Aircraft and personnel simulation keep running.</div>}
      {connected && roots.length === 0 && unfiltered && (
        <div className="empty">
          {Object.keys(agents).length ? 'No agents are on duty right now. Start a Claude Code session, or pick "All" to see past ones.' : 'No Claude Code agents have reported yet.'}
          {ingest && !ingest.hook_installed && <><br /><br />Install the capture hook (one time):<br /><code>python scripts\install_hooks.py</code><br />then start any Claude Code session.</>}
        </div>
      )}
      {connected && roots.length === 0 && !unfiltered && <div className="empty">No agents match this filter.</div>}
      <AnimatePresence initial={false}>{roots.map((a) => <AgentRow key={a.id} a={a} depth={0} all={agents} visible={visible} />)}</AnimatePresence>
      <div className="legend">
        {(Object.keys(STATUS_COLOR) as AgentInfo['status'][]).map((s) => <span key={s}><StatusDot s={s} />{s}</span>)}
      </div>
    </div>
  )
}

function MissionsPanel() {
  useTick(5000)
  const tasks = useStore((s) => s.tasks)
  const agents = useStore((s) => s.agents)
  const select = useStore((s) => s.select)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'open' | 'failed' | 'all'>('all')
  const q = query.trim().toLowerCase()
  const list = useMemo(() => Object.values(tasks).filter((t) => {
    if (filter === 'open' && t.status !== 'in_progress') return false
    if (filter === 'failed' && t.status !== 'failed') return false
    if (!q) return true
    const agent = agents[t.agent_id]
    return `${t.title} ${t.summary ?? ''} ${t.status} ${t.kind} ${agent?.name ?? ''} ${agent?.role ?? ''}`.toLowerCase().includes(q)
  }).sort((a, b) => b.started_at - a.started_at).slice(0, 80), [tasks, agents, filter, q])
  const active = Object.values(tasks).filter((t) => t.status === 'in_progress').length
  return (
    <>
    <div className="panel-body">
      <div className="panel-tools">
        <SearchField value={query} onChange={setQuery} label="Search missions" />
        <div className="chips" role="toolbar" aria-label="Mission status">
          {([['all', 'All'], ['open', 'In progress'], ['failed', 'Failed']] as const).map(([id, label]) => (
            <button key={id} className={filter === id ? 'on' : ''} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>
        <span className="tool-count">{active} active · {list.length} shown</span>
      </div>
      {list.length === 0 && <div className="empty">{q || filter !== 'all' ? 'No missions match this filter.' : 'No missions recorded yet. Give an order in the box below, or prompt any Claude Code session: each becomes a mission.'}</div>}
      <AnimatePresence initial={false}>{list.map((t) => <TaskRow key={t.id} t={t} agent={agents[t.agent_id]} onClick={() => select({ kind: 'agent', id: t.agent_id })} />)}</AnimatePresence>
    </div>
    <OrdersChat />
    </>
  )
}

function TaskRow({ t, agent, onClick }: { t: TaskInfo; agent?: AgentInfo; onClick?: () => void }) {
  const color = t.status === 'completed' ? '#2fbf9f' : t.status === 'failed' ? '#ff4a3d' : t.status === 'interrupted' ? '#8a96a3' : '#47d16c'
  return (
    <motion.div layout="position" {...rowIn} className="task-row" onClick={onClick}>
      <div className="tr-head"><span className="tag" style={{ borderColor: color, color }}>{t.status.replace('_', ' ')}</span><span className="tr-kind">{t.kind === 'turn' ? 'ORDERS' : t.kind === 'report' ? 'REPORT' : 'DELEGATION'}</span><span className="tr-time">{ago(t.started_at)}</span></div>
      <div className="tr-title">{t.title}</div>
      <div className="tr-sub">{agent ? `${agent.name} · ${agent.role}` : t.agent_id} · {t.tool_calls} tool calls{t.ended_at ? ` · ${dur(t.ended_at - t.started_at)}` : ''}</div>
      {t.summary && <div className="tr-sum">{t.summary}</div>}
    </motion.div>
  )
}

function EventsPanel() {
  const events = useStore((s) => s.events)
  const agents = useStore((s) => s.agents)
  const [query, setQuery] = useState('')
  const [errorsOnly, setErrorsOnly] = useState(false)
  const q = query.trim().toLowerCase()
  const list = useMemo(() => events.filter((e) => {
    const failed = e.event.includes('Fail') || !!e.error
    if (errorsOnly && !failed) return false
    if (!q) return true
    const a = agents[e.agent_id ? `agent:${e.agent_id}` : `session:${e.session_id}`]
    return `${e.event} ${e.tool_name ?? ''} ${e.tool_target ?? ''} ${e.error ?? ''} ${e.delegation ?? ''} ${a?.name ?? ''} ${e.agent_type ?? ''}`.toLowerCase().includes(q)
  }).slice(-150).reverse(), [events, agents, q, errorsOnly])
  const failures = events.filter((e) => e.event.includes('Fail') || e.error).length
  return (
    <div className="panel-body mono">
      <div className="panel-tools">
        <SearchField value={query} onChange={setQuery} label="Search events" />
        <button className={errorsOnly ? 'on warn' : ''} aria-pressed={errorsOnly} onClick={() => setErrorsOnly((v) => !v)}>Errors{failures ? ` (${failures})` : ''}</button>
        <span className="tool-count">newest {list.length}</span>
      </div>
      {list.map((e) => <EventLine key={e.id} e={e} agents={agents} />)}
      {list.length === 0 && <div className="empty">No hook events received yet.</div>}
    </div>
  )
}

function EventLine({ e, agents }: { e: HookEvent; agents: Record<string, AgentInfo> }) {
  const a = agents[e.agent_id ? `agent:${e.agent_id}` : `session:${e.session_id}`]
  const detail = e.tool_name ? `${e.tool_name}${e.tool_target ? ` (${e.tool_target})` : ''}` : e.delegation ?? e.notification_type ?? e.reason ?? e.source ?? ''
  return (
    <div className={`ev ${e.event.includes('Fail') || e.error ? 'err' : ''}`}>
      <span className="ev-t">{new Date(e.ts).toLocaleTimeString()}</span>
      <span className="ev-n">{e.event}</span>
      <span className="ev-a">{a?.name ?? (e.agent_type ?? e.session_id.slice(0, 8))}</span>
      <span className="ev-d">{detail}{e.error ? ` — ${e.error}` : ''}</span>
    </div>
  )
}

// ------------------------------------------------------------------ aircraft control
const FREIGHTER_LABEL: Record<string, string> = {
  impounded: 'Impounded on Pad 3', boarding: 'Crew running aboard', liftoff: 'Breaking free', escape: 'Running for the valley', away: 'Lost from scopes',
  return: 'Under escort, inbound', landing: 'Setting down',
}

const GUNSHIP_LABEL: Record<string, string> = {
  away: 'Out of the system', approach: 'On approach', landing: 'Setting down', landed: 'On the visitor stand', liftoff: 'Lifting off', depart: 'Departing',
}
const DESTROYER_LABEL: Record<string, string> = {
  away: 'Not in the system', arrive: 'Dropping out of hyperspace', station: 'On station in high orbit', jump: 'Jumping to light speed',
}
/** Follow one of the simulated ships with the view cleared: out of any interior, side panel folded away. */
function watch(id: string) {
  const st = useStore.getState()
  st.enterInterior(null)
  st.follow({ kind: 'aircraft', id })
  st.setPanel(null)
}

function AircraftPanel() {
  const s = useSimStatus()
  const follow = useStore((x) => x.follow)
  const startTour = useStore((x) => x.startTour)
  const phaseLabel: Record<string, string> = { away: 'In deep space', approach: 'On approach', descent: 'Final descent', landed: 'On the pad', liftoff: 'Lifting off', climbout: 'Climbing out' }
  return (
    <div className="panel-body">
      <div className="sim-note">Environmental simulation — aircraft are scenery, not real telemetry or AI agents.</div>
      <h4>Imperial Shuttle</h4>
      <div className="kv"><span>Status</span><b>{phaseLabel[s.shuttlePhase]}</b></div>
      <div className="bar"><motion.div animate={{ scaleX: s.shuttleProgress }} transition={{ duration: 0.4, ease: 'linear' }} style={{ originX: 0 }} /></div>
      <div className="btns">
        <button onClick={commands.shuttleArrive} disabled={s.shuttlePhase !== 'away'}>Trigger arrival</button>
        <button onClick={commands.shuttleDepart} disabled={s.shuttlePhase !== 'landed'}>Clear departure</button>
        <button onClick={() => follow({ kind: 'aircraft', id: 'shuttle' })}>Follow</button>
        <button onClick={() => startTour('shuttle')}>Pad camera</button>
      </div>
      <label className="chk"><input type="checkbox" checked={s.shuttleAuto} onChange={(e) => commands.setShuttleAuto(e.target.checked)} /> auto-depart after 45 s on the pad</label>
      <h4>TIE Patrols</h4>
      <div className="btns">
        <button onClick={() => commands.startPatrol()} disabled={s.patrolActive}>Launch patrols</button>
        <button onClick={commands.stopPatrol} disabled={!s.patrolActive}>Recall to hangar</button>
      </div>
      {s.fighters.map((f) => (
        <div key={f.id} className="kv clickable" onClick={() => follow({ kind: 'aircraft', id: f.id })}><span>{f.callsign}</span><b>{f.state}</b></div>
      ))}
      <h4>Unidentified contacts</h4>
      <div className="btns">
        <button className="warn" onClick={() => { commands.xwingFlyby(); useStore.getState().enterInterior(null); follow({ kind: 'aircraft', id: 'xwing' }); useStore.getState().setPanel(null) }} disabled={s.xwingActive}>Watch the attack</button>
        <button onClick={commands.xwingFlyby} disabled={s.xwingActive}>Simulate X-wing attack</button>
        <button onClick={() => follow({ kind: 'aircraft', id: 'xwing' })} disabled={!s.xwingActive}>Track contact</button>
      </div>
      <div className="kv"><span>Attack run</span><b>three X-wings: shoot down a picket TIE, then strafe the fuel depot</b></div>
      <div className="kv clickable" onClick={() => { useStore.getState().enterInterior(null); useStore.getState().setCameraMode('orbit'); useStore.getState().select({ kind: 'aircraft', id: 'dump' }) }}><span>Fuel depot and truck (east apron)</span><b style={{ color: s.dumpBurning ? '#ff7d70' : undefined }}>{s.dumpBurning ? 'BURNING' : 'intact'}</b></div>
      <div className="kv"><span>Intercept</span><b>{s.patrolActive ? 'interceptor pair will pursue' : 'patrols down — no intercept'}</b></div>
      <h4>Impounded freighter · Pad 3</h4>
      <div className="kv"><span>Status</span><b>{FREIGHTER_LABEL[s.freighterPhase]}</b></div>
      <div className="bar"><motion.div animate={{ scaleX: s.freighterProgress }} transition={{ duration: 0.4, ease: 'linear' }} style={{ originX: 0 }} /></div>
      <div className="btns">
        <button className="warn" onClick={commands.freighterEscape} disabled={s.freighterPhase !== 'impounded'}>Stage an escape</button>
        <button onClick={() => follow({ kind: 'aircraft', id: 'freighter' })} disabled={s.freighterPhase === 'away'}>Follow</button>
        <button onClick={() => { useStore.getState().enterInterior(null); useStore.getState().setCameraMode('orbit'); useStore.getState().select({ kind: 'aircraft', id: 'freighter' }) }}>View pad</button>
      </div>
      <label className="chk"><input type="checkbox" checked={s.freighterAuto} onChange={(e) => commands.setFreighterAuto(e.target.checked)} /> escapes on its own every few minutes</label>
      <h4>Visitors</h4>
      <div className="kv"><span>Star Destroyer</span><b>{DESTROYER_LABEL[s.destroyerPhase]}</b></div>
      <div className="kv"><span>Bounty hunter gunship</span><b>{GUNSHIP_LABEL[s.gunshipPhase]}</b></div>
      <div className="kv"><span>Hutt sail barge</span><b>cruising the dunes</b></div>
      <div className="btns">
        <button className="warn" onClick={() => { if (s.destroyerPhase === 'away') commands.destroyerArrive(); useStore.getState().watchTour('destroyer') }}>{s.destroyerPhase === 'away' ? 'Watch it arrive' : 'Watch destroyer'}</button>
        <button onClick={commands.destroyerArrive} disabled={s.destroyerPhase !== 'station'}>Order jump</button>
        <button onClick={() => watch('gunship')} disabled={s.gunshipPhase === 'away'}>Follow gunship</button>
        <button onClick={() => watch('barge')}>Follow sail barge</button>
      </div>
      <h4>March on the Temple</h4>
      <div className="kv"><span>Hooded knight and 36 clone troopers</span><b>{s.marching ? 'on the march' : 'standing by'}</b></div>
      <div className="btns">
        <button className="warn" onClick={() => { if (!s.marching) commands.marchStart(); useStore.getState().watchTour('march') }}>{s.marching ? 'Watch the march' : 'Start the march'}</button>
      </div>
      <h4>Duel · Pad 2</h4>
      <div className="kv"><span>Master against a horned Sith, double blade</span><b>in progress</b></div>
      <div className="btns">
        <button onClick={() => useStore.getState().watchTour('duel')}>Watch the duel</button>
      </div>
      <h4>Ground forces</h4>
      <div className="kv"><span>Heavy walker Thunder-1</span><b>perimeter patrol</b></div>
      <div className="btns">
        <button onClick={() => follow({ kind: 'aircraft', id: 'walker' })}>Follow walker</button>
      </div>
      <SoundMixPanel />
      <h4>Hangar Alpha doors</h4>
      <div className="kv"><span>Doors</span><b>{Math.round(s.hangarDoor * 100)}% open</b></div>
      <div className="btns">
        {(['auto', 'open', 'closed'] as const).map((m) => <button key={m} className={s.hangarMode === m ? 'on' : ''} onClick={() => commands.setHangar(m)}>{m}</button>)}
        <button onClick={() => startTour('hangar')}>Hangar camera</button>
      </div>
    </div>
  )
}

const TOURS: { id: TourId; label: string }[] = [
  { id: 'flyover', label: 'Base flyover' }, { id: 'shuttle', label: 'Shuttle arrival' }, { id: 'hangar', label: 'Hangar' },
  { id: 'command', label: 'Command chamber' }, { id: 'bunker', label: 'Server bunker' }, { id: 'agents', label: 'Agent activity' }, { id: 'duel', label: 'Lightsaber duel' }, { id: 'destroyer', label: 'Star Destroyer' }, { id: 'march', label: 'March on the Temple' }, { id: 'bikes', label: 'Speeder bike patrol' },
]

function FacilitiesPanel() {
  const select = useStore((s) => s.select)
  const setCameraMode = useStore((s) => s.setCameraMode)
  const startTour = useStore((s) => s.startTour)
  const agents = useStore((s) => s.agents)
  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    const now = Date.now() / 1000
    for (const a of Object.values(agents)) if (isOnDuty(a, now)) m[a.department] = (m[a.department] ?? 0) + 1
    return m
  }, [agents])
  return (
    <div className="panel-body">
      <h4>Cinematic tours</h4>
      <div className="btns">{TOURS.map((t) => <button key={t.id} onClick={() => startTour(t.id)}>{t.label}</button>)}</div>
      <h4>Facilities</h4>
      {FACILITIES.map((f) => (
        <div key={f.id} className="fac">
          <div className="fac-head"><span className="swatch" style={{ background: f.accent }} /><b>{f.name}</b>{counts[f.id] ? <span className="pill sm">{counts[f.id]} on duty</span> : null}</div>
          <div className="fac-desc">{f.description}</div>
          <div className="btns">
            <button onClick={() => { useStore.getState().enterInterior(null); setCameraMode('orbit'); select({ kind: 'facility', id: f.id }) }}>View</button>
            {INTERIORS[f.id] && <button onClick={() => { setCameraMode('orbit'); enterAt(f.id) }}>Enter</button>}
            {INTERIORS[f.id] && <button onClick={() => { enterAt(f.id); setCameraMode('firstperson') }}>Walk in</button>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ inspector
const inspIn = {
  initial: { opacity: 0, x: 40 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 40, transition: FAST },
  transition: EASE,
}

/** Animates the inspector in/out and cross-fades when the selection changes. */
function InspectorPresence() {
  const key = useStore((s) => (s.selection ? `${s.selection.kind}:${s.selection.id}` : ''))
  return <AnimatePresence mode="wait">{key && <Inspector key={key} />}</AnimatePresence>
}

function Inspector() {
  useTick(1000)
  const selection = useStore((s) => s.selection)
  const agents = useStore((s) => s.agents)
  const tasks = useStore((s) => s.tasks)
  const select = useStore((s) => s.select)
  const follow = useStore((s) => s.follow)
  const [detail, setDetail] = useState<{ events: HookEvent[] } | null>(null)
  const a = selection?.kind === 'agent' ? agents[selection.id] : undefined
  useEffect(() => {
    if (!a) return
    let alive = true
    fetch(`/api/agents/${encodeURIComponent(a.id)}`).then((r) => r.json()).then((d) => alive && setDetail(d)).catch(() => setDetail(null))
    return () => { alive = false }
  }, [a?.id, a?.last_event_at]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!selection) return null
  if (selection.kind === 'aircraft') {
    const names: Record<string, string> = { shuttle: 'Imperial Shuttle (Lambda-inspired)', xwing: 'Unidentified starfighter (X-wing-inspired)', freighter: 'Impounded light freighter (Falcon-inspired)', walker: 'Heavy assault walker (AT-AT-inspired)', dump: 'Fuel depot and fuel truck', picket: 'Picket TIE-inspired fighter', gunship: 'Bounty hunter gunship (Razor Crest-inspired)', barge: 'Hutt sail barge (inspired by the desert pleasure craft)', destroyer: 'Star Destroyer (inspired)' }
    return (
      <motion.div className="inspector" {...inspIn}>
        <div className="ins-head"><div><div className="ins-kind">{selection.id === 'walker' ? 'SIMULATED GROUND UNIT' : selection.id === 'destroyer' ? 'SIMULATED CAPITAL SHIP' : selection.id === 'dump' ? 'SIMULATED INSTALLATION' : 'SIMULATED AIRCRAFT'}</div><div className="ins-name">{names[selection.id] ?? `TIE-inspired fighter ${selection.id}`}</div></div><button className="icon-btn" aria-label="Close inspector" title="Close (Esc)" onClick={() => select(null)}><IconClose /></button></div>
        <div className="sim-note">Environmental simulation only. Not an AI agent, not real telemetry.</div>
        {selection.id !== 'dump' && <div className="btns"><button onClick={() => follow({ kind: 'aircraft', id: selection.id })}>Follow with camera</button></div>}
      </motion.div>
    )
  }
  if (selection.kind === 'facility') {
    const f = facilityById[selection.id]
    return (
      <motion.div className="inspector" {...inspIn}>
        <div className="ins-head"><div><div className="ins-kind">FACILITY</div><div className="ins-name">{f.name}</div></div><button className="icon-btn" aria-label="Close inspector" title="Close (Esc)" onClick={() => select(null)}><IconClose /></button></div>
        <div className="fac-desc">{f.description}</div>
        {INTERIORS[f.id] && <div className="btns"><button onClick={() => enterAt(f.id)}>Enter</button></div>}
      </motion.div>
    )
  }
  if (!a) return null
  const parent = a.parent_id ? agents[a.parent_id] : undefined
  const myTasks = Object.values(tasks).filter((t) => t.agent_id === a.id).sort((x, y) => y.started_at - x.started_at)
  const t = a.tokens
  return (
    <motion.div className="inspector" {...inspIn}>
      <div className="ins-head">
        <div>
          <div className="ins-kind">{isOnDuty(a, Date.now() / 1000) ? '● LIVE' : '○ OFF DUTY'} {(a.client_label ?? 'Claude Code').toUpperCase()} AGENT</div>
          <div className="ins-name">{a.name}</div>
          <div className="ins-role">{a.role} · {a.kind === 'main' ? 'Main session agent' : `Subagent (${a.agent_type ?? 'type not reported'})`}</div>
        </div>
        <button className="icon-btn" aria-label="Close inspector" title="Close (Esc)" onClick={() => select(null)}><IconClose /></button>
      </div>
      <div className="ins-status" style={{ borderColor: STATUS_COLOR[a.status] }}>
        <StatusDot s={a.status} /> <b>{a.status.toUpperCase()}</b>
        <div className="ins-activity">{a.activity_known ? a.activity : `Current activity unknown — last confirmed event: ${a.last_event} (${ago(a.last_event_at)})`}</div>
      </div>
      <div className="grid2">
        <div className="kv"><span>Department</span><b>{facilityById[a.department]?.name ?? a.department}</b></div>
        <div className="kv"><span>Model</span><b>{a.model ?? 'not reported'}</b></div>
        <div className="kv"><span>Session</span><b className="mono">{a.session_id.slice(0, 8)}…</b></div>
        <div className="kv"><span>Project</span><b>{a.project ?? '—'}</b></div>
        <div className="kv"><span>Parent agent</span><b className={parent ? 'link' : ''} onClick={() => parent && select({ kind: 'agent', id: parent.id })}>{parent ? parent.name : '— (Commander)'}</b></div>
        <div className="kv"><span>Subagents</span><b>{a.children.length}</b></div>
        <div className="kv"><span>Active tool</span><b>{a.active_tool ? `${a.active_tool}${a.active_tool_target ? ` · ${a.active_tool_target}` : ''}` : '—'}</b></div>
        <div className="kv"><span>Duration</span><b>{dur(a.duration_s)}</b></div>
        <div className="kv"><span>Tool calls</span><b>{a.tool_calls}</b></div>
        <div className="kv"><span>Errors</span><b style={{ color: a.errors ? '#ff6a5d' : undefined }}>{a.errors}</b></div>
        <div className="kv"><span>Tokens (in/out)</span><b>{t ? `${fmtTokens(t.input_tokens)} / ${fmtTokens(t.output_tokens)}` : 'available after the turn completes'}</b></div>
        <div className="kv"><span>Cache read</span><b>{t ? fmtTokens(t.cache_read_input_tokens) : '—'}</b></div>
      </div>
      <div className="section">Current assignment</div>
      <div className="assign">{a.assignment ?? 'Not reported'}</div>
      {a.completion_summary && <><div className="section">Last completion report</div><div className="assign">{a.completion_summary}</div></>}
      {a.last_error && <><div className="section err">Last error</div><div className="assign err">{a.last_error}</div></>}
      <div className="btns">
        <button onClick={() => follow({ kind: 'agent', id: a.id })}>Follow agent</button>
        {INTERIORS[a.department as DepartmentId] && <button onClick={() => enterAt(a.department as DepartmentId)}>Go to department</button>}
      </div>
      <div className="section">Task history</div>
      {myTasks.length === 0 && <div className="empty sm">No tasks recorded.</div>}
      {myTasks.slice(0, 8).map((x) => <TaskRow key={x.id} t={x} agent={a} />)}
      <div className="section">Recent events</div>
      <div className="mono">{(detail?.events ?? []).slice(-25).reverse().map((e) => <EventLine key={e.id} e={e} agents={agents} />)}</div>
    </motion.div>
  )
}

// ------------------------------------------------------------------ feed, prompts, help
function Feed() {
  useTick(10000)
  const feed = useStore((s) => s.feed)
  const select = useStore((s) => s.select)
  const [filter, setFilter] = useState<'all' | 'agent' | 'sim'>('all')
  const list = feed.filter((f) => filter === 'all' || f.source === filter).slice(0, 7)
  return (
    <motion.div className="feed" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={EASE}>
      <div className="feed-tabs">
        {(['all', 'agent', 'sim'] as const).map((f) => (
          <button key={f} className={`mode ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
            {filter === f && <motion.span layoutId="feed-hl" className="mode-hl" transition={EASE} />}
            <span className="lbl">{f === 'agent' ? 'REAL AGENTS' : f === 'sim' ? 'SIMULATION' : 'ALL'}</span>
          </button>
        ))}
      </div>
      <AnimatePresence initial={false}>
        {list.map((f) => (
          <motion.div key={f.id} layout="position" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={EASE} className={`feed-item ${f.tone} ${f.source} ${f.agentId ? 'clickable' : ''}`} onClick={f.agentId ? () => select({ kind: 'agent', id: f.agentId! }) : undefined} title={f.agentId ? 'Inspect this agent' : undefined}>
            <span className="fi-src">{f.source === 'agent' ? 'AGENT' : 'SIM'}</span>
            <span className="fi-text">{f.text}</span>
            <span className="fi-t">{ago(f.ts)}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </motion.div>
  )
}

function DoorPrompt() {
  const [p, setP] = useState<string | null>(null)
  useEffect(() => { doorPrompt.listeners.add(setP); return () => { doorPrompt.listeners.delete(setP) } }, [])
  return (
    <AnimatePresence>
      {p && <motion.div key="door" className="door-prompt" style={{ x: '-50%' }} initial={{ opacity: 0, y: 10, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6 }} transition={FAST}>{p}</motion.div>}
    </AnimatePresence>
  )
}

function Alert() {
  const xwing = useSimStatus((s) => s.xwingActive)
  const runaway = useSimStatus((s) => s.freighterPhase === 'liftoff' || s.freighterPhase === 'escape')
  const x = xwing || runaway
  return (
    <AnimatePresence>
      {x && (
        <motion.div key="alert" role="alert" className="alert-banner" style={{ x: '-50%' }} initial={{ opacity: 0, y: -24, scaleX: 0.6 }} animate={{ opacity: [1, 0.6, 1], y: 0, scaleX: 1 }} exit={{ opacity: 0, y: -16, transition: FAST }} transition={{ ...EASE, opacity: { duration: 1.2, repeat: Infinity, ease: 'easeInOut' } }}>
          <IconAlert size={16} className="al-ico" /> {xwing ? 'HOSTILE STARFIGHTER ATTACKING — EASTERN SECTOR' : 'IMPOUNDED FREIGHTER ESCAPING — PAD 3'} · <span>simulation</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** The agents blocked on the Commander, most recent first. Click to inspect; dismiss per occurrence. */
function AttentionBanner() {
  useTick(5000)
  const agents = useStore((s) => s.agents)
  const select = useStore((s) => s.select)
  const [dismissed, setDismissed] = useState<Record<string, number>>({})
  const now = Date.now() / 1000
  const list = Object.values(agents)
    .filter((a) => needsAttention(a, now) && dismissed[a.id] !== a.last_event_at)
    .sort((a, b) => b.last_event_at - a.last_event_at)
  const a = list[0]
  return (
    <AnimatePresence>
      {a && (
        <motion.div key={`${a.id}:${a.last_event_at}`} role="alert" className={`attn-banner ${a.status === 'failed' ? 'failed' : ''}`} style={{ x: '-50%' }} initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10, transition: FAST }} transition={EASE}>
          <button className="attn-main" onClick={() => { useStore.getState().setPanel('agents'); select({ kind: 'agent', id: a.id }) }}>
            <IconAlert size={15} />
            <span><b>{a.name}</b> {a.status === 'failed' ? 'reports a failed turn' : 'awaits your authorisation'}{a.project ? ` · ${a.project}` : ''}</span>
            <span className="attn-sub">{a.status === 'failed' ? a.last_error ?? a.activity : a.activity} · {ago(a.last_event_at)}{list.length > 1 ? ` · +${list.length - 1} more` : ''}</span>
          </button>
          <button className="icon-btn" aria-label="Dismiss" title="Dismiss" onClick={() => setDismissed((d) => ({ ...d, [a.id]: a.last_event_at }))}><IconClose /></button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Help() {
  const mode = useStore((s) => s.cameraMode)
  const interior = useStore((s) => s.interior)
  const text: Record<CameraMode, string> = {
    orbit: 'Drag to orbit · right-drag to pan · scroll to zoom · click agents, aircraft or building labels',
    tactical: 'Drag to pan · scroll to zoom · top-down tactical overview',
    firstperson: 'Click to lock the mouse · WASD to move · Shift to run · E at doors · Esc to release',
    thirdperson: 'WASD to move · drag to turn the camera · scroll to zoom · Shift to run · E at doors',
    cinematic: 'Automated camera tour — pick another tour in Facilities, or press 1 to return',
    follow: 'Following target — press 1 to return to the exterior view',
  }
  return <div className="help">{interior ? `INSIDE: ${INTERIORS[interior]?.title ?? interior} · ` : ''}{text[mode]} · [ ] command panels · N time of day · S sound · H hides the HUD</div>
}

const TABS = [
  { id: 'agents', label: 'Agents' }, { id: 'missions', label: 'Missions' }, { id: 'events', label: 'Events' },
  { id: 'aircraft', label: 'Air Control' }, { id: 'facilities', label: 'Facilities' },
] as const
type TabId = (typeof TABS)[number]['id']
const TAB_ORDER: TabId[] = ['agents', 'missions', 'events', 'aircraft', 'facilities']
const PANELS: Record<TabId, () => React.JSX.Element> = { agents: AgentsPanel, missions: MissionsPanel, events: EventsPanel, aircraft: AircraftPanel, facilities: FacilitiesPanel }
const BUSY = new Set<AgentInfo['status']>(['working', 'delegating'])

export function HUD() {
  const { panel, setPanel, hudVisible } = useStore()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return
      const st = useStore.getState()
      const map: Record<string, CameraMode> = { Digit1: 'orbit', Digit2: 'tactical', Digit3: 'firstperson', Digit4: 'thirdperson', Digit5: 'cinematic' }
      if (map[e.code]) st.setCameraMode(map[e.code])
      if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
        const dir = e.code === 'BracketRight' ? 1 : -1
        const cur = st.panel ? TAB_ORDER.indexOf(st.panel) : -1
        st.setPanel(TAB_ORDER[(cur + dir + TAB_ORDER.length) % TAB_ORDER.length])
      }
      if (e.code === 'Escape' && st.selection && st.cameraMode !== 'firstperson') st.select(null)
      if (e.code === 'KeyH') st.toggleHud()
      if (e.code === 'KeyL') st.toggleLabels()
      if (e.code === 'KeyS' && st.cameraMode !== 'firstperson' && st.cameraMode !== 'thirdperson') useSound.getState().toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const Panel = panel ? PANELS[panel] : null
  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {hudVisible && <TopBar key="top" />}
        {hudVisible && (
          <motion.div key="side" className={`side ${panel ? '' : 'collapsed'}`} initial={{ x: -380, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -380, opacity: 0 }} transition={EASE}>
            <div className="tabs" role="tablist" aria-label="Command panels">
              {TABS.map((t) => (
                <button key={t.id} role="tab" aria-selected={panel === t.id} title="Click again to collapse. [ and ] switch panels." className={panel === t.id ? 'on' : ''} onClick={() => setPanel(panel === t.id ? null : t.id)}>
                  {panel === t.id && <motion.span layoutId="tab-hl" className="tab-hl" transition={EASE} />}
                  <span className="lbl">{t.label}</span>
                </button>
              ))}
            </div>
            <AnimatePresence mode="wait" initial={false}>
              {Panel && (
                <motion.div key={panel} role="tabpanel" className="panel-wrap" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={FAST}>
                  <Panel />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
        {hudVisible && <Feed key="feed" />}
      </AnimatePresence>
      {hudVisible && <InspectorPresence />}
      <DoorPrompt />
      <Alert />
      <AttentionBanner />
      {hudVisible && <Help />}
    </MotionConfig>
  )
}

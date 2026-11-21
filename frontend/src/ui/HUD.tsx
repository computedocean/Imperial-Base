import { AnimatePresence, MotionConfig, motion, type Transition } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { STATUS_COLOR } from '../agents/AgentLayer'
import { dutyCounts, dutyOf, isOnDuty, needsAttention, rosterRank, statsSince } from '../agents/liveness'
import { SoundControl, SoundMixPanel, useSound } from '../audio/AudioLayer'
import { doorPrompt, enterAt, exitInterior } from '../camera/CameraRig'
import { INTERIORS } from '../interiors/layouts'
import { FEED_MORE, FEED_PAGE, FEED_SEVERITY, feedCounts, filterFeed, stripSimPrefix, type FeedFilter } from '../lib/feed'
import { stepIndex } from '../lib/search'
import { commands, useSimStatus } from '../sim/world'
import { QUALITY, TIMES_OF_DAY, useStore, type CameraMode, type PanelId, type Quality, type RosterFilter } from '../state/store'
import type { AgentInfo, HookEvent, TaskInfo } from '../state/types'
import { CommandPalette, PANEL_LABEL, TOURS } from './CommandPalette'
import { Chips, Crest, Empty, SearchField, SectionHead, SourceTag, StatusDot, activate, ago, dur, fmtTokens, useTick } from './common'
import {
  IconActivity, IconAgents, IconAlert, IconBranch, IconClock, IconClose, IconEvents, IconFacility, IconMissions, IconMoon, IconOverview,
  IconRadar, IconSearch, IconShield, IconSliders, IconSun,
} from './icons'
import { IsbPanel } from './Isb'
import { OrdersChat } from './OrdersChat'
import { OverviewPanel } from './Overview'
import { FACILITIES, PLANET, facilityById, type DepartmentId } from '../world/layout'

// shared motion presets (UI only; the 3D scene is driven by three.js, not motion)
const EASE: Transition = { type: 'spring', stiffness: 420, damping: 38, mass: 0.8 }
const FAST: Transition = { duration: 0.16, ease: [0.2, 0.7, 0.2, 1] }
const rowIn = {
  initial: { opacity: 0, x: -8 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, transition: FAST },
  transition: EASE,
}

/** Frames per second, read once a second from the renderer statistics the scene publishes. */
function FrameRate() {
  const [s, setS] = useState<{ fps: number; calls: number; triangles: number } | null>(null)
  useEffect(() => {
    const id = setInterval(() => setS((window as any).__imperialStats ?? null), 1000)
    return () => clearInterval(id)
  }, [])
  if (!s) return <span className="muted">measuring…</span>
  const tone = s.fps >= 50 ? 'ok' : s.fps >= 30 ? 'warn' : 'bad'
  return <span className={`t-${tone} mono`} title={`${s.calls} draw calls, ${s.triangles.toLocaleString()} triangles per frame`}>{s.fps} fps · {s.calls} draws</span>
}

function agentHaystack(a: AgentInfo) {
  return `${a.name} ${a.role} ${a.status} ${a.active_tool ?? ''} ${a.project ?? ''} ${a.department} ${facilityById[a.department]?.name ?? ''} ${a.assignment ?? ''} ${a.client_label ?? ''}`.toLowerCase()
}

function matchesRoster(a: AgentInfo, filter: RosterFilter, query: string, now: number, dept: string) {
  if (filter === 'live' && !isOnDuty(a, now)) return false
  if (filter === 'attention' && !needsAttention(a, now)) return false
  if (filter === 'working' && a.status !== 'working' && a.status !== 'delegating' && a.status !== 'active') return false
  if (filter === 'waiting' && a.status !== 'waiting' && a.status !== 'idle') return false
  if (filter === 'failed' && a.status !== 'failed') return false
  if (dept !== 'all' && a.department !== dept) return false
  return !query || agentHaystack(a).includes(query)
}

// ------------------------------------------------------------------ top bar
const MODES: { id: CameraMode; label: string; short: string; key: string }[] = [
  { id: 'orbit', label: 'Exterior', short: 'EXT', key: '1' },
  { id: 'tactical', label: 'Tactical', short: 'TAC', key: '2' },
  { id: 'firstperson', label: 'First person', short: '1ST', key: '3' },
  { id: 'thirdperson', label: 'Third person', short: '3RD', key: '4' },
  { id: 'cinematic', label: 'Cinematic', short: 'CINE', key: '5' },
]

function BaseClock() {
  useTick(1000)
  const tasks = useStore((s) => s.tasks)
  const running = useMemo(() => Object.values(tasks).filter((t) => t.status === 'in_progress').length, [tasks])
  return (
    <div className="clock" title="Local time · missions in progress">
      <IconClock size={13} />
      <span className="mono">{new Date().toLocaleTimeString([], { hour12: false })}</span>
      <span className="ms"><b>{running}</b> in progress</span>
    </div>
  )
}

const TOD_LABEL: Record<string, string> = { golden: 'Golden hour', dusk: 'Dusk', night: 'Night' }

/** Display settings in one menu, so the top bar keeps to status and navigation. */
function DisplayMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const quality = useStore((s) => s.quality)
  const setQuality = useStore((s) => s.setQuality)
  const tod = useStore((s) => s.timeOfDay)
  const setTod = useStore((s) => s.setTimeOfDay)
  const labels = useStore((s) => s.showLabels)
  const toggleLabels = useStore((s) => s.toggleLabels)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); (ref.current?.querySelector('.display-btn') as HTMLElement)?.focus() } }
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key) }
  }, [open])
  return (
    <div className="display" ref={ref}>
      <button type="button" className={`display-btn icon-label ${open ? 'on' : ''}`} aria-expanded={open} aria-controls="display-menu" onClick={() => setOpen((v) => !v)} title="Display, time of day, sound and quality">
        {tod === 'night' ? <IconMoon /> : tod === 'dusk' ? <IconSun /> : <IconSliders />}<span className="lbl">Display</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div id="display-menu" className="popover" role="dialog" aria-label="Display settings" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={FAST}>
            <div className="pop-row"><span className="pop-label">Time of day <kbd>N</kbd></span>
              <Chips label="Time of day" value={tod} onChange={setTod} options={TIMES_OF_DAY.map((t) => [t, TOD_LABEL[t]] as const)} />
            </div>
            <div className="pop-row"><span className="pop-label">Graphics quality</span>
              <Chips label="Graphics quality" value={quality} onChange={(q) => setQuality(q as Quality)} options={(Object.keys(QUALITY) as Quality[]).map((q) => [q, q[0].toUpperCase() + q.slice(1)] as const)} />
            </div>
            <div className="pop-row"><span className="pop-label">Sound <kbd>S</kbd></span><SoundControl /></div>
            <div className="pop-row inline">
              <label className="switch"><input type="checkbox" checked={labels} onChange={toggleLabels} /> <span>Building labels <kbd>L</kbd></span></label>
            </div>
            <div className="pop-row inline"><span className="pop-label">Renderer</span><FrameRate /></div>
            <div className="pop-foot">Remembered in this browser. <kbd>H</kbd> hides the whole interface.</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
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
  const connected = useStore((s) => s.connected)
  const demo = useStore((s) => s.demo)
  const ingest = useStore((s) => s.ingest)
  const cameraMode = useStore((s) => s.cameraMode)
  const setCameraMode = useStore((s) => s.setCameraMode)
  const agents = useStore((s) => s.agents)
  const interior = useStore((s) => s.interior)
  const now = Date.now() / 1000
  const duty = useMemo(() => dutyCounts(Object.values(agents), now), [agents, Math.floor(now / 15)]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const bits = [duty.attention ? `${duty.attention} need you` : '', duty.busy ? `${duty.busy} working` : ''].filter(Boolean)
    document.title = `${bits.length ? `(${bits.join(' · ')}) ` : ''}${demo ? '[DEMO] ' : ''}Imperial Base`
  }, [duty.attention, duty.busy, demo])
  const link = demo ? { cls: 'demo', text: 'Demo data', title: 'Fictional demo data. The live link is not opened in demo mode. Remove ?demo=1 from the address for live data.' }
    : connected ? { cls: 'ok', text: 'Link live', title: 'Connected to the local Imperial Base server' }
    : { cls: 'bad', text: 'Link offline', title: 'The local server is not reachable. Retrying.' }
  return (
    <motion.header className="topbar" initial={{ y: -56, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -56, opacity: 0 }} transition={EASE}>
      <div className="brand">
        <Crest size={30} />
        <div className="brand-text">
          <div className="title">Imperial Base</div>
          <div className="sub">{PLANET.installation} · {PLANET.name}</div>
        </div>
      </div>
      <div className="status" role="status" aria-label="Base status">
        <span className={`stat link ${link.cls}`} title={link.title}><span className="ind" aria-hidden="true" />{link.text}</span>
        {duty.attention > 0 && <button type="button" className="stat attn" onClick={showAttention} title="Agents waiting for your permission, or whose last turn failed"><IconAlert size={13} />{duty.attention} need{duty.attention === 1 ? 's' : ''} you</button>}
        <span className={`stat ${duty.busy ? 'busy' : ''}`} title="Agents confirmed working right now"><b>{duty.busy}</b> working</span>
        <span className="stat" title="Agents on the base awaiting orders, or whose current activity is unknown"><b>{duty.standby}</b> standby</span>
        {!demo && ingest && !ingest.hook_installed && <span className="stat warn" title={`Run: python scripts\\install_hooks.py (spool: ${ingest.spool})`}>Hook not installed</span>}
      </div>
      <div className="bar-right">
        <button type="button" className="search-btn" onClick={() => useStore.getState().setPaletteOpen(true)} title="Search the base (Ctrl+K or /)" aria-label="Search the base">
          <IconSearch size={14} /><span className="lbl">Search</span><kbd>Ctrl K</kbd>
        </button>
        <div className="modes" role="group" aria-label="Camera mode">
          {MODES.map((m) => (
            <button type="button" key={m.id} aria-pressed={cameraMode === m.id} className={`mode ${cameraMode === m.id ? 'on' : ''}`} onClick={() => setCameraMode(m.id)} title={`${m.label} (key ${m.key})`}>
              <span className="lbl long">{m.label}</span><span className="lbl short" aria-hidden="true">{m.short}</span>
            </button>
          ))}
          <AnimatePresence>
            {interior && <motion.button type="button" key="exit" className="mode exit" onClick={() => exitInterior()} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={FAST}>Exit {facilityById[interior].short}</motion.button>}
          </AnimatePresence>
        </div>
        <BaseClock />
        <DisplayMenu />
      </div>
    </motion.header>
  )
}

// ------------------------------------------------------------------ agent roster
function AgentRow({ a, depth, all, visible }: { a: AgentInfo; depth: number; all: Record<string, AgentInfo>; visible: (a: AgentInfo) => boolean }) {
  const select = useStore((s) => s.select)
  const follow = useStore((s) => s.follow)
  const sel = useStore((s) => s.selection?.kind === 'agent' && s.selection.id === a.id)
  const kids = a.children.map((c) => all[c]).filter((k): k is AgentInfo => !!k && visible(k))
  const duty = dutyOf(a, Date.now() / 1000)
  return (
    <>
      <motion.div layout="position" {...rowIn} role="button" tabIndex={0} aria-pressed={sel} className={`agent-row ${sel ? 'sel' : ''} duty-${duty}`} style={{ paddingLeft: 10 + depth * 16 }}
        title="Enter or click to inspect · double-click to follow" onClick={() => select({ kind: 'agent', id: a.id })} onDoubleClick={() => duty !== 'off' && follow({ kind: 'agent', id: a.id })}
        onKeyDown={activate(() => select({ kind: 'agent', id: a.id }))}>
        {depth > 0 && <IconBranch className="branch" size={12} />}
        <StatusDot s={a.status} />
        <div className="ar-main">
          <div className="ar-name">
            <span className="ar-n">{a.name}</span>
            {duty === 'attention' && <span className="badge crit">{a.status === 'failed' ? 'Failed' : 'Needs you'}</span>}
            {a.client && a.client !== 'claude-code' && <span className="badge">{a.client_label ?? a.client}</span>}
            <span className="ar-time">{ago(a.last_event_at)}</span>
          </div>
          <div className="ar-sub"><span className="ar-role">{a.role}</span> · <span className={`st-text st-${a.status}`}>{a.status}</span>{a.active_tool ? ` · ${a.active_tool}` : ''} · {facilityById[a.department]?.short ?? a.department}{a.project ? ` · ${a.project}` : ''}{a.stale ? ' · activity unknown' : ''}</div>
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
  const cells: [string, string, string?][] = [
    [String(st.sessions), 'sessions'], [String(st.subagents), 'subagents'], [String(missions), 'missions'],
    [fmtTokens(st.toolCalls), 'tool calls'], [String(st.errors), 'errors', st.errors ? 'err' : ''], [st.tokens ? fmtTokens(st.tokens) : '—', 'tokens'],
  ]
  return (
    <dl className="daystats" title="Totals for agents that reported at least one event since local midnight. Tokens are whole-session totals, read after each turn.">
      {cells.map(([v, k, cls]) => <div key={k}><dd className={cls}>{v}</dd><dt>{k}</dt></div>)}
    </dl>
  )
}

const ROSTER_FILTERS = [['live', 'On duty'], ['working', 'Working'], ['attention', 'Needs you'], ['waiting', 'Standby'], ['failed', 'Failed'], ['all', 'All']] as const

function AgentsPanel() {
  useTick(5000)
  const agents = useStore((s) => s.agents)
  const ingest = useStore((s) => s.ingest)
  const connected = useStore((s) => s.connected)
  const demo = useStore((s) => s.demo)
  const filter = useStore((s) => s.rosterFilter)
  const setFilter = useStore((s) => s.setRosterFilter)
  const [showAll, setShowAll] = useState(false)
  const [query, setQuery] = useState('')
  const [dept, setDept] = useState('all')
  const q = query.trim().toLowerCase()
  const bucket = Math.floor(Date.now() / 5000) // re-evaluate the time-based rules with the 5 s tick
  const self = useMemo(() => (a: AgentInfo) => {
    const t = Date.now() / 1000
    // ended and long-silent agents stay out unless asked for (the "All" filter or the checkbox)
    const recent = showAll || filter === 'all' || isOnDuty(a, t) || (a.status === 'completed' && t - a.last_event_at < 3600)
    return recent && matchesRoster(a, filter, q, t, dept)
  }, [showAll, filter, q, dept, bucket]) // eslint-disable-line react-hooks/exhaustive-deps
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
  const unfiltered = !q && filter === 'live' && dept === 'all'
  const live = connected || demo
  return (
    <div className="panel-body">
      <DayStats />
      <div className="panel-tools">
        <SearchField value={query} onChange={setQuery} label="Search name, role, tool, project" />
        <Chips label="Agent status" value={filter} onChange={setFilter} options={ROSTER_FILTERS} />
        <div className="tool-row">
          <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
            <option value="all">All departments</option>
            {FACILITIES.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <label className="switch"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> <span>Include ended</span></label>
          <span className="tool-count" aria-live="polite">{shown} shown</span>
        </div>
      </div>
      {!live && <Empty title="Agent link offline" tone="bad">The local server is not reachable. Start it with <code>start.cmd</code>. The scenery simulation keeps running.</Empty>}
      {live && roots.length === 0 && unfiltered && (
        <Empty title={Object.keys(agents).length ? 'No agents on duty' : 'No agents have reported yet'}>
          {Object.keys(agents).length ? 'Start a Claude Code session, or choose "All" to see past ones.' : 'Every Claude Code session on this machine appears here once the capture hook is installed.'}
          {ingest && !ingest.hook_installed && <><br />Install the hook once: <code>python scripts\install_hooks.py</code>, then start any session.</>}
        </Empty>
      )}
      {live && roots.length === 0 && !unfiltered && <Empty title="No agents match">Clear the search or choose another filter.</Empty>}
      <div className="roster" role="list" aria-label="Agents">
        <AnimatePresence initial={false}>{roots.map((a) => <AgentRow key={a.id} a={a} depth={0} all={agents} visible={visible} />)}</AnimatePresence>
      </div>
      <div className="legend" aria-label="Status colours">
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
  const [filter, setFilter] = useState<'open' | 'completed' | 'failed' | 'all'>('all')
  const q = query.trim().toLowerCase()
  const all = Object.values(tasks)
  const counts = { all: all.length, open: 0, completed: 0, failed: 0 }
  for (const t of all) { if (t.status === 'in_progress') counts.open++; else if (t.status === 'completed') counts.completed++; else if (t.status === 'failed') counts.failed++ }
  const list = useMemo(() => Object.values(tasks).filter((t) => {
    if (filter === 'open' && t.status !== 'in_progress') return false
    if (filter === 'completed' && t.status !== 'completed') return false
    if (filter === 'failed' && t.status !== 'failed') return false
    if (!q) return true
    const agent = agents[t.agent_id]
    return `${t.title} ${t.summary ?? ''} ${t.status} ${t.kind} ${agent?.name ?? ''} ${agent?.role ?? ''}`.toLowerCase().includes(q)
  }).sort((a, b) => b.started_at - a.started_at).slice(0, 80), [tasks, agents, filter, q])
  return (
    <>
      <div className="panel-body">
        <div className="panel-tools">
          <SearchField value={query} onChange={setQuery} label="Search missions" />
          <Chips label="Mission status" value={filter} onChange={setFilter}
            options={[['all', 'All', counts.all], ['open', 'In progress', counts.open], ['completed', 'Done', counts.completed], ['failed', 'Failed', counts.failed]] as const} />
        </div>
        {list.length === 0 && (q || filter !== 'all'
          ? <Empty title="No missions match">Clear the search or choose another filter.</Empty>
          : <Empty title="No missions recorded yet">Every prompt to a Claude Code session, and every delegation to a subagent, becomes a mission. Orders below start one too.</Empty>)}
        <div role="list" aria-label="Missions">
          <AnimatePresence initial={false}>{list.map((t) => <TaskRow key={t.id} t={t} agent={agents[t.agent_id]} onClick={() => select({ kind: 'agent', id: t.agent_id })} />)}</AnimatePresence>
        </div>
      </div>
      <OrdersChat />
    </>
  )
}

const TASK_TONE: Record<TaskInfo['status'], string> = { completed: 'ok', failed: 'bad', interrupted: 'idle', in_progress: 'live' }
function TaskRow({ t, agent, onClick }: { t: TaskInfo; agent?: AgentInfo; onClick?: () => void }) {
  const interactive = onClick ? { role: 'button', tabIndex: 0, onClick, onKeyDown: activate(onClick), title: 'Inspect the agent' } : { role: 'listitem' }
  return (
    <motion.div layout="position" {...rowIn} className={`task-row ${onClick ? 'clickable' : ''}`} {...interactive}>
      <div className="tr-head">
        <span className={`tag tone-${TASK_TONE[t.status]}`}>{t.status.replace('_', ' ')}</span>
        <span className="tr-kind">{t.kind === 'turn' ? 'Orders' : t.kind === 'report' ? 'Report' : 'Delegation'}</span>
        <span className="tr-time">{ago(t.started_at)}</span>
      </div>
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
  const [kind, setKind] = useState<'all' | 'errors' | 'tools' | 'lifecycle'>('all')
  const q = query.trim().toLowerCase()
  const isErr = (e: HookEvent) => e.event.includes('Fail') || !!e.error
  const list = useMemo(() => events.filter((e) => {
    if (kind === 'errors' && !isErr(e)) return false
    if (kind === 'tools' && !e.event.includes('ToolUse')) return false
    if (kind === 'lifecycle' && e.event.includes('ToolUse')) return false
    if (!q) return true
    const a = agents[e.agent_id ? `agent:${e.agent_id}` : `session:${e.session_id}`]
    return `${e.event} ${e.tool_name ?? ''} ${e.tool_target ?? ''} ${e.error ?? ''} ${e.delegation ?? ''} ${a?.name ?? ''} ${e.agent_type ?? ''}`.toLowerCase().includes(q)
  }).slice(-150).reverse(), [events, agents, q, kind])
  const failures = events.filter(isErr).length
  return (
    <div className="panel-body">
      <div className="panel-tools">
        <SearchField value={query} onChange={setQuery} label="Search events, tools, agents" />
        <Chips label="Event type" value={kind} onChange={setKind} options={[['all', 'All', events.length], ['errors', 'Errors', failures], ['tools', 'Tools'], ['lifecycle', 'Lifecycle']] as const} />
      </div>
      <div className="event-log mono" role="log" aria-label="Hook events, newest first">
        <div className="ev ev-headrow" aria-hidden="true"><span>Time</span><span>Event</span><span>Agent</span></div>
        {list.map((e) => <EventLine key={e.id} e={e} agents={agents} />)}
      </div>
      {list.length === 0 && (events.length ? <Empty title="No events match">Clear the search or choose another type.</Empty> : <Empty title="No hook events received yet">Events stream in live once a session with the capture hook runs.</Empty>)}
      {list.length > 0 && <div className="list-foot">Newest {list.length} of the last {events.length} events held in this browser.</div>}
    </div>
  )
}

function EventLine({ e, agents }: { e: HookEvent; agents: Record<string, AgentInfo> }) {
  const a = agents[e.agent_id ? `agent:${e.agent_id}` : `session:${e.session_id}`]
  const detail = e.tool_name ? `${e.tool_name}${e.tool_target ? ` (${e.tool_target})` : ''}` : e.delegation ?? e.notification_type ?? e.reason ?? e.source ?? ''
  return (
    <div className={`ev ${e.event.includes('Fail') || e.error ? 'err' : ''}`}>
      <span className="ev-t">{new Date(e.ts).toLocaleTimeString([], { hour12: false })}</span>
      <span className="ev-n">{e.event}</span>
      <span className="ev-a">{a?.name ?? (e.agent_type ?? e.session_id.slice(0, 8))}</span>
      {(detail || e.error) && <span className="ev-d">{detail}{e.error ? ` — ${e.error}` : ''}</span>}
    </div>
  )
}

// ------------------------------------------------------------------ aircraft control (scenery)
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
const viewAt = (id: string) => { const st = useStore.getState(); st.enterInterior(null); st.setCameraMode('orbit'); st.select({ kind: 'aircraft', id }) }

function Kv({ k, v, onClick, tone }: { k: string; v: React.ReactNode; onClick?: () => void; tone?: string }) {
  if (onClick) return <div className="kv clickable" role="button" tabIndex={0} onClick={onClick} onKeyDown={activate(onClick)}><span>{k}</span><b className={tone}>{v}</b></div>
  return <div className="kv"><span>{k}</span><b className={tone}>{v}</b></div>
}

function Progress({ value }: { value: number }) {
  return <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}><motion.div animate={{ scaleX: value }} transition={{ duration: 0.4, ease: 'linear' }} style={{ originX: 0 }} /></div>
}

function AircraftPanel() {
  const s = useSimStatus()
  const follow = useStore((x) => x.follow)
  const startTour = useStore((x) => x.startTour)
  const phaseLabel: Record<string, string> = { away: 'In deep space', approach: 'On approach', descent: 'Final descent', landed: 'On the pad', liftoff: 'Lifting off', climbout: 'Climbing out' }
  return (
    <div className="panel-body air">
      <div className="notice sim"><SourceTag kind="sim" /> Environmental simulation. Aircraft and ground units are scenery, not telemetry and not agents.</div>
      <section className="card">
        <SectionHead title="Imperial shuttle" meta={phaseLabel[s.shuttlePhase]} />
        <Progress value={s.shuttleProgress} />
        <div className="btns">
          <button className="primary" onClick={commands.shuttleArrive} disabled={s.shuttlePhase !== 'away'}>Trigger arrival</button>
          <button onClick={commands.shuttleDepart} disabled={s.shuttlePhase !== 'landed'}>Clear departure</button>
          <button className="ghost" onClick={() => follow({ kind: 'aircraft', id: 'shuttle' })}>Follow</button>
          <button className="ghost" onClick={() => startTour('shuttle')}>Pad camera</button>
        </div>
        <label className="switch"><input type="checkbox" checked={s.shuttleAuto} onChange={(e) => commands.setShuttleAuto(e.target.checked)} /> <span>Auto-depart after 45 s on the pad</span></label>
      </section>
      <section className="card">
        <SectionHead title="TIE patrols" meta={s.patrolActive ? 'airborne' : 'in the hangar'} />
        <div className="btns">
          <button className="primary" onClick={() => commands.startPatrol()} disabled={s.patrolActive}>Launch patrols</button>
          <button onClick={commands.stopPatrol} disabled={!s.patrolActive}>Recall to hangar</button>
        </div>
        {s.fighters.map((f) => <Kv key={f.id} k={f.callsign} v={f.state} onClick={() => follow({ kind: 'aircraft', id: f.id })} />)}
      </section>
      <section className="card">
        <SectionHead title="Unidentified contacts" meta={s.xwingActive ? 'attack under way' : 'none'} />
        <div className="btns">
          <button className="danger" onClick={() => { commands.xwingFlyby(); watch('xwing') }} disabled={s.xwingActive}>Watch the attack</button>
          <button onClick={commands.xwingFlyby} disabled={s.xwingActive}>Simulate attack</button>
          <button className="ghost" onClick={() => follow({ kind: 'aircraft', id: 'xwing' })} disabled={!s.xwingActive}>Track contact</button>
        </div>
        <Kv k="Attack run" v="three X-wings: shoot down a picket TIE, then strafe the fuel depot" />
        <Kv k="Fuel depot (east apron)" v={s.dumpBurning ? 'BURNING' : 'intact'} tone={s.dumpBurning ? 't-bad' : undefined} onClick={() => viewAt('dump')} />
        <Kv k="Intercept" v={s.patrolActive ? 'interceptor pair will pursue' : 'patrols down, no intercept'} />
      </section>
      <section className="card">
        <SectionHead title="Impounded freighter · Pad 3" meta={FREIGHTER_LABEL[s.freighterPhase]} />
        <Progress value={s.freighterProgress} />
        <div className="btns">
          <button className="danger" onClick={commands.freighterEscape} disabled={s.freighterPhase !== 'impounded'}>Stage an escape</button>
          <button className="ghost" onClick={() => follow({ kind: 'aircraft', id: 'freighter' })} disabled={s.freighterPhase === 'away'}>Follow</button>
          <button className="ghost" onClick={() => viewAt('freighter')}>View pad</button>
        </div>
        <label className="switch"><input type="checkbox" checked={s.freighterAuto} onChange={(e) => commands.setFreighterAuto(e.target.checked)} /> <span>Escapes on its own every few minutes</span></label>
      </section>
      <section className="card">
        <SectionHead title="Visitors" />
        <Kv k="Star Destroyer" v={DESTROYER_LABEL[s.destroyerPhase]} />
        <Kv k="Bounty hunter gunship" v={GUNSHIP_LABEL[s.gunshipPhase]} />
        <Kv k="Hutt sail barge" v="cruising the dunes" />
        <div className="btns">
          <button className="primary" onClick={() => { if (s.destroyerPhase === 'away') commands.destroyerArrive(); useStore.getState().watchTour('destroyer') }}>{s.destroyerPhase === 'away' ? 'Watch it arrive' : 'Watch destroyer'}</button>
          <button onClick={commands.destroyerArrive} disabled={s.destroyerPhase !== 'station'}>Order jump</button>
          <button className="ghost" onClick={() => watch('gunship')} disabled={s.gunshipPhase === 'away'}>Follow gunship</button>
          <button className="ghost" onClick={() => watch('barge')}>Follow sail barge</button>
        </div>
      </section>
      <section className="card">
        <SectionHead title="Ground forces and shows" />
        <Kv k="Hooded knight and 36 clone troopers" v={s.marching ? 'on the march' : 'standing by'} />
        <Kv k="Duel on Pad 2" v="in progress" />
        <Kv k="Heavy walker Thunder-1" v="perimeter patrol" />
        <div className="btns">
          <button className="primary" onClick={() => { if (!s.marching) commands.marchStart(); useStore.getState().watchTour('march') }}>{s.marching ? 'Watch the march' : 'Start the march'}</button>
          <button onClick={() => useStore.getState().watchTour('duel')}>Watch the duel</button>
          <button className="ghost" onClick={() => follow({ kind: 'aircraft', id: 'walker' })}>Follow walker</button>
        </div>
      </section>
      <section className="card">
        <SectionHead title="Hangar Alpha doors" meta={`${Math.round(s.hangarDoor * 100)}% open`} />
        <div className="btns">
          <Chips label="Hangar doors" value={s.hangarMode} onChange={(m) => commands.setHangar(m)} options={[['auto', 'Auto'], ['open', 'Open'], ['closed', 'Closed']] as const} />
          <button className="ghost" onClick={() => startTour('hangar')}>Hangar camera</button>
        </div>
      </section>
      <section className="card"><SoundMixPanel /></section>
    </div>
  )
}

function FacilitiesPanel() {
  const select = useStore((s) => s.select)
  const setCameraMode = useStore((s) => s.setCameraMode)
  const watchTour = useStore((s) => s.watchTour)
  const agents = useStore((s) => s.agents)
  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    const now = Date.now() / 1000
    for (const a of Object.values(agents)) if (isOnDuty(a, now)) m[a.department] = (m[a.department] ?? 0) + 1
    return m
  }, [agents])
  return (
    <div className="panel-body">
      <section className="card">
        <SectionHead title="Cinematic tours" />
        <div className="btns">{TOURS.map((t) => <button key={t.id} className="ghost" onClick={() => watchTour(t.id)}>{t.label}</button>)}</div>
      </section>
      <SectionHead title="Facilities" meta={`${FACILITIES.length} sites`} />
      <ul className="fac-list">
        {FACILITIES.map((f) => (
          <li key={f.id} className="fac" style={{ ['--fac-accent' as string]: f.accent }}>
            <div className="fac-head"><b>{f.name}</b>{counts[f.id] ? <span className="badge ok">{counts[f.id]} on duty</span> : null}</div>
            <div className="fac-desc">{f.description}</div>
            <div className="btns">
              <button onClick={() => { useStore.getState().enterInterior(null); setCameraMode('orbit'); select({ kind: 'facility', id: f.id }) }}>View</button>
              {INTERIORS[f.id] && <button className="ghost" onClick={() => { setCameraMode('orbit'); enterAt(f.id) }}>Enter</button>}
              {INTERIORS[f.id] && <button className="ghost" onClick={() => { enterAt(f.id); setCameraMode('firstperson') }}>Walk in</button>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ------------------------------------------------------------------ inspector
const inspIn = {
  initial: { opacity: 0, x: 24 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 24, transition: FAST },
  transition: EASE,
}

/** Animates the inspector in/out and cross-fades when the selection changes. */
function InspectorPresence() {
  const key = useStore((s) => (s.selection ? `${s.selection.kind}:${s.selection.id}` : ''))
  return <AnimatePresence mode="wait">{key && <Inspector key={key} />}</AnimatePresence>
}

function InsHead({ kind, name, sub, tag }: { kind: string; name: string; sub?: string; tag?: React.ReactNode }) {
  const select = useStore((s) => s.select)
  return (
    <div className="ins-head">
      <div>
        <div className="ins-kind">{kind} {tag}</div>
        <h2 className="ins-name">{name}</h2>
        {sub && <div className="ins-role">{sub}</div>}
      </div>
      <button type="button" className="icon-btn" aria-label="Close inspector" title="Close (Esc)" onClick={() => select(null)}><IconClose /></button>
    </div>
  )
}

function Inspector() {
  useTick(1000)
  const selection = useStore((s) => s.selection)
  const agents = useStore((s) => s.agents)
  const tasks = useStore((s) => s.tasks)
  const demo = useStore((s) => s.demo)
  const storeEvents = useStore((s) => s.events)
  const select = useStore((s) => s.select)
  const follow = useStore((s) => s.follow)
  const [detail, setDetail] = useState<{ events: HookEvent[] } | null>(null)
  const [detailError, setDetailError] = useState(false)
  const a = selection?.kind === 'agent' ? agents[selection.id] : undefined
  useEffect(() => {
    if (!a || demo) return
    let alive = true
    fetch(`/api/agents/${encodeURIComponent(a.id)}`).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => { if (alive) { setDetail(d); setDetailError(false) } })
      .catch(() => { if (alive) setDetailError(true) })
    return () => { alive = false }
  }, [a?.id, a?.last_event_at, demo]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!selection) return null
  if (selection.kind === 'aircraft') {
    const names: Record<string, string> = { shuttle: 'Imperial Shuttle (Lambda-inspired)', xwing: 'Unidentified starfighter (X-wing-inspired)', freighter: 'Impounded light freighter (Falcon-inspired)', walker: 'Heavy assault walker (AT-AT-inspired)', dump: 'Fuel depot and fuel truck', picket: 'Picket TIE-inspired fighter', gunship: 'Bounty hunter gunship (Razor Crest-inspired)', barge: 'Hutt sail barge (inspired by the desert pleasure craft)', destroyer: 'Star Destroyer (inspired)' }
    const kind = selection.id === 'walker' ? 'Simulated ground unit' : selection.id === 'destroyer' ? 'Simulated capital ship' : selection.id === 'dump' ? 'Simulated installation' : 'Simulated aircraft'
    return (
      <motion.aside className="inspector" aria-label="Inspector" {...inspIn}>
        <InsHead kind={kind} name={names[selection.id] ?? `TIE-inspired fighter ${selection.id}`} tag={<SourceTag kind="sim" />} />
        <div className="notice sim">Environmental simulation only. Not an AI agent, not real telemetry.</div>
        {selection.id !== 'dump' && <div className="btns"><button className="primary" onClick={() => follow({ kind: 'aircraft', id: selection.id })}>Follow with camera</button></div>}
      </motion.aside>
    )
  }
  if (selection.kind === 'facility') {
    const f = facilityById[selection.id]
    const here = Object.values(agents).filter((x) => x.department === f.id && isOnDuty(x, Date.now() / 1000))
    return (
      <motion.aside className="inspector" aria-label="Inspector" {...inspIn}>
        <InsHead kind="Facility" name={f.name} sub={f.short} />
        <p className="fac-desc">{f.description}</p>
        <SectionHead title="On duty here" meta={here.length} />
        {here.length === 0 ? <div className="muted small">No agents assigned right now.</div> : (
          <ul className="mini-roster">{here.map((x) => <li key={x.id}><button type="button" onClick={() => select({ kind: 'agent', id: x.id })}><StatusDot s={x.status} /><b>{x.name}</b><span>{x.status} · {ago(x.last_event_at)}</span></button></li>)}</ul>
        )}
        {INTERIORS[f.id] && <div className="btns"><button className="primary" onClick={() => enterAt(f.id)}>Enter</button><button className="ghost" onClick={() => { enterAt(f.id); useStore.getState().setCameraMode('firstperson') }}>Walk in</button></div>}
      </motion.aside>
    )
  }
  if (!a) return null
  const parent = a.parent_id ? agents[a.parent_id] : undefined
  const myTasks = Object.values(tasks).filter((t) => t.agent_id === a.id).sort((x, y) => y.started_at - x.started_at)
  const t = a.tokens
  const onDuty = isOnDuty(a, Date.now() / 1000)
  const recentEvents = demo ? storeEvents.filter((e) => (e.agent_id ? `agent:${e.agent_id}` : `session:${e.session_id}`) === a.id) : detail?.events ?? []
  const rows: [string, React.ReactNode, string?][] = [
    ['Department', facilityById[a.department]?.name ?? a.department],
    ['Model', a.model ?? 'not reported'],
    ['Session', <span className="mono">{a.session_id.slice(0, 8)}…</span>],
    ['Project', a.project ?? '—'],
    ['Parent agent', parent ? <button type="button" className="link" onClick={() => select({ kind: 'agent', id: parent.id })}>{parent.name}</button> : '— (Commander)'],
    ['Subagents', a.children.length],
    ['Active tool', a.active_tool ? `${a.active_tool}${a.active_tool_target ? ` · ${a.active_tool_target}` : ''}` : '—'],
    ['Duration', dur(a.duration_s)],
    ['Tool calls', a.tool_calls],
    ['Errors', a.errors, a.errors ? 't-bad' : undefined],
    ['Tokens in / out', t ? `${fmtTokens(t.input_tokens)} / ${fmtTokens(t.output_tokens)}` : 'after the turn completes'],
    ['Cache read', t ? fmtTokens(t.cache_read_input_tokens) : '—'],
  ]
  return (
    <motion.aside className="inspector" aria-label="Inspector" {...inspIn}>
      <InsHead kind={`${onDuty ? 'On duty' : 'Off duty'} · ${a.client_label ?? 'Claude Code'} agent`} name={a.name}
        sub={`${a.role} · ${a.kind === 'main' ? 'Main session agent' : `Subagent (${a.agent_type ?? 'type not reported'})`}`}
        tag={demo ? <SourceTag kind="demo" /> : <SourceTag kind="live" />} />
      <div className={`ins-status st-${a.status}`} style={{ borderColor: STATUS_COLOR[a.status] }}>
        <div className="ins-st"><StatusDot s={a.status} /><b>{a.status}</b></div>
        <div className="ins-activity">{a.activity_known ? a.activity : `Current activity unknown. Last confirmed event: ${a.last_event} (${ago(a.last_event_at)})`}</div>
      </div>
      <dl className="kv-grid two">
        {rows.map(([k, v, cls]) => <div key={k}><dt>{k}</dt><dd className={cls}>{v}</dd></div>)}
      </dl>
      <div className="btns">
        <button className="primary" onClick={() => follow({ kind: 'agent', id: a.id })}>Follow agent</button>
        {INTERIORS[a.department as DepartmentId] && <button onClick={() => enterAt(a.department as DepartmentId)}>Go to department</button>}
      </div>
      <SectionHead title="Current assignment" />
      <div className="assign">{a.assignment ?? 'Not reported'}</div>
      {a.completion_summary && <><SectionHead title="Last completion report" /><div className="assign">{a.completion_summary}</div></>}
      {a.last_error && <><SectionHead title="Last error" /><div className="assign err">{a.last_error}</div></>}
      <SectionHead title="Task history" meta={myTasks.length} />
      {myTasks.length === 0 && <div className="muted small">No tasks recorded.</div>}
      {myTasks.slice(0, 8).map((x) => <TaskRow key={x.id} t={x} agent={a} />)}
      <SectionHead title="Recent events" meta={recentEvents.length ? Math.min(25, recentEvents.length) : undefined} />
      {detailError && !demo && <div className="muted small">Could not load this agent's events from the base.</div>}
      <div className="event-log mono compact">{recentEvents.slice(-25).reverse().map((e) => <EventLine key={e.id} e={e} agents={agents} />)}</div>
    </motion.aside>
  )
}

// ------------------------------------------------------------------ feed, prompts, help
function Feed() {
  useTick(10000)
  const feed = useStore((s) => s.feed)
  const demo = useStore((s) => s.demo)
  const select = useStore((s) => s.select)
  const [filter, setFilter] = useState<FeedFilter>('all')
  const [more, setMore] = useState(false)
  const counts = feedCounts(feed)
  const list = filterFeed(feed, filter, more ? FEED_MORE : FEED_PAGE)
  const hidden = Math.min(counts[filter], FEED_MORE) - list.length
  return (
    <motion.section className={`feed ${more ? 'expanded' : ''}`} aria-label="Activity feed" initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }} transition={EASE}>
      <div className="feed-head">
        <span className="feed-title"><IconActivity size={13} /> Activity</span>
        <Chips label="Feed filter" value={filter} onChange={setFilter} options={[['all', 'All'], ['agent', 'Agents', counts.agent], ['alerts', 'Alerts', counts.alerts], ['sim', 'Simulation', counts.sim]] as const} />
        {(hidden > 0 || more) && <button type="button" className="ghost sm" aria-expanded={more} onClick={() => setMore((v) => !v)}>{more ? 'Show less' : `Show ${hidden} more`}</button>}
      </div>
      <ul className="feed-list" aria-live="polite" aria-relevant="additions">
        {list.length === 0 && <li className="feed-empty">{filter === 'alerts' ? 'No warnings or alerts.' : 'Quiet. New activity appears here.'}</li>}
        <AnimatePresence initial={false}>
          {list.map((f) => {
            const open = f.agentId ? () => select({ kind: 'agent', id: f.agentId! }) : undefined
            return (
              <motion.li key={f.id} layout="position" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={EASE}
                className={`feed-item tone-${f.tone} ${f.source} ${open ? 'clickable' : ''}`} {...(open ? { role: 'button', tabIndex: 0, onClick: open, onKeyDown: activate(open), title: 'Inspect this agent' } : {})}>
                <SourceTag kind={f.source === 'agent' ? (demo ? 'demo' : 'live') : 'sim'} />
                {(f.tone === 'warn' || f.tone === 'alert') && <span className={`sev-word tone-${f.tone}`}>{FEED_SEVERITY[f.tone]}</span>}
                <span className="fi-text">{stripSimPrefix(f.text)}</span>
                <span className="fi-t">{ago(f.ts)}</span>
              </motion.li>
            )
          })}
        </AnimatePresence>
      </ul>
    </motion.section>
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
        <motion.div key="alert" role="alert" className="alert-banner" style={{ x: '-50%' }} initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12, transition: FAST }} transition={EASE}>
          <IconAlert size={15} className="al-ico" /> <span className="al-text">{xwing ? 'Hostile starfighter attacking · eastern sector' : 'Impounded freighter escaping · Pad 3'}</span> <SourceTag kind="sim" />
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
        <motion.div key={`${a.id}:${a.last_event_at}`} role="alert" className={`attn-banner ${a.status === 'failed' ? 'failed' : ''}`} style={{ x: '-50%' }} initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8, transition: FAST }} transition={EASE}>
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
    orbit: 'Drag to orbit · right-drag to pan · scroll to zoom · click agents, aircraft or labels',
    tactical: 'Drag to pan · scroll to zoom · top-down tactical overview',
    firstperson: 'Click to lock the mouse · WASD to move · Shift to run · E at doors · Esc to release',
    thirdperson: 'WASD to move · drag to turn the camera · scroll to zoom · Shift to run · E at doors',
    cinematic: 'Automated camera tour · pick another tour in Facilities, or press 1 to return',
    follow: 'Following target · press 1 to return to the exterior view',
  }
  return <div className="help">{interior ? `Inside: ${INTERIORS[interior]?.title ?? interior} · ` : ''}{text[mode]} · <kbd>Ctrl K</kbd> search · <kbd>[</kbd><kbd>]</kbd> panels · <kbd>H</kbd> hide interface</div>
}

// ------------------------------------------------------------------ navigation
const TABS: { id: PanelId; label: string; Icon: (p: { size?: number }) => React.JSX.Element }[] = [
  { id: 'overview', label: 'Overview', Icon: IconOverview },
  { id: 'agents', label: 'Agents', Icon: IconAgents },
  { id: 'missions', label: 'Missions', Icon: IconMissions },
  { id: 'events', label: 'Events', Icon: IconEvents },
  { id: 'isb', label: 'ISB', Icon: IconShield },
  { id: 'aircraft', label: 'Air', Icon: IconRadar },
  { id: 'facilities', label: 'Sites', Icon: IconFacility },
]
const TAB_ORDER = TABS.map((t) => t.id)
const PANELS: Record<PanelId, () => React.JSX.Element> = { overview: OverviewPanel, agents: AgentsPanel, missions: MissionsPanel, events: EventsPanel, isb: IsbPanel, aircraft: AircraftPanel, facilities: FacilitiesPanel }

function NavRail() {
  useTick(15000)
  const panel = useStore((s) => s.panel)
  const setPanel = useStore((s) => s.setPanel)
  const agents = useStore((s) => s.agents)
  const now = Date.now() / 1000
  const attention = Object.values(agents).filter((a) => needsAttention(a, now)).length
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const cur = panel ? TAB_ORDER.indexOf(panel) : 0
  return (
    <nav className="rail" aria-label="Command panels">
      <div role="tablist" aria-orientation="vertical" aria-label="Command panels"
        onKeyDown={(e) => {
          const n = stepIndex(cur, e.key, TABS.length, 'vertical')
          const h = stepIndex(cur, e.key, TABS.length, 'horizontal') // the rail is horizontal on phones
          const next = n !== cur ? n : h
          if (next !== cur && next >= 0) { e.preventDefault(); setPanel(TAB_ORDER[next]); refs.current[next]?.focus() }
        }}>
        {TABS.map((t, i) => (
          <button key={t.id} ref={(el) => { refs.current[i] = el }} type="button" role="tab" id={`tab-${t.id}`} aria-selected={panel === t.id} aria-controls={panel === t.id ? `panel-${t.id}` : undefined}
            tabIndex={i === cur ? 0 : -1} className={`rail-tab ${panel === t.id ? 'on' : ''}`} title={`${PANEL_LABEL[t.id]} · click again to fold away · [ and ] switch`}
            onClick={() => setPanel(panel === t.id ? null : t.id)}>
            <t.Icon size={18} />
            <span className="rail-lbl">{t.label}</span>
            {t.id === 'agents' && attention > 0 && <span className="rail-badge" aria-label={`${attention} need you`}>{attention}</span>}
          </button>
        ))}
      </div>
    </nav>
  )
}

export function HUD() {
  const panel = useStore((s) => s.panel)
  const hudVisible = useStore((s) => s.hudVisible)
  const inspecting = useStore((s) => !!s.selection)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return
      const st = useStore.getState()
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') { e.preventDefault(); st.setPaletteOpen(!st.paletteOpen); return }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === '/' && st.cameraMode !== 'firstperson') { e.preventDefault(); st.setPaletteOpen(true); return }
      if (st.paletteOpen) return
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
      <div className={`hud ${panel ? 'panel-open' : 'panel-closed'} ${inspecting && hudVisible ? 'insp-open' : ''}`}>
        <AnimatePresence>
          {hudVisible && <TopBar key="top" />}
          {hudVisible && (
            <motion.div key="side" className="side" initial={{ x: -24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -24, opacity: 0 }} transition={EASE}>
              <NavRail />
              <AnimatePresence mode="wait" initial={false}>
                {Panel && panel && (
                  <motion.div key={panel} id={`panel-${panel}`} role="tabpanel" aria-labelledby={`tab-${panel}`} className="panel" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -4 }} transition={FAST}>
                    <div className="panel-title">
                      <h2>{PANEL_LABEL[panel]}</h2>
                      <button type="button" className="icon-btn" aria-label="Fold the panel away" title="Fold away" onClick={() => useStore.getState().setPanel(null)}><IconClose size={13} /></button>
                    </div>
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
        <CommandPalette />
      </div>
    </MotionConfig>
  )
}

import { create } from 'zustand'
import type { AgentInfo, HookEvent, IngestStatus, SystemInfo, TaskInfo } from './types'
import type { DepartmentId } from '../world/layout'

export type Quality = 'low' | 'medium' | 'high' | 'cinematic'
export type CameraMode = 'orbit' | 'tactical' | 'firstperson' | 'thirdperson' | 'cinematic' | 'follow'
export type TourId = 'flyover' | 'shuttle' | 'hangar' | 'command' | 'bunker' | 'agents' | 'duel' | 'destroyer'
/** Lighting scenario. Independent of the quality preset. `N` cycles it. */
export type TimeOfDay = 'golden' | 'dusk' | 'night'
export const TIMES_OF_DAY: TimeOfDay[] = ['golden', 'dusk', 'night']

export interface QualitySettings {
  dpr: number
  shadows: boolean
  shadowMapSize: number
  terrainSegments: number
  crowd: number
  bloom: boolean
  antialias: boolean
  dust: number
  drawDistance: number
  /** soft-shadow filter radius (PCF vogel disk), 0 = hard */
  shadowRadius: number
  /** post stack: none · basic (SMAA + bloom + grade + vignette) · full (basic + N8AO ambient occlusion) */
  post: 'none' | 'basic' | 'full'
  /** MSAA samples inside the composer (0 = rely on SMAA) */
  composerMsaa: number
  /** anisotropic filtering for ground/building textures */
  anisotropy: number
}

export const QUALITY: Record<Quality, QualitySettings> = {
  low: { dpr: 0.75, shadows: false, shadowMapSize: 512, terrainSegments: 160, crowd: 50, bloom: false, antialias: false, dust: 0, drawDistance: 9000, shadowRadius: 0, post: 'none', composerMsaa: 0, anisotropy: 2 },
  medium: { dpr: 1, shadows: true, shadowMapSize: 1024, terrainSegments: 256, crowd: 100, bloom: true, antialias: false, dust: 300, drawDistance: 12000, shadowRadius: 2, post: 'basic', composerMsaa: 0, anisotropy: 4 },
  high: { dpr: 1.25, shadows: true, shadowMapSize: 2048, terrainSegments: 384, crowd: 150, bloom: true, antialias: false, dust: 800, drawDistance: 16000, shadowRadius: 2.5, post: 'full', composerMsaa: 0, anisotropy: 8 },
  cinematic: { dpr: 1.5, shadows: true, shadowMapSize: 4096, terrainSegments: 512, crowd: 200, bloom: true, antialias: false, dust: 1500, drawDistance: 20000, shadowRadius: 3, post: 'full', composerMsaa: 4, anisotropy: 16 },
}

export type Selection =
  | { kind: 'agent'; id: string }
  | { kind: 'aircraft'; id: string }
  | { kind: 'facility'; id: DepartmentId }
  | null

export interface FeedItem { id: string; ts: number; text: string; tone: 'info' | 'warn' | 'alert' | 'ok' | 'sim'; source: 'agent' | 'sim'; agentId?: string }
export type RosterFilter = 'live' | 'working' | 'waiting' | 'attention' | 'failed' | 'all'
export interface LiveUpdate { event: HookEvent; agents: AgentInfo[]; tasks: TaskInfo[] }
/** Events older than this are history being caught up, not news for the feed. */
const FEED_MAX_AGE_S = 120

interface State {
  quality: Quality
  cameraMode: CameraMode
  tour: TourId | null
  followTarget: Selection
  selection: Selection
  interior: DepartmentId | null
  connected: boolean
  agents: Record<string, AgentInfo>
  tasks: Record<string, TaskInfo>
  events: HookEvent[]
  system: SystemInfo | null
  ingest: IngestStatus | null
  feed: FeedItem[]
  panel: 'agents' | 'missions' | 'events' | 'aircraft' | 'facilities' | null
  showLabels: boolean
  hudVisible: boolean
  rosterFilter: RosterFilter
  setRosterFilter(f: RosterFilter): void
  timeOfDay: TimeOfDay
  setTimeOfDay(t: TimeOfDay): void
  cycleTimeOfDay(): void
  setQuality(q: Quality): void
  setCameraMode(m: CameraMode): void
  startTour(t: TourId | null): void
  /** Start a tour as a show: leave any interior and fold the side panel away so nothing covers the view. */
  watchTour(t: TourId): void
  follow(s: Selection): void
  select(s: Selection): void
  enterInterior(d: DepartmentId | null): void
  setPanel(p: State['panel']): void
  toggleLabels(): void
  toggleHud(): void
  pushFeed(text: string, tone?: FeedItem['tone'], source?: FeedItem['source'], agentId?: string): void
  applySnapshot(s: { agents: AgentInfo[]; tasks: TaskInfo[]; events: HookEvent[]; ingest?: IngestStatus }): void
  applyEvent(ev: HookEvent, agents: AgentInfo[], tasks: TaskInfo[]): void
  /** Apply several live updates in a single store update (one React render however many arrived). */
  applyEvents(batch: LiveUpdate[]): void
  setSystem(s: SystemInfo): void
  setConnected(c: boolean): void
}

function loadTimeOfDay(): TimeOfDay {
  try {
    const t = localStorage.getItem('imperial.tod') as TimeOfDay | null
    if (t && TIMES_OF_DAY.includes(t)) return t
  } catch { /* ignore */ }
  return 'golden'
}

function loadQuality(): Quality {
  try {
    const q = localStorage.getItem('imperial.quality') as Quality | null
    if (q && q in QUALITY) return q
  } catch { /* ignore */ }
  return 'medium'
}

let feedSeq = 0

export const useStore = create<State>((set, get) => ({
  quality: loadQuality(),
  cameraMode: 'orbit',
  tour: null,
  followTarget: null,
  selection: null,
  interior: null,
  connected: false,
  agents: {},
  tasks: {},
  events: [],
  system: null,
  ingest: null,
  feed: [],
  panel: 'agents',
  showLabels: true,
  hudVisible: true,
  rosterFilter: 'live',
  setRosterFilter(f) { set({ rosterFilter: f }) },
  timeOfDay: loadTimeOfDay(),
  setTimeOfDay(t) {
    try { localStorage.setItem('imperial.tod', t) } catch { /* ignore */ }
    set({ timeOfDay: t })
  },
  cycleTimeOfDay() {
    const i = TIMES_OF_DAY.indexOf(get().timeOfDay)
    get().setTimeOfDay(TIMES_OF_DAY[(i + 1) % TIMES_OF_DAY.length])
  },
  setQuality(q) {
    try { localStorage.setItem('imperial.quality', q) } catch { /* ignore */ }
    set({ quality: q })
  },
  setCameraMode(m) { set({ cameraMode: m, tour: m === 'cinematic' ? get().tour ?? 'flyover' : null }) },
  startTour(t) { set({ tour: t, cameraMode: t ? 'cinematic' : 'orbit' }) },
  watchTour(t) { set({ tour: t, cameraMode: 'cinematic', interior: null, panel: null, selection: null, followTarget: null }) },
  follow(s) { set({ followTarget: s, cameraMode: s ? 'follow' : 'orbit', tour: null }) },
  select(s) { set({ selection: s }) },
  enterInterior(d) { set({ interior: d, cameraMode: get().cameraMode === 'tactical' ? 'orbit' : get().cameraMode }) },
  setPanel(p) { set({ panel: p }) },
  toggleLabels() { set({ showLabels: !get().showLabels }) },
  toggleHud() { set({ hudVisible: !get().hudVisible }) },
  pushFeed(text, tone = 'info', source = 'sim', agentId) {
    const item: FeedItem = { id: `f${++feedSeq}`, ts: Date.now() / 1000, text, tone, source, agentId }
    set({ feed: [item, ...get().feed].slice(0, 120) })
  },
  applySnapshot(s) {
    const agents: Record<string, AgentInfo> = {}
    for (const a of s.agents) agents[a.id] = a
    const tasks: Record<string, TaskInfo> = {}
    for (const t of s.tasks) tasks[t.id] = t
    set({ agents, tasks, events: s.events.slice(-300), ingest: s.ingest ?? get().ingest })
  },
  applyEvent(ev, agents, tasks) { get().applyEvents([{ event: ev, agents, tasks }]) },
  applyEvents(batch) {
    if (!batch.length) return
    const a = { ...get().agents }
    const t = { ...get().tasks }
    const news: FeedItem[] = []
    const now = Date.now() / 1000
    for (const u of batch) {
      for (const x of u.agents) a[x.id] = x
      for (const x of u.tasks) t[x.id] = x
      const ts = Date.parse(u.event.ts) / 1000
      if (Number.isFinite(ts) && now - ts > FEED_MAX_AGE_S) continue // backlog: state only, no feed line
      const line = describeEvent(u.event, a)
      if (line) news.unshift({ id: `f${++feedSeq}`, ts: Number.isFinite(ts) ? Math.min(ts, now) : now, text: line.text, tone: line.tone, source: 'agent', agentId: agentKeyFor(u.event) })
    }
    const events = get().events.concat(batch.map((u) => u.event)).slice(-300)
    set({ agents: a, tasks: t, events, feed: news.length ? [...news, ...get().feed].slice(0, 120) : get().feed })
  },
  setSystem(s) { set({ system: s }) },
  setConnected(c) { set({ connected: c }) },
}))

export function agentKeyFor(ev: HookEvent) {
  return ev.agent_id ? `agent:${ev.agent_id}` : `session:${ev.session_id}`
}

export function describeEvent(ev: HookEvent, agents: Record<string, AgentInfo>): { text: string; tone: FeedItem['tone'] } | null {
  const a = agents[agentKeyFor(ev)]
  const who = a ? `${a.name} (${a.role})` : ev.agent_type ?? 'Agent'
  switch (ev.event) {
    case 'SessionStart': return { text: `${who} reported for duty — ${ev.project ?? 'session'}`, tone: 'ok' }
    case 'SessionEnd': return { text: `${who} signed off (${ev.reason ?? 'session ended'})`, tone: 'info' }
    case 'UserPromptSubmit': return { text: `${who} received orders`, tone: 'info' }
    case 'PreToolUse':
      if (ev.tool_name === 'Agent' || ev.tool_name === 'Task') return { text: `${who} delegating: ${ev.delegation ?? ev.subagent_type ?? ''}`, tone: 'info' }
      return null // too chatty for the feed; visible in the agent inspector
    case 'PostToolUseFailure': return { text: `${who}: ${ev.tool_name} failed — ${ev.error ?? ''}`, tone: 'warn' }
    case 'SubagentStart': return { text: `${who} deployed to ${a?.department ?? 'station'}`, tone: 'ok' }
    case 'SubagentStop': return { text: `${who} mission complete`, tone: 'ok' }
    case 'Stop': return { text: `${who} completed a turn`, tone: 'ok' }
    case 'StopFailure': return { text: `${who} FAILED: ${ev.error ?? ''}`, tone: 'alert' }
    case 'PermissionRequest': return { text: `${who} awaits your authorisation${ev.tool_name ? ` — ${ev.tool_name}` : ''}`, tone: 'warn' }
    case 'Notification':
      return ev.notification_type?.includes('permission') ? { text: `${who} awaits your authorisation`, tone: 'warn' } : null
    default: return null
  }
}

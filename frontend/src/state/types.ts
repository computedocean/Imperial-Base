// Mirrors backend/app/state.py public shapes.
export type AgentStatus = 'active' | 'working' | 'delegating' | 'waiting' | 'idle' | 'completed' | 'failed' | 'disconnected'

export interface AgentInfo {
  id: string
  kind: 'main' | 'subagent'
  session_id: string
  agent_type: string | null
  role: string
  department: string
  name: string
  parent_id: string | null
  project: string | null
  cwd: string | null
  model: string | null
  status: AgentStatus
  activity: string
  assignment: string | null
  active_tool: string | null
  active_tool_target: string | null
  started_at: number
  last_event_at: number
  last_event: string | null
  ended_at: number | null
  tool_calls: number
  errors: number
  last_error: string | null
  completion_summary: string | null
  children: string[]
  tokens: Record<string, number> | null
  current_task_id: string | null
  stale: boolean
  activity_known: boolean
  duration_s: number
  /** which agent client reported it: Claude Code, Cursor, … */
  client?: string
  client_label?: string
  /** false = a session that was opened but never prompted and never used a tool */
  engaged?: boolean
  prompts?: number
}

export interface TaskInfo {
  id: string
  agent_id: string
  kind: 'turn' | 'report' | 'delegation'
  title: string
  status: 'in_progress' | 'completed' | 'failed' | 'interrupted'
  started_at: number
  ended_at: number | null
  summary: string | null
  parent_agent_id: string | null
  tool_calls: number
}

export interface HookEvent {
  id: number
  ts: string
  event: string
  session_id: string
  agent_id?: string
  agent_type?: string
  tool_name?: string
  tool_target?: string
  project?: string
  prompt_excerpt?: string
  delegation?: string
  subagent_type?: string
  summary?: string
  error?: string
  notification_type?: string
  message?: string
  reason?: string
  source?: string
  client?: string
}

export interface SystemInfo {
  ts: number
  cpu_pct?: number
  cpu_count?: number
  mem_used_gb?: number
  mem_total_gb?: number
  mem_pct?: number
  claude_processes?: number
  gpu?: { available: boolean; reason?: string; gpus?: { name: string; util_pct: number; mem_used_mb: number; mem_total_mb: number }[] }
  docker?: { available: boolean; reason?: string; containers?: { name: string; image: string; status: string }[] }
}

export interface IngestStatus {
  spool: string
  spool_exists: boolean
  spool_bytes: number
  events_stored: number
  ingested_this_run: number
  hook_installed: boolean
}

/** One conversation in the Commander's chat (backend/app/orders.py). Each is one agent. */
export interface OrderMessage { role: 'commander' | 'agent' | 'tool' | 'notice'; text: string; ts: number }
export interface OrderInfo {
  id: string
  session_id: string
  /** the agent's id in the roster: session:<session_id> */
  agent_id: string
  title: string
  status: 'running' | 'idle' | 'failed' | 'stopped'
  created_at: number
  updated_at: number
  turns: number
  messages: OrderMessage[]
}
/** Whether orders can be given, and where agents started from the chat work. */
export interface OrdersInfo { enabled: boolean; reason: string | null; folder: string }

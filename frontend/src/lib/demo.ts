// Demo mode (?demo=1): a fixed, fictional dataset for previewing the command interface without real agents.
// Everything here is invented and labelled DEMO wherever it appears. In demo mode the live link is never opened,
// so demo records cannot mix with real ones, and Orders are disabled.
import type { AgentInfo, HookEvent, OrdersInfo, SystemInfo, TaskInfo } from '../state/types'

export const DEMO_PROJECTS = ['demo-fleet-registry', 'demo-supply-ledger'] as const

export interface DemoData {
  agents: AgentInfo[]
  tasks: TaskInfo[]
  events: HookEvent[]
  system: SystemInfo
  ordersInfo: OrdersInfo
}

/** True when the page was opened with ?demo=1 (or ?demo=true). */
export function isDemoUrl(search: string): boolean {
  const v = new URLSearchParams(search).get('demo')
  return v === '1' || v === 'true'
}

type Spec = Partial<AgentInfo> & Pick<AgentInfo, 'id' | 'name' | 'role' | 'department' | 'status'>

export function demoData(now: number): DemoData {
  const agentBase = (s: Spec): AgentInfo => ({
    kind: 'main', session_id: s.id.replace(/^(session|agent):/, ''), agent_type: null, parent_id: null, project: DEMO_PROJECTS[0],
    cwd: null, model: 'demo-model', activity: '', assignment: null, active_tool: null, active_tool_target: null,
    started_at: now - 3400, last_event_at: now - 20, last_event: 'PreToolUse', ended_at: null, tool_calls: 0, errors: 0,
    last_error: null, completion_summary: null, children: [], tokens: null, current_task_id: null, stale: false,
    activity_known: true, duration_s: 3400, client: 'claude-code', client_label: 'Claude Code', engaged: true, prompts: 3, ...s,
  })

  const agents: AgentInfo[] = [
    agentBase({
      id: 'session:demo-a1', name: 'Cmdr. Korda-41', role: 'Lead Developer', department: 'engineering', status: 'delegating',
      activity: 'Delegating a review to a subagent', assignment: 'Add cargo manifest validation to the fleet registry (demo)',
      tool_calls: 64, errors: 1, children: ['agent:demo-r1', 'agent:demo-t1'], tokens: { input_tokens: 182000, output_tokens: 24100, cache_read_input_tokens: 910000, total_tokens: 206100 },
    }),
    agentBase({
      id: 'agent:demo-r1', kind: 'subagent', agent_type: 'code-reviewer', parent_id: 'session:demo-a1', session_id: 'demo-a1',
      name: 'Lt. Varrin-22', role: 'Code Reviewer', department: 'security', status: 'working', active_tool: 'Read',
      active_tool_target: 'manifest.py', activity: 'Reading manifest.py', assignment: 'Review the manifest validator for unsafe input handling (demo)',
      tool_calls: 18, started_at: now - 900, duration_s: 900, last_event_at: now - 8,
    }),
    agentBase({
      id: 'agent:demo-t1', kind: 'subagent', agent_type: 'test-runner', parent_id: 'session:demo-a1', session_id: 'demo-a1',
      name: 'Lt. Tessic-57', role: 'Testing Specialist', department: 'engineering', status: 'failed', activity: 'Last turn failed',
      assignment: 'Run the registry test suite (demo)', tool_calls: 11, errors: 3, last_error: 'Test run exceeded the time limit (demo)',
      started_at: now - 1500, duration_s: 1300, last_event_at: now - 240, last_event: 'StopFailure',
    }),
    agentBase({
      id: 'session:demo-b1', name: 'Cmdr. Mavek-33', role: 'Lead Developer', department: 'engineering', status: 'waiting', project: DEMO_PROJECTS[1],
      activity: 'Waiting for your authorisation: Bash', assignment: 'Migrate the supply ledger to the new schema (demo)', tool_calls: 37,
      last_event_at: now - 75, last_event: 'PermissionRequest', active_tool: 'Bash',
    }),
    agentBase({
      id: 'agent:demo-x1', kind: 'subagent', agent_type: 'explorer', parent_id: 'session:demo-b1', session_id: 'demo-b1', project: DEMO_PROJECTS[1],
      name: 'Maj. Oruss-64', role: 'Research Analyst', department: 'intelligence', status: 'completed', activity: 'Mission complete',
      assignment: 'Map every caller of the ledger writer (demo)', completion_summary: 'Found 14 callers in 6 modules; two write without a transaction (demo).',
      tool_calls: 29, started_at: now - 2600, last_event_at: now - 1100, ended_at: now - 1100, duration_s: 1500, last_event: 'SubagentStop',
    }),
    agentBase({
      id: 'session:demo-c1', name: 'Cmdr. Dellan-18', role: 'Lead Developer', department: 'engineering', status: 'idle', project: DEMO_PROJECTS[1],
      activity: 'Awaiting orders', assignment: 'Summarise yesterday’s failed deployments (demo)', tool_calls: 9, last_event_at: now - 1800, last_event: 'Stop',
      completion_summary: 'Three failures traced to an expired staging certificate (demo).',
    }),
    agentBase({
      id: 'agent:demo-p1', kind: 'subagent', agent_type: 'planner', parent_id: 'session:demo-b1', session_id: 'demo-b1', project: DEMO_PROJECTS[1],
      name: 'Maj. Calder-29', role: 'Architect', department: 'operations', status: 'working', active_tool: 'Write', active_tool_target: 'PLAN.md',
      activity: 'Writing PLAN.md', assignment: 'Plan the schema migration in reversible steps (demo)', tool_calls: 6, started_at: now - 400, last_event_at: now - 15,
    }),
  ]
  agents.find((a) => a.id === 'session:demo-b1')!.children = ['agent:demo-x1', 'agent:demo-p1']

  const task = (id: string, agent_id: string, kind: TaskInfo['kind'], title: string, status: TaskInfo['status'], ago: number, len: number | null, calls: number, summary: string | null = null): TaskInfo => ({
    id, agent_id, kind, title, status, started_at: now - ago, ended_at: len === null ? null : now - ago + len, summary, parent_agent_id: null, tool_calls: calls,
  })
  const tasks: TaskInfo[] = [
    task('demo-t-1', 'session:demo-a1', 'turn', 'Add cargo manifest validation to the fleet registry (demo)', 'in_progress', 1200, null, 41),
    task('demo-t-2', 'agent:demo-r1', 'delegation', 'Review the manifest validator for unsafe input handling (demo)', 'in_progress', 900, null, 18),
    task('demo-t-3', 'agent:demo-t1', 'delegation', 'Run the registry test suite (demo)', 'failed', 1500, 1260, 11, 'Test run exceeded the time limit (demo)'),
    task('demo-t-4', 'session:demo-b1', 'turn', 'Migrate the supply ledger to the new schema (demo)', 'in_progress', 2800, null, 37),
    task('demo-t-5', 'agent:demo-x1', 'delegation', 'Map every caller of the ledger writer (demo)', 'completed', 2600, 1500, 29, 'Found 14 callers in 6 modules; two write without a transaction (demo).'),
    task('demo-t-6', 'session:demo-c1', 'turn', 'Summarise yesterday’s failed deployments (demo)', 'completed', 2400, 600, 9, 'Three failures traced to an expired staging certificate (demo).'),
    task('demo-t-7', 'agent:demo-p1', 'delegation', 'Plan the schema migration in reversible steps (demo)', 'in_progress', 400, null, 6),
    task('demo-t-8', 'session:demo-a1', 'turn', 'Sketch the manifest data model (demo)', 'completed', 3300, 700, 23, 'Model and fixtures added (demo).'),
  ]

  // a steady trickle of tool calls across the hour, plus the incidents the agents above describe
  const events: HookEvent[] = []
  let id = 1
  const push = (ago: number, e: Omit<HookEvent, 'id' | 'ts'>) => events.push({ id: id++, ts: new Date((now - ago) * 1000).toISOString(), ...e })
  const tools = ['Read', 'Edit', 'Grep', 'Write', 'Read', 'Bash', 'Glob']
  for (let ago = 3500; ago > 10; ago -= 47 + ((ago * 7) % 41)) {
    const sess = ago % 3 === 0 ? 'demo-b1' : 'demo-a1'
    push(ago, { event: 'PreToolUse', session_id: sess, tool_name: tools[ago % tools.length], tool_target: 'module.py', project: sess === 'demo-a1' ? DEMO_PROJECTS[0] : DEMO_PROJECTS[1] })
  }
  push(3400, { event: 'SessionStart', session_id: 'demo-a1', project: DEMO_PROJECTS[0], source: 'startup' })
  push(3300, { event: 'SessionStart', session_id: 'demo-b1', project: DEMO_PROJECTS[1], source: 'startup' })
  push(2900, { event: 'PostToolUseFailure', session_id: 'demo-a1', tool_name: 'Edit', tool_target: 'registry.py', error: 'old_string not found (demo)' })
  push(1700, { event: 'PostToolUseFailure', session_id: 'demo-a1', agent_id: 'demo-t1', agent_type: 'test-runner', tool_name: 'Bash', error: 'exit code 1 (demo)' })
  push(900, { event: 'SubagentStart', session_id: 'demo-a1', agent_id: 'demo-r1', agent_type: 'code-reviewer' })
  push(600, { event: 'PostToolUseFailure', session_id: 'demo-a1', agent_id: 'demo-t1', agent_type: 'test-runner', tool_name: 'Bash', error: 'timed out after 300 s (demo)' })
  push(240, { event: 'StopFailure', session_id: 'demo-a1', agent_id: 'demo-t1', agent_type: 'test-runner', error: 'Test run exceeded the time limit (demo)' })
  push(75, { event: 'PermissionRequest', session_id: 'demo-b1', tool_name: 'Bash', tool_target: 'migrate --apply' })
  events.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
  events.forEach((e, i) => { e.id = i + 1 })

  return {
    agents,
    tasks,
    events,
    system: { ts: now, cpu_pct: 23, cpu_count: 16, mem_used_gb: 14.2, mem_total_gb: 32, mem_pct: 44, claude_processes: 3, gpu: { available: false, reason: 'demo mode' }, docker: { available: false, reason: 'demo mode' } },
    ordersInfo: { enabled: false, reason: 'Demo mode: orders are disabled.', folder: 'demo' },
  }
}

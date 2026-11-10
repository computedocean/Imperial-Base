// Interior layouts. Each interior sits physically inside its building shell (world coordinates),
// except the server bunker which is underground and the command chamber which is the tower's bridge.
import type { DepartmentId } from '../world/layout'
import { facilityById } from '../world/layout'

export type StationType = 'console' | 'terminal' | 'holotable' | 'rack' | 'archive' | 'briefing' | 'lab' | 'lounge' | 'security'

export interface Station { id: string; type: StationType; x: number; z: number; rot: number }

export interface InteriorLayout {
  id: DepartmentId
  title: string
  /** world position of the room's floor centre */
  origin: [number, number, number]
  w: number
  d: number
  h: number
  /** local entry point (just inside the door) */
  entry: [number, number]
  stations: Station[]
  lounge: [number, number][]
  windows: boolean
  accent: string
  zones: { label: string; x: number; z: number }[]
}

function grid(prefix: string, type: StationType, x0: number, z0: number, nx: number, nz: number, dx: number, dz: number, rot = 0): Station[] {
  const out: Station[] = []
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) out.push({ id: `${prefix}${i}-${j}`, type, x: x0 + i * dx, z: z0 + j * dz, rot })
  return out
}

const F = facilityById

export const INTERIORS: Partial<Record<DepartmentId, InteriorLayout>> = {
  command: {
    id: 'command', title: 'Grand Command Chamber — Command Bridge', origin: [0, 102.2, 0], w: 62, d: 30, h: 11,
    entry: [0, 12], windows: true, accent: F.command.accent,
    stations: [
      { id: 'holo', type: 'holotable', x: 0, z: 0, rot: 0 },
      ...grid('pitN', 'console', -22, -10, 6, 1, 8.8, 0, 0),
      ...grid('pitS', 'console', -22, 9, 6, 1, 8.8, 0, Math.PI),
      { id: 'comms1', type: 'terminal', x: -28, z: 0, rot: Math.PI / 2 },
      { id: 'comms2', type: 'terminal', x: 28, z: 0, rot: -Math.PI / 2 },
      { id: 'agentmon', type: 'console', x: 14, z: 0, rot: -Math.PI / 2 },
    ],
    lounge: [[-6, 12], [6, 12], [-20, 12]],
    zones: [
      { label: 'HOLOGRAPHIC TACTICAL TABLE', x: 0, z: 0 },
      { label: 'COMMUNICATIONS', x: -27, z: 0 },
      { label: 'AGENT MONITORING', x: 18, z: 0 },
      { label: 'OBSERVATION DECK', x: 0, z: -13 },
    ],
  },
  engineering: {
    id: 'engineering', title: 'Engineering Division — Software Engineering Floor', origin: [F.engineering.x, 0.3, F.engineering.z], w: 96, d: 74, h: 10,
    entry: [-44, 0], windows: false, accent: F.engineering.accent,
    stations: [
      ...grid('dev', 'console', -26, -26, 4, 3, 10, 9, Math.PI),
      ...grid('test', 'lab', 18, -26, 3, 2, 9, 10, Math.PI),
      ...grid('build', 'terminal', 18, 10, 3, 1, 9, 0, 0),
      ...grid('deploy', 'terminal', 18, 24, 3, 1, 9, 0, 0),
      { id: 'collab', type: 'briefing', x: -18, z: 22, rot: 0 },
      { id: 'collab2', type: 'holotable', x: -36, z: 22, rot: 0 },
    ],
    lounge: [[-40, -30], [-40, 30], [40, 30], [40, -32]],
    zones: [
      { label: 'DEVELOPMENT WORKSTATIONS', x: -11, z: -16 },
      { label: 'TEST LABORATORIES', x: 27, z: -21 },
      { label: 'BUILD MONITORING', x: 27, z: 10 },
      { label: 'DEPLOYMENT CONTROL', x: 27, z: 24 },
      { label: 'COLLABORATION AREA', x: -24, z: 22 },
    ],
  },
  intelligence: {
    id: 'intelligence', title: 'Intelligence Division — Analysis Hall', origin: [F.intelligence.x, 0.3, F.intelligence.z], w: 84, d: 60, h: 9,
    entry: [-40, 0], windows: false, accent: F.intelligence.accent,
    stations: [
      ...grid('ana', 'console', -22, -20, 4, 2, 9, 9, Math.PI),
      ...grid('arch', 'archive', 20, -24, 3, 1, 8, 0, 0),
      ...grid('lab', 'lab', 16, 4, 2, 2, 10, 9, 0),
      { id: 'brief', type: 'briefing', x: -16, z: 18, rot: 0 },
      { id: 'holo', type: 'holotable', x: -32, z: 18, rot: 0 },
    ],
    lounge: [[-36, -24], [36, 24], [-36, 24]],
    zones: [
      { label: 'ANALYSIS STATIONS', x: -9, z: -16 },
      { label: 'RECORDS ARCHIVE', x: 28, z: -24 },
      { label: 'INVESTIGATION LABS', x: 21, z: 8 },
      { label: 'BRIEFING ROOM', x: -22, z: 18 },
    ],
  },
  operations: {
    id: 'operations', title: 'Operations Center — Mission Control', origin: [F.operations.x, 0.3, F.operations.z], w: 64, d: 50, h: 10,
    entry: [0, -23], windows: false, accent: F.operations.accent,
    stations: [
      { id: 'mission', type: 'holotable', x: 0, z: 4, rot: 0 },
      ...grid('assign', 'console', -24, -12, 3, 1, 8, 0, 0),
      ...grid('report', 'console', 8, -12, 3, 1, 8, 0, 0),
      ...grid('track', 'terminal', -24, 18, 7, 1, 8, 0, Math.PI),
    ],
    lounge: [[-28, -20], [28, -20]],
    zones: [
      { label: 'ACTIVE MISSION TABLE', x: 0, z: 4 },
      { label: 'MISSION ASSIGNMENT', x: -16, z: -12 },
      { label: 'MISSION REPORTING', x: 16, z: -12 },
      { label: 'TASK MONITORING', x: 0, z: 18 },
    ],
  },
  research: {
    id: 'research', title: 'AI Research Laboratories', origin: [F.research.x, 0.3, F.research.z], w: 80, d: 66, h: 5.6,
    entry: [0, 31], windows: false, accent: F.research.accent,
    stations: [
      ...grid('eval', 'lab', -28, -20, 3, 2, 10, 10, 0),
      ...grid('compute', 'rack', 10, -26, 4, 1, 6, 0, 0),
      ...grid('ws', 'console', 10, 0, 3, 2, 9, 10, Math.PI),
    ],
    lounge: [[-34, 26], [34, 26]],
    zones: [
      { label: 'MODEL EVALUATION', x: -18, z: -15 },
      { label: 'LOCAL COMPUTE', x: 19, z: -26 },
      { label: 'RESEARCH WORKSTATIONS', x: 19, z: 5 },
    ],
  },
  security: {
    id: 'security', title: 'Security Operations Center', origin: [F.security.x, 0.3, F.security.z], w: 44, d: 44, h: 8,
    entry: [-20, 0], windows: false, accent: F.security.accent,
    stations: [
      ...grid('mon', 'security', -10, -14, 3, 1, 10, 0, 0),
      ...grid('access', 'console', -10, 12, 3, 1, 10, 0, Math.PI),
      { id: 'incident', type: 'holotable', x: 4, z: 0, rot: 0 },
    ],
    lounge: [[16, 16], [16, -16]],
    zones: [
      { label: 'SURVEILLANCE WALL', x: 0, z: -18 },
      { label: 'ACCESS CONTROL', x: 0, z: 12 },
      { label: 'INCIDENT RESPONSE', x: 4, z: 0 },
    ],
  },
  bunker: {
    id: 'bunker', title: 'Underground Server Bunker — Compute Hall B-1', origin: [F.bunker.x, -16, F.bunker.z - 30], w: 84, d: 60, h: 10,
    entry: [0, 27], windows: false, accent: F.bunker.accent,
    stations: [
      ...grid('rack', 'rack', -34, -22, 12, 4, 6, 9, 0),
      { id: 'core', type: 'holotable', x: 26, z: 14, rot: 0 },
      { id: 'hw1', type: 'terminal', x: 16, z: 22, rot: 0 },
      { id: 'hw2', type: 'terminal', x: 34, z: 22, rot: 0 },
    ],
    lounge: [[-36, 24], [36, 24]],
    zones: [
      { label: 'SERVER HALL', x: -2, z: -10 },
      { label: 'NETWORK CORE', x: 26, z: 14 },
    ],
  },
}

/** Which station types suit which tool activity (real hook tool names). */
export function stationForTool(tool: string | null | undefined): StationType[] {
  switch (tool) {
    case 'Bash': case 'PowerShell': return ['terminal', 'console', 'lab']
    case 'Read': case 'Grep': case 'Glob': return ['archive', 'console']
    case 'Edit': case 'Write': case 'MultiEdit': case 'NotebookEdit': return ['console']
    case 'WebFetch': case 'WebSearch': return ['terminal', 'archive', 'console']
    case 'Agent': case 'Task': return ['holotable', 'briefing', 'console']
    case 'TodoWrite': return ['holotable', 'briefing', 'console']
    default: return ['console', 'terminal', 'lab']
  }
}

export function toWorld(l: InteriorLayout, x: number, z: number): [number, number, number] {
  return [l.origin[0] + x, l.origin[1], l.origin[2] + z]
}

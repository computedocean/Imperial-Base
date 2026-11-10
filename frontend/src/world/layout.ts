// IMPERIAL BASE — world layout. Single source of truth for where everything is.
// Units: metres. +Y up. The installation sits on a flattened plateau at y = 0
// centred on the origin. Models face +Z (three.js Object3D.lookAt convention).

import { fbm, ridged, smoothstep } from './noise'

export const PLANET = {
  name: 'Ketrax Prime',
  installation: 'Imperial Garrison Aurek-9',
  sector: 'Outer Rim — Varrak Expanse',
}

export const WORLD_SIZE = 14000 // terrain square edge length
export const PLATEAU_RADIUS = 560 // fully flat inside this radius
export const PERIMETER_RADIUS = 470 // octagonal perimeter wall circumradius
export const WALL_HEIGHT = 14

// ---------------------------------------------------------------- terrain

/** Terrain height at world (x, z). Deterministic; shared by renderer, flight paths and tests. */
export function terrainHeight(x: number, z: number): number {
  const r = Math.hypot(x, z)
  if (r < PLATEAU_RADIUS) return 0
  // gentle dunes ramping in just outside the plateau
  const duneMask = smoothstep(PLATEAU_RADIUS, PLATEAU_RADIUS + 400, r)
  const dunes = (fbm(x * 0.004, z * 0.004, 4) * 18 + fbm(x * 0.02 + 7, z * 0.02, 2) * 2.5) * duneMask
  // rising mesa shelf
  const shelf = smoothstep(900, 2200, r) * (40 + fbm(x * 0.0012, z * 0.0012, 3) * 120)
  // mountain ranges — strongest in the north and west, a valley opens to the east (outpost road)
  const ang = Math.atan2(z, x)
  const valley = 1 - 0.75 * Math.pow(Math.max(0, Math.cos(ang - 0.3)), 6)
  const mtnMask = smoothstep(1600, 3600, r) * valley
  const mtn = ridged(x * 0.00042 + 3.1, z * 0.00042 - 1.7, 6) * 900 * mtnMask
  return dunes + shelf + mtn
}

// ---------------------------------------------------------------- facilities

export type DepartmentId =
  | 'command'
  | 'hangar'
  | 'intelligence'
  | 'engineering'
  | 'operations'
  | 'research'
  | 'security'
  | 'bunker'
  | 'quarters'
  | 'transport'
  | 'perimeter'

export interface Facility {
  id: DepartmentId
  name: string
  short: string
  /** footprint centre */
  x: number
  z: number
  /** axis-aligned extents in metres (sx along X, sz along Z) and roof height */
  sx: number
  sz: number
  sy: number
  /** world-space door position (where personnel enter / first-person entry trigger) */
  door: [number, number]
  /** signature colour for UI + light accents */
  accent: string
  /** true when the facility has a walk-in interior */
  interior: boolean
  description: string
}

export const FACILITIES: Facility[] = [
  {
    id: 'command', name: 'Imperial Command Citadel', short: 'COMMAND', x: 0, z: 0, sx: 96, sz: 96, sy: 118,
    door: [0, 50], accent: '#d8b45a', interior: true,
    description: 'Central headquarters: grand command chamber, holographic tactical table, observation deck, communications and agent monitoring.',
  },
  {
    id: 'hangar', name: 'Starship Hangar Alpha', short: 'HANGAR', x: -270, z: 20, sx: 130, sz: 210, sy: 52,
    door: [-203, 20], accent: '#e0882f', interior: true,
    description: 'Primary hangar: maintenance bays, TIE racks, refuelling, cargo and personnel loading.',
  },
  {
    id: 'intelligence', name: 'Intelligence Division', short: 'INTEL', x: 200, z: -95, sx: 92, sz: 70, sy: 36,
    door: [152, -95], accent: '#5aa8e0', interior: true,
    description: 'Research offices, investigation laboratories and analysis stations. Research agents report here.',
  },
  {
    id: 'engineering', name: 'Engineering Division', short: 'ENGINEERING', x: 200, z: 105, sx: 104, sz: 82, sy: 30,
    door: [146, 105], accent: '#e0a040', interior: true,
    description: 'Software engineering, build monitoring, test laboratories and deployment control. Claude Code development agents work here.',
  },
  {
    id: 'operations', name: 'Operations Center', short: 'OPERATIONS', x: 10, z: 215, sx: 96, sz: 62, sy: 28,
    door: [10, 182], accent: '#c05050', interior: true,
    description: 'Mission assignment, active mission visualisation, agent deployment and mission reporting.',
  },
  {
    id: 'research', name: 'AI Research Laboratories', short: 'AI LABS', x: -70, z: -225, sx: 84, sz: 72, sy: 30,
    door: [-70, -187], accent: '#62d0c8', interior: true,
    description: 'AI experimentation rooms, model evaluation, local compute workstations.',
  },
  {
    id: 'security', name: 'Security Operations Center', short: 'SECURITY', x: 285, z: -235, sx: 56, sz: 56, sy: 24,
    door: [255, -235], accent: '#d04040', interior: true,
    description: 'Independent security monitoring, access control, patrol supervision and incident response.',
  },
  {
    id: 'bunker', name: 'Underground Server Bunker', short: 'BUNKER', x: 105, z: -230, sx: 46, sz: 34, sy: 9,
    door: [105, -211], accent: '#7a9cff', interior: true,
    description: 'Subterranean compute halls: server racks, network core, model runtime and hardware telemetry.',
  },
  {
    id: 'quarters', name: 'Personnel Quarters', short: 'QUARTERS', x: -227, z: 257, sx: 120, sz: 64, sy: 24,
    door: [-227, 223], accent: '#9a9a8a', interior: false,
    description: 'Officer and personnel accommodation, common areas and the medical bay.',
  },
  {
    id: 'transport', name: 'Transport & Vehicle Complex', short: 'TRANSPORT', x: 254, z: 244, sx: 90, sz: 64, sy: 16,
    door: [254, 210], accent: '#a08a60', interior: false,
    description: 'Ground transport depot, cargo handling and vehicle maintenance.',
  },
]

export const facilityById = Object.fromEntries(FACILITIES.map((f) => [f.id, f])) as Record<string, Facility>

// ---------------------------------------------------------------- landing complex

export interface Pad { id: string; name: string; x: number; z: number; y: number; radius: number }

export const PADS: Pad[] = [
  { id: 'main', name: 'Main Landing Platform', x: -125, z: 20, y: 7, radius: 34 },
  { id: 'pad2', name: 'Secondary Pad 2', x: -135, z: -120, y: 0.4, radius: 18 },
  { id: 'pad3', name: 'Secondary Pad 3', x: -135, z: 160, y: 0.4, radius: 18 },
]

/** The Temple in the north-west corner: a square building whose door is in the middle of its east face. */
export const TEMPLE = { x: -255, z: -240, size: 92, height: 96, door: [-209, -240] as [number, number] }

/** Hangar door opening (east face of the hangar). */
export const HANGAR_DOOR = { x: -205, z: 20, width: 120, height: 38 }

// ---------------------------------------------------------------- perimeter

export function perimeterVertices(radius = PERIMETER_RADIUS): [number, number][] {
  const v: [number, number][] = []
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8
    v.push([Math.cos(a) * radius, Math.sin(a) * radius])
  }
  return v
}

export const GATES = [
  { id: 'east', name: 'East Gate (Outpost Road)', x: PERIMETER_RADIUS * Math.cos(Math.PI / 8), z: 0, rotY: Math.PI / 2 },
  { id: 'north', name: 'North Gate', x: 0, z: PERIMETER_RADIUS * Math.cos(Math.PI / 8), rotY: 0 },
]

// ---------------------------------------------------------------- roads + walk graph

/** Road / walkway graph nodes (all at y = 0). */
export const NAV_NODES: Record<string, [number, number]> = {
  hub: [0, 70],
  hubS: [0, -70],
  hubE: [80, 0],
  hubW: [-80, 0],
  apron: [-175, 20],
  apronN: [-175, 120],
  apronS: [-175, -90],
  pad2: [-135, -95],
  pad3: [-135, 135],
  engDoor: [146, 105],
  intDoor: [152, -95],
  eastJ: [120, 0],
  gateE: [430, 0],
  opsDoor: [10, 182],
  opsJ: [10, 140],
  resDoor: [-70, -187],
  resJ: [-70, -140],
  bunkerDoor: [105, -205],
  bunkerJ: [80, -140],
  secDoor: [255, -235],
  secJ: [240, -200],
  quartersDoor: [-227, 223],
  quartersJ: [-175, 220],
  transDoor: [254, 210],
  transJ: [225, 190],
  gateN: [0, 430],
  northJ: [0, 300],
}

export const NAV_EDGES: [string, string][] = [
  ['hub', 'hubE'], ['hub', 'hubW'], ['hubS', 'hubE'], ['hubS', 'hubW'],
  ['hubW', 'apron'], ['apron', 'apronN'], ['apron', 'apronS'], ['apronS', 'pad2'], ['apronN', 'pad3'],
  ['hubE', 'eastJ'], ['eastJ', 'engDoor'], ['eastJ', 'intDoor'], ['eastJ', 'gateE'],
  ['hub', 'opsJ'], ['opsJ', 'opsDoor'], ['opsJ', 'northJ'], ['northJ', 'gateN'],
  ['hubS', 'resJ'], ['resJ', 'resDoor'], ['hubS', 'bunkerJ'], ['bunkerJ', 'bunkerDoor'],
  ['bunkerJ', 'secJ'], ['secJ', 'secDoor'], ['apronN', 'quartersJ'], ['quartersJ', 'quartersDoor'],
  ['northJ', 'transJ'], ['transJ', 'transDoor'], ['engDoor', 'transJ'], ['intDoor', 'secJ'],
  ['quartersJ', 'northJ'], ['resJ', 'apronS'],
]

/** Main roads drawn as ribbons: polylines with width. */
export const ROADS: { pts: [number, number][]; width: number }[] = [
  { pts: [[-175, 20], [-80, 0], [80, 0], [430, 0], [520, 0]], width: 16 },
  { pts: [[0, 70], [0, 300], [0, 520]], width: 12 },
  { pts: [[-175, -90], [-175, 220]], width: 12 },
  { pts: [[0, -70], [-70, -140], [-70, -187]], width: 9 },
  { pts: [[0, -70], [80, -140], [105, -205]], width: 9 },
  { pts: [[80, -140], [240, -200], [255, -235]], width: 9 },
  { pts: [[120, 0], [146, 105]], width: 9 },
  { pts: [[120, 0], [152, -95]], width: 9 },
  { pts: [[0, 300], [225, 190], [254, 210]], width: 10 },
  { pts: [[-175, 220], [-227, 223]], width: 9 },
  { pts: [[-175, 220], [0, 300]], width: 9 },
]

/** The long outpost road leaving the east gate, follows terrain. */
export const OUTPOST = { name: 'Mining Outpost Kel-Dorr', x: 3100, z: 950 }

/** Control points of the outpost road (smoothed with a centripetal Catmull-Rom by renderer and vehicles). */
export const OUTPOST_ROAD: [number, number][] = [[520, 0], [900, 60], [1500, 380], [2200, 560], [2700, 820], [OUTPOST.x - 120, OUTPOST.z]]

/** Distant settlements (purely scenic). */
export const SETTLEMENTS: { name: string; x: number; z: number; size: number }[] = [
  { name: 'Mining Outpost Kel-Dorr', x: 3100, z: 950, size: 1 },
  { name: 'Moisture Farm Cluster', x: -2600, z: -2100, size: 0.6 },
  { name: 'Relay Station Nyx', x: 1800, z: -3000, size: 0.5 },
]

/** Axis-aligned obstacle boxes (for flight-path clearance tests and first-person collision). */
export function obstacleBoxes(): { min: [number, number, number]; max: [number, number, number]; id: string }[] {
  const boxes: { min: [number, number, number]; max: [number, number, number]; id: string }[] = FACILITIES.map((f) => ({
    id: f.id,
    min: [f.x - f.sx / 2, 0, f.z - f.sz / 2] as [number, number, number],
    max: [f.x + f.sx / 2, f.sy, f.z + f.sz / 2] as [number, number, number],
  }))
  // command spire is taller than its podium footprint suggests
  boxes.push({ id: 'command-spire', min: [-22, 0, -22], max: [22, 160, 22] })
  boxes.push({
    id: 'temple', min: [TEMPLE.x - TEMPLE.size / 2, 0, TEMPLE.z - TEMPLE.size / 2],
    max: [TEMPLE.x + TEMPLE.size / 2, TEMPLE.height, TEMPLE.z + TEMPLE.size / 2],
  })
  return boxes
}

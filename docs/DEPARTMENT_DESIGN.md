# Department design

Interiors are defined in `frontend/src/interiors/layouts.ts` (rooms, stations, lounges, zone labels) and built by
`Interiors.tsx`. Only the interior you are in is rendered. Each has distinct accent lighting and zone signage.

| Department | Interior | Zones / stations | Who works here (real agents) |
|---|---|---|---|
| **Command** (tower bridge, 102 m up) | 62 × 30 m, floor-to-ceiling clear glass over the live base | Holographic tactical table (live miniature: buildings, perimeter, simulated aircraft blips, **real agent positions coloured by status**), two crew pits of consoles, communications terminals, agent-monitoring console, observation deck | — (Commander's view) |
| **Engineering** | 96 × 74 m floor | 12 development workstations, 6 test-lab benches, build-monitoring and deployment terminals, collaboration table + holotable, lounges | Lead Developers (main sessions), general-purpose / testing subagents |
| **Intelligence** | 84 × 60 m hall | 8 analysis stations, records archive, investigation labs, briefing room + holotable | Explore / research / docs / guide subagents |
| **Operations** | 64 × 50 m mission control | active-mission holotable, assignment + reporting consoles, task-monitoring wall terminals | Plan / architect subagents |
| **AI Research Labs** | 80 × 66 m low lab | model-evaluation benches, local compute racks, research workstations, **live host-telemetry wall** | model / eval subagents |
| **Security** | 44 × 44 m SOC | surveillance wall, access-control consoles, incident-response holotable | review / verification / audit subagents |
| **Server Bunker** | 84 × 60 m hall, 16 m underground | 48 server racks in rows, network-core holotable, hardware terminals, **live telemetry wall (CPU, memory, GPU availability, Claude process count, Docker containers)** | — |
| **Hangar Alpha** | open, walkable at full scale | maintenance bays with floor markings, TIE racks (parked fighters), fuel tanks, mezzanine, gantries, cargo | — |
| Quarters, Transport | exterior only | | — |

## Station ↔ tool mapping (real activity)

| Active tool (from PreToolUse) | Station types preferred |
|---|---|
| Bash, PowerShell | terminal → console → lab |
| Read, Grep, Glob | archive → console |
| Edit, Write, MultiEdit, NotebookEdit | console |
| WebFetch, WebSearch | terminal → archive → console |
| Agent, Task, TodoWrite / status `delegating` | holotable → briefing → console (talk animation) |
| other / none while active | console → terminal → lab |

Free stations are preferred; holotables and briefing tables can be shared. When none fits, the agent goes to
the lounge.

## Entering

Facilities tab → *Enter* (orbit inside) or *Walk in* (first-person at the door), or walk up to a door in
first/third person and press **E**. Press **E** at the entry (or *Exit* in the top bar) to leave.

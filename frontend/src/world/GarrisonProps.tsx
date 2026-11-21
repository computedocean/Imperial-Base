// Garrison dressing and tactical infrastructure:
// Imperial cargo containers, coaxium fuel canisters, moisture vaporators, surface conduit trunks,
// auxiliary power substations, defense barricades and heavy 18m industrial floodlight towers.
// Built with the procedural Kit and merged into a handful of draw calls.
import { useMemo } from 'react'
import * as THREE from 'three'
import { Kit } from './kit'
import { KitMesh } from './Structures'

export interface FloodlightSpec {
  x: number
  z: number
  rotY: number
  targetX: number
  targetZ: number
}

export const FLOODLIGHTS: FloodlightSpec[] = [
  { x: -180, z: 100, rotY: Math.PI * 0.85, targetX: -140, targetZ: 150 }, // Pad 3 & taxiway
  { x: -180, z: -60, rotY: Math.PI * 0.15, targetX: -140, targetZ: -110 }, // Pad 2 & taxiway
  { x: -50, z: 290, rotY: Math.PI * 0.65, targetX: -80, targetZ: 335 }, // Main platform approach
  { x: 215, z: 235, rotY: Math.PI * 0.1, targetX: 250, targetZ: 240 }, // Transport depot yard
  { x: 140, z: 20, rotY: Math.PI * 0.35, targetX: 180, targetZ: 50 }, // Engineering logistics corridor
  { x: 190, z: -170, rotY: -Math.PI * 0.35, targetX: 230, targetZ: -200 }, // Security & intel yard
]

function buildGarrisonProps(): Kit {
  const k = new Kit()

  // ------------------------------------------------------------------ 1. Standard Imperial Cargo Containers
  // A standard container is 4.8m x 2.2m x 2.2m with corner reinforcements, ribbed frame, and indicator latches
  const container = (x: number, y: number, z: number, rotY = 0, mat: 'rust' | 'dark' | 'light' = 'dark') => {
    // Pallet base
    k.box('black', [5.0, 0.25, 2.4], [x, y, z], rotY)
    // Main container body
    k.box(mat, [4.8, 2.1, 2.2], [x, y + 0.25, z], rotY)
    // Corner cast reinforcements
    k.box('black', [0.35, 2.15, 0.35], [x - 2.3, y + 0.25, z - 1.0], rotY)
    k.box('black', [0.35, 2.15, 0.35], [x + 2.3, y + 0.25, z - 1.0], rotY)
    k.box('black', [0.35, 2.15, 0.35], [x - 2.3, y + 0.25, z + 1.0], rotY)
    k.box('black', [0.35, 2.15, 0.35], [x + 2.3, y + 0.25, z + 1.0], rotY)
    // Center lock latch and status pip
    k.box('black', [0.6, 0.8, 0.2], [x, y + 1.0, z + 1.12], rotY)
    k.box('amber', [0.15, 0.15, 0.15], [x, y + 1.25, z + 1.22], rotY)
  }

  // Staging Yard 1: Hangar North Apron (Pad 3 side)
  container(-190, 0, 95, 0.1, 'dark')
  container(-190, 0, 101, 0.1, 'rust')
  container(-190, 2.35, 98, 0.1, 'light') // 2nd tier
  container(-196, 0, 98, -0.05, 'dark')
  container(-196, 0, 104, -0.05, 'dark')
  container(-196, 2.35, 101, -0.05, 'rust')
  container(-196, 4.7, 101, -0.05, 'dark') // 3rd tier

  // Staging Yard 2: Hangar South Apron (Pad 2 side)
  container(-190, 0, -65, -0.15, 'rust')
  container(-190, 0, -71, -0.15, 'dark')
  container(-190, 2.35, -68, -0.15, 'dark')
  container(-196, 0, -68, 0, 'light')
  container(-196, 0, -74, 0, 'dark')

  // Staging Yard 3: Transport Depot Cargo Terminal (dense stacked yard)
  const depotCols = [-2, -1, 0, 1, 2]
  const depotRows = [0, 1, 2]
  depotCols.forEach((col, ci) => {
    depotRows.forEach((row, ri) => {
      const cx = 302 + col * 5.6
      const cz = 212 + row * 4.2
      const tint: ('rust' | 'dark' | 'light')[] = ['dark', 'rust', 'light']
      const m = tint[(ci + ri) % 3]
      container(cx, 0, cz, 0.05, m)
      if ((ci + ri) % 2 === 0) {
        container(cx, 2.35, cz, 0.05, tint[(ci + ri + 1) % 3])
        if (ci === 0 && row === 1) container(cx, 4.7, cz, 0.05, 'dark')
      }
    })
  })

  // Staging Yard 4: Engineering Equipment & Machinery
  container(146, 0, 75, Math.PI / 2, 'dark')
  container(146, 0, 81, Math.PI / 2, 'rust')
  container(146, 2.35, 78, Math.PI / 2, 'dark')
  container(146, 0, 125, Math.PI / 2, 'light')
  container(146, 0, 131, Math.PI / 2, 'dark')

  // Staging Yard 5: Personnel Quarters Medical / Life Support Supplies
  container(-268, 0, 218, 0, 'light')
  container(-268, 0, 224, 0, 'light')
  container(-268, 2.35, 221, 0, 'dark')

  // ------------------------------------------------------------------ 2. Coaxium / Pressurized Coolant Canisters
  const canisterCluster = (cx: number, cz: number, count = 4) => {
    // Hexagonal pallet
    k.cyl('dark', 2.8, 3.0, 0.35, [cx, 0, cz], 6)
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2
      const ox = cx + Math.cos(a) * 1.5
      const oz = cz + Math.sin(a) * 1.5
      // Standing cylinder
      k.cyl('light', 0.65, 0.65, 3.2, [ox, 0.35, oz], 14)
      k.cyl('stripe', 0.68, 0.68, 0.4, [ox, 1.8, oz], 14) // yellow hazard band
      k.sphere('dark', 0.62, [ox, 3.55, oz], 12, true) // dome top
      k.box('amber', [0.15, 0.25, 0.15], [ox, 3.75, oz]) // valve pip
    }
  }

  canisterCluster(155, 128, 5) // Outside Engineering
  canisterCluster(-42, -245, 4) // Outside AI Labs
  canisterCluster(-162, -145, 5) // Secondary Pad 2 support
  canisterCluster(-162, 185, 5) // Secondary Pad 3 support
  canisterCluster(268, -250, 4) // Outside Security

  // ------------------------------------------------------------------ 3. Moisture Vaporators (Ketrax Prime Tech)
  const vaporator = (x: number, z: number, hScale = 1.0) => {
    // Ground anchor collar
    k.cyl('dark', 1.4, 1.6, 0.6, [x, 0, z], 8)
    // Lower condenser base
    k.cyl('hull', 0.55, 0.65, 3.5 * hScale, [x, 0.6, z], 10)
    // 4 radial radiator fins
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2
      const rx = Math.cos(a) * 0.7
      const rz = Math.sin(a) * 0.7
      k.box('dark', [0.12, 2.8 * hScale, 0.6], [x + rx, 0.8, z + rz], a)
    }
    // Main mast
    const mastH = 7.0 * hScale
    k.cyl('dark', 0.22, 0.35, mastH, [x, 3.5 * hScale + 0.6, z], 8)
    // Upper vapor intake cowl
    const topY = 0.6 + 3.5 * hScale + mastH
    k.cyl('hull', 0.75, 0.4, 1.2, [x, topY, z], 8)
    // Cross-arm sensor vanes
    k.box('black', [2.8, 0.12, 0.12], [x, topY + 0.8, z], 0)
    k.box('black', [0.12, 0.12, 2.8], [x, topY + 0.8, z], 0)
    // Peak warning beacon
    k.box('amber', [0.35, 0.35, 0.35], [x, topY + 1.2, z])
  }

  // Moisture vaporator clusters in open sandy/gravel areas
  const vapClusters = [
    // NW near Temple
    [-172, -260], [-184, -252], [-168, -272],
    // SW near AI Labs
    [-126, -282], [-136, -274], [-118, -292],
    // SE near Security
    [212, -266], [222, -258], [216, -276],
    // NE near North Gate
    [64, 276], [74, 282],
  ]
  vapClusters.forEach(([vx, vz], i) => vaporator(vx, vz, 0.85 + (i % 3) * 0.15))

  // ------------------------------------------------------------------ 4. Surface Heavy Power Conduits
  // Conduits linking Server Bunker (105, -230) to Citadel and Engineering
  const conduitSaddle = (x: number, z: number, rotY: number) => {
    k.box('concrete', [1.8, 0.45, 0.8], [x, 0, z], rotY)
    k.box('black', [1.5, 0.6, 0.6], [x, 0.45, z], rotY)
  }

  const conduitSpan = (x1: number, z1: number, x2: number, z2: number) => {
    const len = Math.hypot(x2 - x1, z2 - z1)
    const rot = -Math.atan2(z2 - z1, x2 - x1)
    const mx = (x1 + x2) / 2
    const mz = (z1 + z2) / 2
    // Twin heavy pipes
    const perp = rot + Math.PI / 2
    const offX = Math.cos(perp) * 0.42
    const offZ = -Math.sin(perp) * 0.42
    k.cyl('dark', 0.26, 0.26, len, [mx + offX, 0.65, mz + offZ], 8, [Math.PI / 2, rot, 0])
    k.cyl('dark', 0.26, 0.26, len, [mx - offX, 0.65, mz - offZ], 8, [Math.PI / 2, rot, 0])
    // Support saddles every 10m
    const n = Math.floor(len / 10)
    for (let i = 0; i <= n; i++) {
      const t = n > 0 ? i / n : 0.5
      const sx = x1 + (x2 - x1) * t
      const sz = z1 + (z2 - z1) * t
      conduitSaddle(sx, sz, rot)
    }
  }

  // Bunker north run towards Citadel
  conduitSpan(94, -205, 94, -80)
  conduitSpan(94, -80, 52, -80) // Bend into Citadel podium
  k.box('dark', [1.8, 1.4, 1.8], [94, 0, -80]) // Junction breaker box
  k.box('amber', [0.25, 0.25, 0.25], [94, 1.5, -80])

  // Bunker east run towards Engineering
  conduitSpan(105, -210, 182, -210)
  conduitSpan(182, -210, 182, 60)
  k.box('dark', [2.0, 1.6, 2.0], [182, 0, -210]) // Corner substation box
  k.box('stripe', [2.1, 0.35, 2.1], [182, 1.4, -210])

  // ------------------------------------------------------------------ 5. Auxiliary Power Generators
  const generatorSubstation = (x: number, z: number, rotY: number) => {
    // Concrete foundation pad
    k.box('concrete', [8.4, 0.3, 6.4], [x, 0, z], rotY)
    // Main generator housing
    k.box('hull', [7.6, 3.5, 5.6], [x, 0.3, z], rotY)
    // Radiator cooling grill on side
    k.box('black', [0.25, 2.2, 4.4], [x - 3.85, 1.0, z], rotY)
    k.box('orangeGlow', [0.3, 1.8, 3.8], [x - 3.85, 1.2, z], rotY) // Thermal vent glow
    // Top exhaust turbine shroud
    k.cyl('dark', 1.6, 1.8, 1.2, [x + 1.5, 3.8, z], 16)
    k.cyl('black', 1.4, 1.4, 0.3, [x + 1.5, 4.8, z], 16)
    k.box('orangeGlow', [1.2, 0.15, 1.2], [x + 1.5, 4.7, z]) // Heat glow in turbine
    // Control console & status lights
    k.box('dark', [0.8, 1.6, 1.4], [x + 3.85, 0.5, z], rotY)
    k.box('amber', [0.15, 0.15, 0.3], [x + 4.3, 1.6, z], rotY)
    k.box('blueShield', [0.15, 0.15, 0.3], [x + 4.3, 1.3, z], rotY)
  }

  generatorSubstation(250, 160, Math.PI / 2) // Engineering auxiliary power
  generatorSubstation(58, -240, 0) // Server Bunker backup generator

  // ------------------------------------------------------------------ 6. Perimeter Defense Barricades & Checkpoints
  const blastBarricade = (x: number, z: number, rotY: number, len = 12) => {
    // Battered concrete blast wall with steel chevron cap
    k.taper('concrete', [len, 1.8], [len, 0.9], 2.2, [x, 0, z], rotY)
    k.box('dark', [len, 0.4, 1.1], [x, 2.2, z], rotY)
    k.box('stripe', [len, 0.15, 1.15], [x, 2.4, z], rotY) // Hazard yellow warning strip
  }

  // East Gate defense chicane
  blastBarricade(400, 14, 0, 16)
  blastBarricade(400, -14, 0, 16)
  blastBarricade(375, 0, Math.PI / 2, 14) // Center divider baffle
  // Sentry turret mount at East Gate
  k.cyl('dark', 2.2, 2.8, 1.6, [390, 0, -22], 12)
  k.box('dark', [1.8, 1.2, 1.8], [390, 1.6, -22])
  k.boxR('black', [0.25, 0.25, 3.2], [390, 2.3, -20.5], [0.15, 0, 0]) // Twin barrel
  k.box('red', [0.35, 0.35, 0.35], [390, 2.8, -22])

  // North Gate defense checkpoint
  blastBarricade(14, 400, Math.PI / 2, 16)
  blastBarricade(-14, 400, Math.PI / 2, 16)
  blastBarricade(0, 375, 0, 14)

  // ------------------------------------------------------------------ 7. Heavy 18m Industrial Floodlight Towers
  FLOODLIGHTS.forEach((fl) => {
    const { x, z, rotY } = fl
    // Heavy concrete foundation footing
    k.box('concrete', [4.8, 0.6, 4.8], [x, 0, z], rotY)
    // 4-leg tapered steel lattice tower mast
    k.taper('dark', [4.2, 4.2], [1.8, 1.8], 16.5, [x, 0.6, z], rotY)
    // Internal access ladder casing
    k.box('black', [0.6, 16.5, 0.6], [x, 0.6, z], rotY)
    // Catwalk maintenance platform at 17m
    k.box('dark', [3.4, 0.3, 3.4], [x, 17.1, z], rotY)
    // Platform safety railing
    k.box('black', [3.4, 0.9, 0.1], [x, 17.4, z + 1.65], rotY)
    k.box('black', [3.4, 0.9, 0.1], [x, 17.4, z - 1.65], rotY)
    k.box('black', [0.1, 0.9, 3.4], [x + 1.65, 17.4, z], rotY)
    k.box('black', [0.1, 0.9, 3.4], [x - 1.65, 17.4, z], rotY)
    // Floodlight mounting gantry crossbar
    k.box('black', [4.2, 0.4, 0.8], [x, 18.2, z], rotY)
    // 3 high-intensity angled floodlight housings
    for (const off of [-1.4, 0, 1.4]) {
      const fx = x + Math.cos(rotY) * off
      const fz = z - Math.sin(rotY) * off
      // Angled housing pointing down towards target
      k.boxR('black', [1.1, 0.7, 0.9], [fx, 18.7, fz], [0.55, rotY, 0])
      // Emissive floodlight face
      k.boxR('floodLight', [0.95, 0.55, 0.1], [fx, 18.65, fz + 0.45], [0.55, rotY, 0])
    }
    // Red aircraft warning beacon atop the mast
    k.cyl('black', 0.1, 0.15, 1.2, [x, 18.5, z], 6)
    k.box('red', [0.45, 0.45, 0.45], [x, 19.7, z])
  })

  return k
}

export function GarrisonProps() {
  const kitMesh = useMemo(() => buildGarrisonProps, [])
  return <KitMesh build={kitMesh} name="garrison-props" />
}

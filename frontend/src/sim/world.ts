// Environmental simulation hub (aircraft, hangar doors). Mutable singletons updated once per
// frame by <SimDriver/>; UI reads a coarse snapshot (4 Hz) from useSimStatus.
// NOTE: everything here is simulated scenery — it never represents real-world activity.
import { create } from 'zustand'
import { FUEL_DUMP, PatrolSim, ShuttleSim, XWingSim, type FlightState, type ShuttlePhase } from '../aircraft/flight'
import { DESTROYER, DestroyerSim, type DestroyerPhase } from '../aircraft/destroyer'
import { FreighterSim, type FreighterPhase } from '../aircraft/freighter'
import { GunshipSim, type LanderPhase } from '../aircraft/visitors'
import { MarchSim } from '../personnel/marchPlan'
import { useStore } from '../state/store'

export const sim = {
  time: 0,
  shuttle: new ShuttleSim(),
  patrol: new PatrolSim(),
  xwing: new XWingSim(),
  freighter: new FreighterSim(),
  gunship: new GunshipSim(),
  destroyer: new DestroyerSim(),
  march: new MarchSim(),
  hangarDoor: 0, // 0 closed .. 1 open
  hangarMode: 'auto' as 'auto' | 'open' | 'closed',
}

export interface SimStatus {
  shuttlePhase: ShuttlePhase
  shuttleProgress: number
  shuttleAuto: boolean
  patrolActive: boolean
  fighters: { id: string; callsign: string; state: FlightState }[]
  xwingActive: boolean
  /** the fuel dump is a burning wreck right now */
  dumpBurning: boolean
  freighterPhase: FreighterPhase
  freighterProgress: number
  freighterAuto: boolean
  gunshipPhase: LanderPhase
  destroyerPhase: DestroyerPhase
  marching: boolean
  hangarDoor: number
  hangarMode: 'auto' | 'open' | 'closed'
}

export const useSimStatus = create<SimStatus>(() => ({
  shuttlePhase: 'away', shuttleProgress: 0, shuttleAuto: true, patrolActive: false, fighters: [], xwingActive: false, dumpBurning: false,
  freighterPhase: 'impounded', freighterProgress: 0, freighterAuto: true, gunshipPhase: 'away', destroyerPhase: 'away', marching: false,
  hangarDoor: 0, hangarMode: 'auto',
}))

const feed = (t: string, tone: 'info' | 'warn' | 'alert' | 'ok' | 'sim' = 'sim') => useStore.getState().pushFeed(t, tone, 'sim')

export const commands = {
  shuttleArrive() {
    if (sim.shuttle.arrive(sim.time)) feed('[SIM] Imperial shuttle ST-221 inbound — clear the Main Landing Platform')
    else feed('[SIM] Shuttle arrival unavailable: shuttle is not in deep-space holding', 'warn')
  },
  shuttleDepart() {
    if (sim.shuttle.depart(sim.time)) feed('[SIM] Shuttle cleared for departure')
    else feed('[SIM] Shuttle departure unavailable: shuttle is not on the pad', 'warn')
  },
  setShuttleAuto(v: boolean) { sim.shuttle.autoCycle = v },
  startPatrol(immediate = false) {
    sim.patrol.start(immediate)
    feed('[SIM] TIE patrol wings Onyx & Sable launching')
  },
  stopPatrol() {
    sim.patrol.stop()
    feed('[SIM] TIE patrols recalled to Hangar Alpha')
  },
  xwingFlyby() {
    if (sim.xwing.trigger(sim.time, sim.patrol.active)) {
      feed('[SIM] THREE UNIDENTIFIED CONTACTS on the eastern horizon — classification: hostile starfighters', 'alert')
      feed('[SIM] Picket fighter Sable-9 turning in to engage head-on', 'warn')
      if (sim.patrol.active) feed('[SIM] Interceptor pair vectoring to pursue', 'warn')
    }
  },
  /** Bring the star destroyer in now (if it is on station it jumps out first and comes back). */
  destroyerArrive() {
    const d = sim.destroyer
    if (d.phase === 'away') d.t0 = sim.time - DESTROYER.timing.away + 2.5
    else if (d.phase === 'station') { d.t0 = sim.time - DESTROYER.timing.station; feed('[SIM] Star Destroyer ordered to jump — it will return shortly') }
  },
  marchStart() {
    if (!sim.march.start(sim.time)) feed('[SIM] The column is already on the march', 'warn')
  },
  freighterEscape() {
    if (!sim.freighter.escape(sim.time)) feed('[SIM] Freighter escape unavailable: the freighter is not on Pad 3', 'warn')
  },
  setFreighterAuto(v: boolean) {
    sim.freighter.autoCycle = v
    if (v && sim.freighter.phase === 'impounded') sim.freighter.t0 = sim.time // restart the countdown
  },
  setHangar(mode: 'auto' | 'open' | 'closed') { sim.hangarMode = mode },
}

/** Advance all simulations; called once per frame. */
export function stepSim(dt: number) {
  const d = Math.min(dt, 0.1)
  sim.time += d
  sim.shuttle.update(sim.time)
  sim.patrol.update(d)
  sim.xwing.update(sim.time)
  sim.freighter.update(sim.time)
  sim.gunship.update(sim.time)
  sim.destroyer.update(sim.time)
  sim.march.update(sim.time)
  // hangar doors: open while fighters transit the hangar (auto), or on command
  let want = 0
  if (sim.hangarMode === 'open') want = 1
  else if (sim.hangarMode === 'auto') {
    const transit = sim.patrol.fighters.some((f) => (f.state === 'launching' && f.u < 0.35) || (f.state === 'returning' && f.u > 0.55))
    want = transit ? 1 : 0
  }
  const rate = 0.12 * d
  sim.hangarDoor += Math.max(-rate, Math.min(rate, want - sim.hangarDoor))
}

let acc = 0
let lastPhase: ShuttlePhase = 'away'
let lastFreighter: FreighterPhase = 'impounded'
let lastKills = 0
let lastGunship: LanderPhase = 'away'
let lastMarch = 0
let marchOn = false
let lastDestroyer: DestroyerPhase = 'away'
let lastStrikes = 0
let dumpDown = false
export function publishSim(dt: number) {
  acc += dt
  const ph = sim.shuttle.phase
  if (ph !== lastPhase) {
    const msg: Partial<Record<ShuttlePhase, string>> = {
      descent: '[SIM] Shuttle on final descent — wings folding, landing gear deploying',
      landed: '[SIM] Shuttle down on Main Landing Platform — ground crew dispatched',
      liftoff: '[SIM] Shuttle lifting off',
      away: '[SIM] Shuttle has jumped to hyperspace',
    }
    if (msg[ph]) feed(msg[ph]!)
    lastPhase = ph
  }
  if (sim.xwing.kills !== lastKills) {
    lastKills = sim.xwing.kills
    feed('[SIM] Picket fighter Sable-9 destroyed by the intruder over the eastern approach', 'alert')
  }
  if (sim.xwing.strikes !== lastStrikes) {
    lastStrikes = sim.xwing.strikes
    dumpDown = true
    feed('[SIM] FUEL DEPOT HIT on the east apron — tanks and the fuel truck destroyed, fire crews responding', 'alert')
  }
  if (dumpDown && sim.xwing.strikeAt !== null && sim.time - sim.xwing.strikeAt >= FUEL_DUMP.rebuildAfter) {
    dumpDown = false
    feed('[SIM] Fuel depot fire is out — depot rebuilt, a new fuel truck on station')
  }
  const fp = sim.freighter.phase
  if (fp !== lastFreighter) {
    const msg: Partial<Record<FreighterPhase, [string, 'alert' | 'warn' | 'sim']>> = {
      boarding: ['[SIM] Two fugitives sprinting across Pad 3 for the impounded freighter — security to Pad 3', 'warn'],
      liftoff: ['[SIM] IMPOUNDED FREIGHTER has broken its docking clamps on Pad 3 — all batteries track', 'alert'],
      escape: ['[SIM] Freighter running the southern apron, heading for the eastern valley', 'warn'],
      away: ['[SIM] Freighter lost from scopes beyond the eastern range', 'sim'],
      return: ['[SIM] Freighter re-acquired and under tractor escort — inbound for Pad 3', 'sim'],
      impounded: ['[SIM] Freighter down on Pad 3 — clamps re-engaged, impound restored', 'sim'],
    }
    const m = msg[fp]
    if (m) feed(m[0], m[1])
    lastFreighter = fp
  }
  if (sim.march.count !== lastMarch) {
    lastMarch = sim.march.count
    marchOn = true
    feed('[SIM] A hooded knight is leading a clone trooper column up the approach to the Temple', 'warn')
  }
  if (marchOn && sim.march.t0 === null) {
    marchOn = false
    feed('[SIM] The column has entered the Temple — the great doors are sealed')
  }
  const gp = sim.gunship.phase
  if (gp !== lastGunship) {
    const msg: Partial<Record<LanderPhase, string>> = {
      approach: '[SIM] Bounty hunter gunship requesting the visitor stand — cleared to land, east apron',
      landed: '[SIM] Gunship down on the visitor stand — bounty hunter reporting to Security',
      liftoff: '[SIM] Gunship lifting off the visitor stand',
      away: '[SIM] Gunship has left the system',
    }
    if (msg[gp]) feed(msg[gp]!)
    lastGunship = gp
  }
  const dp = sim.destroyer.phase
  if (dp !== lastDestroyer) {
    const msg: Partial<Record<DestroyerPhase, [string, 'ok' | 'sim']>> = {
      arrive: ['[SIM] Star Destroyer dropping out of hyperspace above the northern range', 'ok'],
      station: ['[SIM] Star Destroyer on station in high orbit — fleet link established', 'sim'],
      jump: ['[SIM] Star Destroyer jumping to light speed', 'sim'],
    }
    const m = msg[dp]
    if (m) feed(m[0], m[1])
    lastDestroyer = dp
  }
  if (acc < 0.25) return
  acc = 0
  useSimStatus.setState({
    shuttlePhase: ph,
    shuttleProgress: sim.shuttle.state.progress,
    shuttleAuto: sim.shuttle.autoCycle,
    patrolActive: sim.patrol.active,
    fighters: sim.patrol.fighters.map((f) => ({ id: f.id, callsign: f.callsign, state: f.state })),
    xwingActive: sim.xwing.active,
    dumpBurning: dumpDown,
    freighterPhase: fp,
    freighterProgress: sim.freighter.progress,
    freighterAuto: sim.freighter.autoCycle,
    gunshipPhase: gp,
    destroyerPhase: dp,
    marching: sim.march.t0 !== null,
    hangarDoor: sim.hangarDoor,
    hangarMode: sim.hangarMode,
  })
}

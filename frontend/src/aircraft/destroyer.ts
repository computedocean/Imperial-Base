// Star destroyer on high station — pure TypeScript (no React), deterministic, unit-tested.
// Environmental simulation only: it is NOT telemetry of anything real.
//
// A capital ship drops out of hyperspace high above the northern mountains: it arrives as a streak
// of light that snaps down to a hull with a flash, holds station for a while creeping forward, then
// stretches out again and jumps away. Some time later it (or its sister) returns.
import * as THREE from 'three'
import { clamp01 } from './flight'

export type DestroyerPhase = 'away' | 'arrive' | 'station' | 'jump'
export const DESTROYER = {
  /** where it comes to rest: high over the mountains north-west of the base */
  station: new THREE.Vector3(-3600, 4600, -7200),
  /** unit direction of travel (it arrives from behind this, and leaves along it) */
  heading: new THREE.Vector3(0.94, -0.03, 0.34).normalize(),
  /** hull length in metres (the model is built to this size) */
  length: 1600,
  /** how far back along its heading it first appears */
  runIn: 26000,
  /** how far it stretches while at light speed (multiples of its own length) */
  streak: 26,
  timing: { arrive: 2.6, station: 150, jump: 2.2, away: 70 },
  firstArrival: 12,
  /** creep speed on station, m/s */
  drift: 14,
}

export interface DestroyerState {
  phase: DestroyerPhase
  pos: THREE.Vector3
  visible: boolean
  /** scale along the direction of travel: 1 = a ship, large = a streak of light */
  stretch: number
  /** 0..1 brightness of the arrival / departure flash */
  flash: number
  /** 0..1 engine glow */
  thrust: number
}

const ORDER: DestroyerPhase[] = ['away', 'arrive', 'station', 'jump']

export class DestroyerSim {
  phase: DestroyerPhase = 'away'
  t0 = DESTROYER.firstArrival - DESTROYER.timing.away
  /** counts arrivals, so views and the feed can react to each one exactly once */
  arrivals = 0
  jumps = 0
  readonly state: DestroyerState = { phase: 'away', pos: DESTROYER.station.clone(), visible: false, stretch: 1, flash: 0, thrust: 0 }

  update(now: number): DestroyerState {
    const T = DESTROYER.timing
    const s = this.state
    for (let guard = 0; guard < 6; guard++) {
      const d = T[this.phase]
      if (now - this.t0 < d) break
      this.t0 += d
      this.phase = ORDER[(ORDER.indexOf(this.phase) + 1) % ORDER.length]
      if (this.phase === 'arrive') this.arrivals++
      if (this.phase === 'jump') this.jumps++
    }
    const t = now - this.t0
    const k = clamp01(t / T[this.phase])
    s.phase = this.phase
    s.visible = this.phase !== 'away'
    s.flash = 0
    switch (this.phase) {
      case 'away':
        s.stretch = 1; s.thrust = 0
        break
      case 'arrive': {
        // exponential braking: nearly all the distance is covered in the first instant
        const remaining = Math.pow(1 - k, 5)
        s.pos.copy(DESTROYER.station).addScaledVector(DESTROYER.heading, -DESTROYER.runIn * remaining)
        s.stretch = 1 + (DESTROYER.streak - 1) * Math.pow(1 - k, 3)
        s.flash = Math.exp(-t * 4.5)
        s.thrust = 1 - 0.6 * k
        break
      }
      case 'station':
        s.pos.copy(DESTROYER.station).addScaledVector(DESTROYER.heading, DESTROYER.drift * t)
        s.stretch = 1
        s.thrust = 0.4
        break
      case 'jump': {
        // a breath of acceleration, then gone
        const go = Math.pow(k, 6)
        s.pos.copy(DESTROYER.station).addScaledVector(DESTROYER.heading, DESTROYER.drift * T.station + DESTROYER.runIn * go)
        s.stretch = 1 + (DESTROYER.streak - 1) * Math.pow(k, 4)
        s.flash = Math.pow(k, 8)
        s.thrust = 0.4 + 0.6 * k
        break
      }
    }
    return s
  }
}

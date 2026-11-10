// Imperial Base sound engine — every sound is synthesised live with the Web Audio API.
// No recordings are used (film sound effects are copyrighted); these are original sounds.
//
// Design rules (v3, after "the sounds are awful" feedback):
//  * engines are built from FILTERED NOISE (how real engines/jets sound), not buzzy saw/square waves;
//  * no waveshaper distortion anywhere;
//  * tonal layers are soft (sine/triangle, low-passed) and only come forward on close passes;
//  * fighters are effectively silent when far away — no permanent whining chorus;
//  * no mains-hum drones; alerts use soft triangle tones.
//
// Spatialisation: one PannerNode per aircraft, the camera is the listener, manual Doppler shift.
import * as THREE from 'three'
import { HANGAR_DOOR } from '../world/layout'
import { sim } from '../sim/world'
import { XWING_KILL, XWING_TIMING } from '../aircraft/flight'

export const SPEED_OF_SOUND = 343
const DOPPLER_SCALE = 0.6

/**
 * Doppler pitch factor for a source/listener pair (velocities in m/s).
 * > 1 when they approach each other, < 1 when they separate. Clamped to [0.5, 2].
 */
export function dopplerFactor(src: THREE.Vector3, srcVel: THREE.Vector3, lis: THREE.Vector3, lisVel: THREE.Vector3, c = SPEED_OF_SOUND, scale = DOPPLER_SCALE) {
  const dx = lis.x - src.x, dy = lis.y - src.y, dz = lis.z - src.z
  const d = Math.hypot(dx, dy, dz)
  if (d < 1e-3) return 1
  const ux = dx / d, uy = dy / d, uz = dz / d // unit vector source -> listener
  const vs = (srcVel.x * ux + srcVel.y * uy + srcVel.z * uz) * scale
  const vl = (lisVel.x * ux + lisVel.y * uy + lisVel.z * uz) * scale
  const f = (c - vl) / Math.max(1, c - vs)
  return Math.min(2, Math.max(0.5, f))
}

/** 0..1 "how close is it" weighting used to bring the scream/whistle forward on a pass. */
export function proximity(dist: number, near: number) {
  return 1 / (1 + (dist / near) * (dist / near))
}

// ------------------------------------------------------------------ context + buses
let ctx: AudioContext | null = null
let master: GainNode
let extBus: GainNode // outdoors (muffled inside buildings)
let extFilter: BiquadFilterNode
let engineBus: GainNode
let ambBus: GainNode
let fxBus: GainNode
let intBus: GainNode
let whiteBuf: AudioBuffer
let brownBuf: AudioBuffer
let pinkBuf: AudioBuffer
let volume = 0.6
let enabled = false
const mix = { engines: 0.8, ambience: 0.5, effects: 0.7 }
export type MixKey = keyof typeof mix

export function audioState() {
  return { started: !!ctx, enabled, running: ctx?.state === 'running' }
}

function noiseBuffer(c: AudioContext, kind: 'white' | 'brown' | 'pink') {
  const len = c.sampleRate * 4
  const b = c.createBuffer(1, len, c.sampleRate)
  const d = b.getChannelData(0)
  let last = 0
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1
    if (kind === 'white') d[i] = w * 0.5
    else if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2 }
    else {
      // Paul Kellet's pink-noise filter
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11
      b6 = w * 0.115926
    }
  }
  // crossfade the loop seam to avoid a click
  const fade = Math.floor(c.sampleRate * 0.05)
  for (let i = 0; i < fade; i++) {
    const t = i / fade
    d[len - fade + i] = d[len - fade + i] * (1 - t) + d[i] * t
  }
  return b
}

function loopNoise(kind: 'white' | 'brown' | 'pink' = 'white', rate = 1) {
  const s = ctx!.createBufferSource()
  s.buffer = kind === 'white' ? whiteBuf : kind === 'brown' ? brownBuf : pinkBuf
  s.loop = true
  s.playbackRate.value = rate
  s.start(0, Math.random() * 3)
  return s
}

function osc(type: OscillatorType, freq: number) {
  const o = ctx!.createOscillator()
  o.type = type
  o.frequency.value = freq
  o.start()
  return o
}

function filter(type: BiquadFilterType, freq: number, q = 0.7) {
  const f = ctx!.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  return f
}

function gain(v = 0) {
  const g = ctx!.createGain()
  g.gain.value = v
  return g
}

function panner(ref: number) {
  const p = ctx!.createPanner()
  p.panningModel = 'equalpower'
  p.distanceModel = 'inverse'
  p.refDistance = ref
  p.rolloffFactor = 1.3
  p.maxDistance = 10000
  return p
}

const smooth = (p: AudioParam, v: number, t = 0.06) => p.setTargetAtTime(v, ctx!.currentTime, t)
const clampRate = (f: number) => Math.min(2, Math.max(0.5, f))

function setPannerPos(p: PannerNode, v: THREE.Vector3) {
  if (p.positionX) {
    p.positionX.value = v.x
    p.positionY.value = v.y
    p.positionZ.value = v.z
  } else (p as any).setPosition(v.x, v.y, v.z)
}

// ------------------------------------------------------------------ positional voices
abstract class Voice {
  out: GainNode
  pan: PannerNode
  pos = new THREE.Vector3()
  vel = new THREE.Vector3()
  private prev = new THREE.Vector3()
  private hasPrev = false
  constructor(ref: number, bus: AudioNode = engineBus) {
    this.out = gain(0)
    this.pan = panner(ref)
    this.out.connect(this.pan).connect(bus)
  }
  track(p: THREE.Vector3, visible: boolean, dt: number) {
    if (!visible) { this.hasPrev = false; return }
    if (this.hasPrev && dt > 0) {
      const v = new THREE.Vector3().subVectors(p, this.prev).divideScalar(dt)
      if (v.length() > 400) v.set(0, 0, 0)
      this.vel.lerp(v, Math.min(1, dt * 8))
    } else this.vel.set(0, 0, 0)
    this.prev.copy(p)
    this.hasPrev = true
    this.pos.copy(p)
    setPannerPos(this.pan, p)
  }
  dispose() {
    try { this.out.disconnect(); this.pan.disconnect() } catch { /* ignore */ }
  }
}

/**
 * Twin-ion-engine fighter: a resonant, howling rush of air.
 *  - roar: pink noise through a moderate band-pass (the body of the engine)
 *  - howl: white noise through a narrow resonant band — a wind-like whistling scream, not a buzz
 *  - cry: a soft low-passed triangle with gentle vibrato that only comes forward on a close pass
 * Everything is Doppler-shifted; far away it is little more than a distant rush.
 */
class TieVoice extends Voice {
  private roar: AudioBufferSourceNode; private roarF: BiquadFilterNode
  private howlSrc: AudioBufferSourceNode; private howlF: BiquadFilterNode; private howlF2: BiquadFilterNode
  private cry: OscillatorNode; private cryG: GainNode; private howlG: GainNode; private roarG: GainNode
  constructor() {
    super(30)
    this.roar = loopNoise('pink')
    this.roarF = filter('bandpass', 700, 0.9)
    this.roarG = gain(0)
    this.roar.connect(this.roarF).connect(this.roarG)
    this.howlSrc = loopNoise('white')
    this.howlF = filter('bandpass', 1500, 9)
    this.howlF2 = filter('bandpass', 1500, 9) // cascaded → a clear, airy whistle
    this.howlG = gain(0)
    this.howlSrc.connect(this.howlF).connect(this.howlF2).connect(this.howlG)
    this.cry = osc('triangle', 640)
    const vib = osc('sine', 5.2)
    const vibDepth = gain(7)
    vib.connect(vibDepth).connect(this.cry.frequency)
    this.cryG = gain(0)
    this.cry.connect(filter('lowpass', 1400, 0.5)).connect(this.cryG)
    const sum = gain(1)
    this.roarG.connect(sum); this.howlG.connect(sum); this.cryG.connect(sum)
    sum.connect(this.out)
  }
  update(thrust: number, visible: boolean, f: number, dist: number) {
    const near = proximity(dist, 160)
    smooth(this.roarF.frequency, 700 * f)
    smooth(this.roar.playbackRate, clampRate(f))
    smooth(this.howlF.frequency, 1500 * f * (0.95 + thrust * 0.1))
    smooth(this.howlF2.frequency, 1500 * f * (0.95 + thrust * 0.1))
    smooth(this.howlSrc.playbackRate, clampRate(f))
    smooth(this.cry.frequency, 640 * f)
    smooth(this.roarG.gain, 0.9)
    smooth(this.howlG.gain, 6 + 10 * near) // narrow band-pass removes most energy; compensate
    smooth(this.cryG.gain, 0.12 * near)
    // audible range ~2 km; beyond that fade out entirely
    const range = dist < 2200 ? 1 : 0
    smooth(this.out.gain, visible ? range * (0.35 + 0.65 * thrust) : 0, 0.2)
  }
}

/** Starfighter: a deeper, smoother jet roar with a soft high whistle. */
class XWingVoice extends Voice {
  private roar: AudioBufferSourceNode; private roarF: BiquadFilterNode
  private whistle: AudioBufferSourceNode; private wF: BiquadFilterNode; private wG: GainNode
  private body: AudioBufferSourceNode; private bodyF: BiquadFilterNode
  constructor() {
    super(40)
    this.roar = loopNoise('pink')
    this.roarF = filter('bandpass', 1000, 0.7)
    const rg = gain(1)
    this.roar.connect(this.roarF).connect(rg)
    this.body = loopNoise('brown')
    this.bodyF = filter('lowpass', 380, 0.7)
    const bg = gain(0.8)
    this.body.connect(this.bodyF).connect(bg)
    this.whistle = loopNoise('white')
    this.wF = filter('bandpass', 2600, 14)
    this.wG = gain(0)
    this.whistle.connect(this.wF).connect(this.wG)
    const sum = gain(1)
    rg.connect(sum); bg.connect(sum); this.wG.connect(sum)
    sum.connect(this.out)
  }
  update(_thrust: number, visible: boolean, f: number, dist: number) {
    const near = proximity(dist, 250)
    smooth(this.roarF.frequency, 1000 * f)
    smooth(this.bodyF.frequency, 380 * f)
    smooth(this.wF.frequency, 2600 * f)
    for (const s of [this.roar, this.body, this.whistle]) smooth(s.playbackRate, clampRate(f))
    smooth(this.wG.gain, 3 + 6 * near)
    smooth(this.out.gain, visible ? 1.2 : 0, 0.3)
  }
}

/**
 * Shuttle: a heavy, smooth drive — brown-noise rumble, a breathy mid layer and a gentle low
 * pulse. No buzzing oscillators: the "hum" is a pair of sines, low-passed and slowly swelling.
 */
class ShuttleVoice extends Voice {
  private rumble: AudioBufferSourceNode; private rumbleF: BiquadFilterNode
  private air: AudioBufferSourceNode; private airF: BiquadFilterNode; private airG: GainNode
  private s1: OscillatorNode; private s2: OscillatorNode; private humG: GainNode
  constructor() {
    super(50)
    this.rumble = loopNoise('brown')
    this.rumbleF = filter('lowpass', 150, 0.6)
    const rg = gain(1.3)
    this.rumble.connect(this.rumbleF).connect(rg)
    this.air = loopNoise('pink')
    this.airF = filter('bandpass', 420, 0.6)
    this.airG = gain(0)
    this.air.connect(this.airF).connect(this.airG)
    this.s1 = osc('sine', 46)
    this.s2 = osc('sine', 69)
    this.humG = gain(0.18)
    const s2g = gain(0.35)
    this.s1.connect(this.humG)
    this.s2.connect(s2g).connect(this.humG)
    const swell = osc('sine', 0.25)
    const swellDepth = gain(0.06)
    swell.connect(swellDepth).connect(this.humG.gain)
    const sum = gain(1)
    rg.connect(sum); this.airG.connect(sum); this.humG.connect(sum)
    sum.connect(filter('lowpass', 2500, 0.5)).connect(this.out)
  }
  update(thrust: number, visible: boolean, f: number) {
    smooth(this.rumbleF.frequency, (110 + thrust * 120) * f, 0.3)
    smooth(this.airF.frequency, (300 + thrust * 300) * f, 0.3)
    smooth(this.airG.gain, 0.15 + thrust * 0.5, 0.3)
    smooth(this.s1.frequency, (42 + thrust * 8) * f, 0.4)
    smooth(this.s2.frequency, (63 + thrust * 12) * f, 0.4)
    for (const s of [this.rumble, this.air]) smooth(s.playbackRate, clampRate(f))
    smooth(this.out.gain, visible ? 0.45 + thrust * 0.5 : 0, 0.5)
  }
  /** Positional one-shots at the shuttle: landing-gear servos, ramp hydraulics, touchdown. */
  oneShot(kind: 'gear' | 'ramp' | 'touchdown') {
    const t = ctx!.currentTime
    const g = gain(0)
    g.connect(this.pan)
    const fx = gain(mix.effects / Math.max(0.01, mix.engines)) // keep one-shots on the effects level
    g.disconnect()
    g.connect(fx).connect(this.pan)
    if (kind === 'gear') {
      // smooth servo: triangle sweep, low-passed
      const o = ctx!.createOscillator()
      o.type = 'triangle'
      o.frequency.setValueAtTime(180, t)
      o.frequency.linearRampToValueAtTime(320, t + 1.5)
      o.connect(filter('lowpass', 900, 0.7)).connect(g)
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.25, t + 0.2)
      g.gain.setValueAtTime(0.25, t + 1.4)
      g.gain.linearRampToValueAtTime(0, t + 1.7)
      const k = ctx!.createOscillator()
      k.frequency.setValueAtTime(110, t + 1.75)
      k.frequency.exponentialRampToValueAtTime(45, t + 2.05)
      const kg = gain(0)
      kg.gain.setValueAtTime(0.7, t + 1.75)
      kg.gain.exponentialRampToValueAtTime(0.001, t + 2.2)
      k.connect(kg).connect(fx)
      o.start(t); o.stop(t + 1.8); k.start(t + 1.75); k.stop(t + 2.3)
    } else if (kind === 'ramp') {
      const n = loopNoise('pink', 0.8)
      n.connect(filter('bandpass', 2200, 0.8)).connect(g)
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.5, t + 0.4)
      g.gain.setValueAtTime(0.5, t + 3.2)
      g.gain.linearRampToValueAtTime(0, t + 4)
      n.stop(t + 4.1)
    } else {
      const o = ctx!.createOscillator()
      o.frequency.setValueAtTime(70, t)
      o.frequency.exponentialRampToValueAtTime(32, t + 0.5)
      o.connect(g)
      const n = loopNoise('brown', 0.7)
      const ng = gain(0)
      ng.gain.setValueAtTime(1.4, t)
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.9)
      n.connect(filter('lowpass', 260)).connect(ng).connect(fx)
      g.gain.setValueAtTime(1.2, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.8)
      o.start(t); o.stop(t + 0.9); n.stop(t + 1)
    }
    window.setTimeout(() => { try { fx.disconnect() } catch { /* ignore */ } }, 5000)
  }
}

/** Hangar great doors: a deep rolling rumble while they move, a soft thud when they stop. */
class DoorVoice extends Voice {
  private moving = false
  constructor() {
    super(35, fxBus)
    const n = loopNoise('brown', 0.6)
    const mixG = gain(1.6)
    n.connect(filter('lowpass', 130, 0.8)).connect(mixG)
    mixG.connect(this.out)
    setPannerPos(this.pan, new THREE.Vector3(HANGAR_DOOR.x, 18, HANGAR_DOOR.z))
  }
  update(speed: number) {
    const moving = speed > 1e-4
    smooth(this.out.gain, moving ? 1 : 0, 0.3)
    if (this.moving && !moving) this.thud()
    this.moving = moving
  }
  private thud() {
    const t = ctx!.currentTime
    const o = ctx!.createOscillator()
    o.frequency.setValueAtTime(80, t)
    o.frequency.exponentialRampToValueAtTime(38, t + 0.35)
    const g = gain(0)
    g.gain.setValueAtTime(0.9, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5)
    o.connect(g).connect(this.pan)
    o.start(t); o.stop(t + 0.6)
  }
}

// ------------------------------------------------------------------ ambience + alerts
let interiorAir: GainNode | null = null
let interiorServers: GainNode | null = null

function buildAmbience() {
  // desert wind: brown + pink noise through a slowly wandering low-pass, plus soft gusts
  const wind = loopNoise('brown')
  const wf = filter('lowpass', 420, 0.5)
  const lfo = osc('sine', 0.06)
  const lfoDepth = gain(180)
  lfo.connect(lfoDepth).connect(wf.frequency)
  const wg = gain(0.5)
  wind.connect(wf).connect(wg).connect(ambBus)
  const gust = loopNoise('pink', 0.5)
  const gf = filter('bandpass', 600, 0.5)
  const gg = gain(0.04)
  const gl = osc('sine', 0.09)
  const gld = gain(0.04)
  gl.connect(gld).connect(gg.gain)
  gust.connect(gf).connect(gg).connect(ambBus)
}

function buildInteriorAmbience() {
  // air handling (soft broadband) + server-hall whoosh; no mains hum
  const air = loopNoise('pink', 0.7)
  interiorAir = gain(0)
  air.connect(filter('lowpass', 900, 0.5)).connect(interiorAir).connect(intBus)
  const srv = loopNoise('white', 0.9)
  interiorServers = gain(0)
  srv.connect(filter('bandpass', 1800, 0.6)).connect(interiorServers).connect(intBus)
}

/** Soft two-tone alert (unidentified contact). */
function alertTone() {
  const t0 = ctx!.currentTime
  const g = gain(0)
  g.connect(filter('lowpass', 1600, 0.5)).connect(fxBus)
  const o = ctx!.createOscillator()
  o.type = 'triangle'
  for (let i = 0; i < 4; i++) {
    const t = t0 + i * 0.7
    o.frequency.setValueAtTime(i % 2 ? 523 : 659, t)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.16, t + 0.06)
    g.gain.setValueAtTime(0.16, t + 0.5)
    g.gain.linearRampToValueAtTime(0.0001, t + 0.62)
  }
  o.connect(g)
  o.start(t0)
  o.stop(t0 + 3)
}

/** Explosion heard from `dist` metres: it arrives late (speed of sound) and duller the further away it is. */
function explosion(dist: number) {
  const t0 = ctx!.currentTime + Math.min(5, dist / SPEED_OF_SOUND)
  const level = Math.max(0.12, Math.min(1, 260 / Math.max(dist, 1)))
  const src = ctx!.createBufferSource()
  src.buffer = brownBuf
  const lp = filter('lowpass', Math.max(260, 2600 - dist * 1.4), 0.6)
  const g = gain(0)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(1.6 * level, t0 + 0.03)
  g.gain.exponentialRampToValueAtTime(0.4 * level, t0 + 0.5)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.6)
  src.connect(lp).connect(g).connect(fxBus)
  src.start(t0)
  src.stop(t0 + 3.8)
  const o = ctx!.createOscillator() // low thump
  o.type = 'sine'
  o.frequency.setValueAtTime(90, t0)
  o.frequency.exponentialRampToValueAtTime(28, t0 + 0.7)
  const og = gain(0)
  og.gain.setValueAtTime(0.0001, t0)
  og.gain.exponentialRampToValueAtTime(0.9 * level, t0 + 0.02)
  og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9)
  o.connect(og).connect(fxBus)
  o.start(t0)
  o.stop(t0 + 1)
}

/** A burst of cannon fire: short descending zaps. */
function cannonBurst(dist: number, seconds: number) {
  const t0 = ctx!.currentTime + Math.min(5, dist / SPEED_OF_SOUND)
  const level = Math.max(0.05, Math.min(0.5, 120 / Math.max(dist, 1)))
  const g = gain(0)
  g.connect(filter('bandpass', 1400, 0.8)).connect(fxBus)
  const o = ctx!.createOscillator()
  o.type = 'sawtooth'
  const shots = Math.max(1, Math.floor(seconds / 0.17))
  for (let i = 0; i < shots; i++) {
    const t = t0 + i * 0.17
    o.frequency.setValueAtTime(1900, t)
    o.frequency.exponentialRampToValueAtTime(340, t + 0.13)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(level, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14)
  }
  o.connect(g)
  o.start(t0)
  o.stop(t0 + shots * 0.17 + 0.1)
}

// ------------------------------------------------------------------ public API
let shuttle: ShuttleVoice
let freighter: ShuttleVoice
let ties: TieVoice[] = []
let interceptors: TieVoice[] = []
let xwing: XWingVoice
let door: DoorVoice
const lisPos = new THREE.Vector3()
const lisPrev = new THREE.Vector3()
const lisVel = new THREE.Vector3()
let lisHasPrev = false
let last = { gear: 0, ramp: 0, phase: 'away', xwing: false, door: 0, runaway: false, kills: 0, firing: false }

function start() {
  if (ctx) return
  const AC = window.AudioContext || (window as any).webkitAudioContext
  if (!AC) return
  ctx = new AC({ latencyHint: 'playback' })
  whiteBuf = noiseBuffer(ctx, 'white')
  brownBuf = noiseBuffer(ctx, 'brown')
  pinkBuf = noiseBuffer(ctx, 'pink')
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -18
  comp.knee.value = 12
  comp.ratio.value = 3
  master = gain(volume)
  master.connect(comp).connect(ctx.destination)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  comp.connect(analyser)
  const buf = new Float32Array(analyser.fftSize)
  ;(window as any).__imperialAudio = () => {
    analyser.getFloatTimeDomainData(buf)
    let sum = 0, peak = 0
    for (let i = 0; i < buf.length; i++) { sum += buf[i] * buf[i]; peak = Math.max(peak, Math.abs(buf[i])) }
    return { state: ctx!.state, enabled, level: Math.sqrt(sum / buf.length), peak }
  }
  extFilter = filter('lowpass', 20000, 0.5)
  extBus = gain(1)
  extBus.connect(extFilter).connect(master)
  engineBus = gain(mix.engines)
  engineBus.connect(extBus)
  ambBus = gain(mix.ambience)
  ambBus.connect(extBus)
  fxBus = gain(mix.effects)
  fxBus.connect(extBus)
  intBus = gain(mix.ambience)
  intBus.connect(master)
  buildAmbience()
  buildInteriorAmbience()
  shuttle = new ShuttleVoice()
  freighter = new ShuttleVoice()
  ties = sim.patrol.fighters.map(() => new TieVoice())
  interceptors = [new TieVoice(), new TieVoice()]
  xwing = new XWingVoice()
  door = new DoorVoice()
  last = { gear: sim.shuttle.state.gear, ramp: sim.shuttle.state.ramp, phase: sim.shuttle.phase, xwing: sim.xwing.active, door: sim.hangarDoor, runaway: sim.freighter.escaping, kills: sim.xwing.kills, firing: sim.xwing.firing }
  document.addEventListener('visibilitychange', () => {
    if (!ctx || !enabled) return
    if (document.hidden) ctx.suspend()
    else ctx.resume()
  })
}

/** Must be called from a user gesture the first time (browser autoplay policy). */
export function setSoundEnabled(on: boolean) {
  enabled = on
  if (on) {
    start()
    ctx?.resume()
  } else ctx?.suspend()
}

export function setVolume(v: number) {
  volume = v
  if (ctx) smooth(master.gain, v, 0.05)
}

export function setMix(k: MixKey, v: number) {
  mix[k] = v
  if (!ctx) return
  if (k === 'engines') smooth(engineBus.gain, v, 0.05)
  if (k === 'ambience') { smooth(ambBus.gain, v, 0.05); smooth(intBus.gain, v, 0.05) }
  if (k === 'effects') smooth(fxBus.gain, v, 0.05)
}

export type PreviewKind = 'tie' | 'shuttle' | 'xwing' | 'alert'

/**
 * Audition a sound in isolation, relative to the current listener:
 * TIE / X-wing fly past 40 m to your left→right at full speed; the shuttle throttles up and down nearby.
 */
export function preview(kind: PreviewKind) {
  if (!ctx || !enabled) return
  if (kind === 'alert') { alertTone(); return }
  const v = kind === 'tie' ? new TieVoice() : kind === 'xwing' ? new XWingVoice() : new ShuttleVoice()
  const t0 = performance.now()
  const dur = kind === 'shuttle' ? 8000 : 5000
  const speed = kind === 'tie' ? 150 : 170
  const base = lisPos.clone()
  const zero = new THREE.Vector3()
  let lastT = t0
  const timer = window.setInterval(() => {
    const now = performance.now()
    const t = (now - t0) / 1000
    const dt = (now - lastT) / 1000
    lastT = now
    if (kind === 'shuttle') {
      const p = base.clone().add(new THREE.Vector3(30, 8, -40))
      v.track(p, true, dt)
      const thrust = Math.sin(Math.min(1, t / (dur / 1000)) * Math.PI)
      ;(v as ShuttleVoice).update(thrust, true, 1)
    } else {
      const x = -speed * (dur / 2000) + speed * t
      const p = base.clone().add(new THREE.Vector3(x, 15, -40))
      v.track(p, true, dt)
      const f = dopplerFactor(v.pos, v.vel, lisPos, zero)
      ;(v as TieVoice | XWingVoice).update(0.9, true, f, v.pos.distanceTo(lisPos))
    }
    if (now - t0 > dur) {
      window.clearInterval(timer)
      smooth(v.out.gain, 0, 0.2)
      window.setTimeout(() => v.dispose(), 1500)
    }
  }, 30)
}

const _f = new THREE.Vector3()
const _u = new THREE.Vector3()

/** Per-frame update: listener = camera; voices follow the simulation. */
export function updateAudio(camera: THREE.Camera, dt: number, interior: string | null) {
  if (!ctx || !enabled || ctx.state !== 'running') return
  const L = ctx.listener
  const p = camera.getWorldPosition(lisPos)
  camera.getWorldDirection(_f)
  _u.set(0, 1, 0).applyQuaternion(camera.quaternion)
  if (L.positionX) {
    L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z
    L.forwardX.value = _f.x; L.forwardY.value = _f.y; L.forwardZ.value = _f.z
    L.upX.value = _u.x; L.upY.value = _u.y; L.upZ.value = _u.z
  } else {
    (L as any).setPosition(p.x, p.y, p.z)
    ;(L as any).setOrientation(_f.x, _f.y, _f.z, _u.x, _u.y, _u.z)
  }
  if (lisHasPrev && dt > 0) {
    const v = new THREE.Vector3().subVectors(p, lisPrev).divideScalar(dt)
    if (v.length() > 120) v.set(0, 0, 0) // camera cut / teleport
    lisVel.lerp(v, Math.min(1, dt * 6))
  }
  lisPrev.copy(p)
  lisHasPrev = true

  // buildings muffle the outside world
  const sealed = !!interior && interior !== 'command' && interior !== 'hangar'
  smooth(extFilter.frequency, sealed ? 400 : interior === 'command' ? 2000 : 20000, 0.3)
  smooth(extBus.gain, sealed ? 0.3 : interior === 'command' ? 0.55 : 1, 0.3)
  const indoors = !!interior && interior !== 'hangar'
  smooth(interiorAir!.gain, indoors ? 0.25 : 0, 0.6)
  smooth(interiorServers!.gain, interior === 'bunker' ? 0.05 : interior === 'research' ? 0.02 : 0, 0.6)

  // shuttle
  const s = sim.shuttle.state
  shuttle.track(s.pos, s.visible, dt)
  shuttle.update(s.thrust, s.visible, dopplerFactor(shuttle.pos, shuttle.vel, p, lisVel))
  if ((last.gear < 0.03 && s.gear >= 0.03) || (last.gear > 0.97 && s.gear <= 0.97)) shuttle.oneShot('gear')
  if ((last.ramp < 0.02 && s.ramp >= 0.02) || (last.ramp > 0.98 && s.ramp <= 0.98)) shuttle.oneShot('ramp')
  if (last.phase === 'descent' && s.phase === 'landed') shuttle.oneShot('touchdown')
  last.gear = s.gear
  last.ramp = s.ramp
  last.phase = s.phase

  // TIE patrols + interceptors
  sim.patrol.fighters.forEach((f, i) => {
    const v = ties[i]
    v.track(f.pose.pos, f.pose.visible, dt)
    v.update(f.thrust, f.pose.visible, dopplerFactor(v.pos, v.vel, p, lisVel), v.pos.distanceTo(p))
  })
  sim.xwing.interceptors.forEach((ip, i) => {
    const v = interceptors[i]
    v.track(ip.pos, ip.visible, dt)
    v.update(ip.thrust, ip.visible, dopplerFactor(v.pos, v.vel, p, lisVel), v.pos.distanceTo(p))
  })

  // X-wing flyby + alert
  const x = sim.xwing.pose
  xwing.track(x.pos, x.visible, dt)
  xwing.update(x.thrust, x.visible, dopplerFactor(xwing.pos, xwing.vel, p, lisVel), xwing.pos.distanceTo(p))
  if (!last.xwing && sim.xwing.active) alertTone()
  last.xwing = sim.xwing.active

  // the shoot-down: cannon fire, then the explosion (both arrive late with distance)
  if (!last.firing && sim.xwing.firing) cannonBurst(x.pos.distanceTo(p), (XWING_KILL.hit - XWING_KILL.fire) * XWING_TIMING.duration)
  last.firing = sim.xwing.firing
  if (sim.xwing.kills !== last.kills) { last.kills = sim.xwing.kills; explosion(sim.xwing.killPos.distanceTo(p)) }

  // impounded freighter: silent on the pad, engines from liftoff to touchdown
  const fr = sim.freighter.state
  const frOn = fr.visible && fr.thrust > 0.01
  freighter.track(fr.pos, frOn, dt)
  freighter.update(fr.thrust, frOn, dopplerFactor(freighter.pos, freighter.vel, p, lisVel))
  if (!last.runaway && sim.freighter.escaping) alertTone()
  last.runaway = sim.freighter.escaping

  // hangar doors
  door.update(Math.abs(sim.hangarDoor - last.door) / Math.max(dt, 1e-3))
  last.door = sim.hangarDoor
}

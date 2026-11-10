// Time-of-day lighting presets. One source of truth for sun, sky, fog, exposure, environment and
// emissive levels so the sky dome, the PMREM environment map and the lights always agree.
import * as THREE from 'three'
import type { TimeOfDay } from '../state/store'

export interface TodPreset {
  sunDir: THREE.Vector3
  sunColor: string
  sunIntensity: number
  hemiSky: string
  hemiGround: string
  hemiIntensity: number
  ambient: number
  fog: string
  fogDensity: number
  exposure: number
  envIntensity: number
  sky: { zenith: string; mid: string; horizon: string; ground: string; glow: string; glowStrength: number; disc: number; stars: number; cloud: number }
  /** emissive multipliers for window bands and lamps */
  windows: number
  lampPools: number
  /** colour grade */
  saturation: number
  contrast: number
  bloom: number
}

export const TOD: Record<TimeOfDay, TodPreset> = {
  golden: {
    sunDir: new THREE.Vector3(-0.62, 0.3, -0.74).normalize(),
    sunColor: '#ffdcb6', sunIntensity: 3.3,
    hemiSky: '#b2c4da', hemiGround: '#6e5845', hemiIntensity: 0.8, ambient: 0.06,
    fog: '#c99d78', fogDensity: 0.000165, exposure: 1.08, envIntensity: 0.75,
    sky: { zenith: '#21334f', mid: '#8c7a6c', horizon: '#ebab76', ground: '#c49a78', glow: '#ffb86b', glowStrength: 0.6, disc: 6, stars: 0, cloud: 0.12 },
    windows: 1.4, lampPools: 0, saturation: -0.04, contrast: 0.1, bloom: 0.5,
  },
  dusk: {
    sunDir: new THREE.Vector3(-0.66, 0.07, -0.75).normalize(),
    sunColor: '#ff8a4c', sunIntensity: 1.7,
    hemiSky: '#6c78a0', hemiGround: '#4a3428', hemiIntensity: 0.55, ambient: 0.05,
    fog: '#8e6656', fogDensity: 0.00019, exposure: 1.15, envIntensity: 0.55,
    sky: { zenith: '#151d3a', mid: '#5e4b5c', horizon: '#f08a52', ground: '#6e4e44', glow: '#ff7a3c', glowStrength: 0.9, disc: 5, stars: 0.25, cloud: 0.16 },
    windows: 2.4, lampPools: 0.55, saturation: 0.12, contrast: 0.1, bloom: 0.8,
  },
  night: {
    // the "sun" becomes a cold moon high in the south-west sky
    sunDir: new THREE.Vector3(0.45, 0.62, 0.64).normalize(),
    sunColor: '#a9bfe8', sunIntensity: 1.1,
    hemiSky: '#3c4d80', hemiGround: '#221c1a', hemiIntensity: 0.75, ambient: 0.06,
    fog: '#1c2334', fogDensity: 0.0002, exposure: 1.55, envIntensity: 0.7,
    sky: { zenith: '#040812', mid: '#101a30', horizon: '#2a3552', ground: '#16141a', glow: '#8fb0ff', glowStrength: 0.3, disc: 2.2, stars: 1, cloud: 0.05 },
    windows: 3.2, lampPools: 1, saturation: 0.02, contrast: 0.12, bloom: 1.0,
  },
}

/** Secondary (companion) sun direction, used by the sky dome only. */
export const SUN2_DIR = new THREE.Vector3(-0.35, 0.16, -0.92).normalize()

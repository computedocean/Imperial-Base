// Shared world materials (lazy singletons). Consistent art direction: gunmetal, concrete,
// warm window light, red/amber warning lights, restrained blue holograms.
import * as THREE from 'three'
import { concreteTexture, detailNormal, panelTexture, windowTexture } from './textures'

function lazy<T>(f: () => T) {
  let v: T | undefined
  return () => (v ??= f())
}

export const MAT = {
  // panel materials carry a normal map derived from the same plating pixels, so seams recess and plates catch the light
  hull: lazy(() => new THREE.MeshStandardMaterial({ color: '#e4e8ec', map: panelTexture('hull'), normalMap: detailNormal('hull'), normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.58, metalness: 0.25 })),
  dark: lazy(() => new THREE.MeshStandardMaterial({ color: '#c4cad0', map: panelTexture('dark'), normalMap: detailNormal('dark'), normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.5, metalness: 0.35 })),
  light: lazy(() => new THREE.MeshStandardMaterial({ color: '#f0f2f4', map: panelTexture('light'), normalMap: detailNormal('light'), normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.5, metalness: 0.18 })),
  black: lazy(() => new THREE.MeshStandardMaterial({ color: '#202328', roughness: 0.5, metalness: 0.4 })),
  concrete: lazy(() => new THREE.MeshStandardMaterial({ color: '#b8b0a4', map: concreteTexture(), normalMap: detailNormal('concrete', 1.6), normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.92, metalness: 0.02 })),
  glassClear: lazy(() => new THREE.MeshStandardMaterial({ color: '#9cc4e0', roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.18, depthWrite: false })),
  glass: lazy(() => new THREE.MeshStandardMaterial({ color: '#0d1620', roughness: 0.08, metalness: 0.9 })),
  windows: lazy(() => new THREE.MeshStandardMaterial({ color: '#111', emissive: '#ffcf96', emissiveIntensity: 1.6, emissiveMap: windowTexture(), roughness: 0.3, metalness: 0.5 })),
  red: lazy(() => new THREE.MeshStandardMaterial({ color: '#300', emissive: '#ff2a1a', emissiveIntensity: 4, toneMapped: false })),
  amber: lazy(() => new THREE.MeshStandardMaterial({ color: '#310', emissive: '#ffa22a', emissiveIntensity: 3, toneMapped: false })),
  holo: lazy(() => new THREE.MeshStandardMaterial({ color: '#012', emissive: '#4cb8ff', emissiveIntensity: 2.2, transparent: true, opacity: 0.75, toneMapped: false, depthWrite: false })),
  whiteLight: lazy(() => new THREE.MeshStandardMaterial({ color: '#222', emissive: '#e8f2ff', emissiveIntensity: 3, toneMapped: false })),
  stripe: lazy(() => new THREE.MeshStandardMaterial({ color: '#c9a136', roughness: 0.6, metalness: 0.2 })),
  rust: lazy(() => new THREE.MeshStandardMaterial({ color: '#7a5a44', roughness: 0.85, metalness: 0.3 })),
  sand: lazy(() => new THREE.MeshStandardMaterial({ color: '#a77d5a', roughness: 1, metalness: 0 })),
}

export type MatKey = keyof typeof MAT

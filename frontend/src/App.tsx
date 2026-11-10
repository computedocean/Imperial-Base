import { Canvas } from '@react-three/fiber'
import { Suspense, useEffect } from 'react'
import * as THREE from 'three'
import { Scene } from './Scene'
import { HUD } from './ui/HUD'
import { connectLive } from './lib/ws'
import { useSoundBootstrap } from './audio/AudioLayer'
import { commands, sim } from './sim/world'
import { QUALITY, useStore } from './state/store'

// QA handle (same spirit as window.__imperialStats): drive the camera and the simulation from the console
;(window as any).__imperial = { store: useStore, sim, commands }

export default function App() {
  const quality = useStore((s) => s.quality)
  const q = QUALITY[quality]
  useEffect(() => connectLive(), [])
  useSoundBootstrap()
  useEffect(() => {
    // the base is alive on arrival: patrols airborne, a shuttle on approach shortly after load
    commands.startPatrol(true)
    const t = window.setTimeout(() => commands.shuttleArrive(), 4000)
    // the intruder attacks a minute in, then returns every few minutes
    const x = window.setTimeout(() => commands.xwingFlyby(), 60000)
    const again = window.setInterval(() => commands.xwingFlyby(), 240000)
    return () => { window.clearTimeout(t); window.clearTimeout(x); window.clearInterval(again) }
  }, [])
  return (
    <div className="app">
      <Canvas
        key={`${quality}`}
        shadows={q.shadows ? { type: THREE.PCFShadowMap } : false}
        dpr={Math.min(q.dpr, window.devicePixelRatio || 1) * (quality === 'cinematic' ? 1.25 : 1)}
        gl={{ antialias: q.antialias, logarithmicDepthBuffer: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
        camera={{ fov: 55, near: 0.3, far: 40000, position: [620, 330, 760] }}
        onPointerMissed={() => useStore.getState().select(null)}
      >
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>
      <HUD />
    </div>
  )
}

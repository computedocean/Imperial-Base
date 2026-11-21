import { Canvas } from '@react-three/fiber'
import { Suspense, useEffect } from 'react'
import * as THREE from 'three'
import { Scene } from './Scene'
import { HUD } from './ui/HUD'
import { connectLive } from './lib/ws'
import { useCases } from './lib/cases'
import { demoData, isDemoUrl } from './lib/demo'
import { useSoundBootstrap } from './audio/AudioLayer'
import { commands, sim } from './sim/world'
import { QUALITY, useStore } from './state/store'

// QA handle (same spirit as window.__imperialStats): drive the camera and the simulation from the console
;(window as any).__imperial = { store: useStore, sim, commands }

// Demo mode (?demo=1): fictional, clearly labelled data and no live link, so demo and real records never mix.
const DEMO = isDemoUrl(location.search)
// The demo case book is separate from the real one (its own storage key), and is chosen before anything reads it.
if (DEMO) { useStore.getState().setDemo(true); useCases.getState().useBook(true) }

let demoLoaded = false
function loadDemo() {
  if (demoLoaded) return // StrictMode runs effects twice in development
  demoLoaded = true
  const d = demoData(Date.now() / 1000)
  const st = useStore.getState()
  st.applySnapshot({ agents: d.agents, tasks: d.tasks, events: d.events })
  st.setSystem(d.system)
  st.setOrders(d.ordersInfo, [])
  st.pushFeed('Cmdr. Dellan-18 completed a turn (demo)', 'ok', 'agent', 'session:demo-c1')
  st.pushFeed('Lt. Tessic-57 FAILED: test run exceeded the time limit (demo)', 'alert', 'agent', 'agent:demo-t1')
  st.pushFeed('Lt. Varrin-22 deployed to security (demo)', 'ok', 'agent', 'agent:demo-r1')
  st.pushFeed('Cmdr. Mavek-33 awaits your authorisation: Bash (demo)', 'warn', 'agent', 'session:demo-b1')
}

export default function App() {
  const quality = useStore((s) => s.quality)
  const q = QUALITY[quality]
  useEffect(() => (DEMO ? loadDemo() : connectLive()), [])
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
        gl={{ antialias: q.antialias, logarithmicDepthBuffer: true, powerPreference: 'high-performance', toneMapping: THREE.AgXToneMapping, toneMappingExposure: 1.05 }}
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

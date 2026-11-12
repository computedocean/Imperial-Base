import { useFrame, useThree } from '@react-three/fiber'
import { Suspense, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { AircraftLayer } from './aircraft/AircraftLayer'
import { AgentLayer } from './agents/AgentLayer'
import { AudioLayer } from './audio/AudioLayer'
import { CameraRig } from './camera/CameraRig'
import { ActiveInterior } from './interiors/Interiors'
import { Crowd, type CrowdMember } from './personnel/Crowd'
import { Duel } from './personnel/Duel'
import { March } from './personnel/March'
import { Runners } from './personnel/Runners'
import { createCrowdSim } from './personnel/sim'
import { publishSim, sim, stepSim } from './sim/world'
import { QUALITY, useStore } from './state/store'
import { Sky } from './world/Sky'
import { Apron } from './world/Apron'
import { DesertRocks, Mesas } from './world/Desert'
import { FuelDump } from './world/FuelDump'
import { GroundFx } from './world/GroundFx'
import { Temple } from './world/Temple'
import { WorldRendering } from './world/Rendering'
import { Structures } from './world/Structures'
import { BeaconBlink, Dust, Roads, Settlements } from './world/Surroundings'
import { Terrain } from './world/Terrain'
import { RoadProps } from './vehicles/RoadProps'
import { VehicleLayer } from './vehicles/VehicleLayer'
import { Walker } from './vehicles/Walker'
import { PADS } from './world/layout'

/** Publishes renderer statistics on window.__imperialStats (used by QA + the PERFORMANCE report). */
function Stats() {
  const acc = useRef({ t: 0, frames: 0 })
  // count every pass of a frame (shadow maps, scene, post) — the composer issues several gl.render calls
  const last = useRef({ calls: 0, triangles: 0 })
  useFrame(({ gl }) => {
    gl.info.autoReset = false
    last.current = { calls: gl.info.render.calls, triangles: gl.info.render.triangles } // totals of the previous frame
    gl.info.reset()
  }, -1000)
  useFrame(({ gl, scene, camera }, dt) => {
    const w = window as any
    if (w.__imperial && w.__imperial.scene !== scene) { w.__imperial.scene = scene; w.__imperial.camera = camera } // QA handle
    const a = acc.current
    a.t += dt
    a.frames++
    if (a.t >= 1) {
      ;(window as any).__imperialStats = {
        fps: Math.round(a.frames / a.t), calls: last.current.calls, triangles: last.current.triangles,
        geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, programs: gl.info.programs?.length,
        heapMB: (performance as any).memory ? Math.round((performance as any).memory.usedJSHeapSize / 1e6) : null,
      }
      a.t = 0
      a.frames = 0
    }
  })
  return null
}

function SimDriver() {
  useFrame((_, dt) => {
    stepSim(dt)
    publishSim(dt)
  }, -1)
  return null
}

function Personnel({ count }: { count: number }) {
  const crowd = useMemo(() => createCrowdSim({ count, seed: 1977 }), [count])
  const members = useRef<CrowdMember[]>(crowd.members)
  members.current = crowd.members
  useFrame((_, dt) => {
    const s = sim.shuttle.state
    crowd.update(Math.min(dt, 0.1), { shuttleLanded: s.phase === 'landed', shuttlePad: s.phase === 'landed' ? PADS[0] : null })
  })
  return <Crowd members={members} capacity={count} />
}

export function Scene() {
  const quality = useStore((s) => s.quality)
  const interior = useStore((s) => s.interior)
  const q = QUALITY[quality]
  const sealed = !!interior && interior !== 'command' && interior !== 'hangar'
  return (
    <>
      <WorldRendering />
      <SimDriver />
      <Stats />
      <AudioLayer />
      <BeaconBlink />
      <group visible={!sealed}>
        <Sky />
        <Terrain segments={q.terrainSegments} />
        <Apron />
        <Roads terrainSegments={q.terrainSegments} />
        <Settlements terrainSegments={q.terrainSegments} />
        <DesertRocks count={quality === 'low' ? 150 : 450} />
        <Mesas />
        <Dust count={q.dust} />
        {q.dust > 0 && <GroundFx />}
        <RoadProps />
      </group>
      <VehicleLayer visible={!sealed} />
      <Walker visible={!sealed} />
      <FuelDump visible={!sealed} />
      <Temple visible={!sealed} />
      <Duel visible={!sealed} />
      <Runners visible={!sealed} />
      <March visible={!sealed} />
      <Structures hidden={interior} />
      <Suspense fallback={null}>
        <AircraftLayer />
      </Suspense>
      {!sealed && <Personnel count={q.crowd} />}
      <AgentLayer />
      <ActiveInterior />
      <CameraRig />
    </>
  )
}

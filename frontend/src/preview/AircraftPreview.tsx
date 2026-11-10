/**
 * Dev preview: ?preview=aircraft
 * Optional URL params for screenshots: focus=all|shuttle|tie|xwing,
 * wingFold, gear, ramp, sFoil, thrust (0..1), az (deg), el (deg), dist (m),
 * only=shuttle|tie|xwing (single model), shadows=0.
 */
import { useEffect, useRef, useState } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Freighter } from '../aircraft/models/Freighter'
import { Shuttle } from '../aircraft/models/Shuttle'
import { TieFighter } from '../aircraft/models/TieFighter'
import { XWing } from '../aircraft/models/XWing'

const q = new URLSearchParams(location.search)
const only = q.get('only') // render just one model (for draw-call counts)
const show = (name: string) => !only || only === name
const useShadows = q.get('shadows') !== '0'
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d)

const FOCI: Record<string, { target: [number, number, number]; dist: number }> = {
  all: { target: [0, 6, 0], dist: 58 },
  shuttle: { target: [-20, 8, 0], dist: 36 },
  tie: { target: [2, 4.2, 0], dist: 13 },
  xwing: { target: [18, 3, 0], dist: 17 },
  freighter: { target: [0, 4.3, 40], dist: 46 },
}

function Stats({ out }: { out: React.RefObject<HTMLDivElement | null> }) {
  const gl = useThree((s) => s.gl)
  const last = useRef(0)
  useFrame(({ clock }) => {
    if (clock.elapsedTime - last.current < 0.5 || !out.current) return
    last.current = clock.elapsedTime
    const i = gl.info.render
    out.current.textContent = `draw calls ${i.calls} · tris ${i.triangles.toLocaleString()}`
  })
  return null
}

const SLIDERS = ['wingFold', 'gear', 'ramp', 'sFoil', 'thrust'] as const
type Key = (typeof SLIDERS)[number]

export default function AircraftPreview() {
  const [v, setV] = useState<Record<Key, number>>({
    wingFold: num('wingFold', 1), gear: num('gear', 1), ramp: num('ramp', 0.6),
    sFoil: num('sFoil', 1), thrust: num('thrust', 0.6),
  })
  const stats = useRef<HTMLDivElement>(null)
  const focus = FOCI[q.get('focus') ?? 'all'] ?? FOCI.all
  const az = (num('az', 35) * Math.PI) / 180
  const el = (num('el', 18) * Math.PI) / 180
  const dist = num('dist', focus.dist)
  const t = focus.target
  const camPos: [number, number, number] = [
    t[0] + Math.sin(az) * Math.cos(el) * dist,
    t[1] + Math.sin(el) * dist,
    t[2] + Math.cos(az) * Math.cos(el) * dist,
  ]
  useEffect(() => { document.title = 'Aircraft preview' }, [])

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Canvas shadows={useShadows} camera={{ position: camPos, fov: 45, near: 0.1, far: 2000 }} dpr={[1, 1.5]}>
        <color attach="background" args={['#1b2330']} />
        <fog attach="fog" args={['#1b2330', 120, 600]} />
        <hemisphereLight args={['#b9c7da', '#3a3530', 1.1]} />
        <directionalLight
          position={[40, 60, 30]} intensity={2.4} castShadow
          shadow-mapSize={[2048, 2048]} shadow-camera-left={-45} shadow-camera-right={45}
          shadow-camera-top={45} shadow-camera-bottom={-45} shadow-bias={-0.0004}
        />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[600, 600]} />
          <meshStandardMaterial color="#4a4d52" roughness={0.9} metalness={0.1} />
        </mesh>
        {!only && <gridHelper args={[200, 40, '#5b6068', '#52565c']} position={[0, 0.01, 0]} />}

        {show('shuttle') && <Shuttle position={[-20, 0, 0]} wingFold={v.wingFold} gear={v.gear} ramp={v.ramp} thrust={v.thrust} />}
        {show('tie') && <TieFighter position={[2, 4.2, 0]} thrust={v.thrust} />}
        {show('xwing') && <XWing position={[18, 3, 0]} sFoil={v.sFoil} thrust={v.thrust} />}
        {show('freighter') && <Freighter position={[0, 4.3, 40]} gear={v.gear} thrust={v.thrust} />}

        <OrbitControls target={t} makeDefault />
        <Stats out={stats} />
      </Canvas>
      <div style={{
        position: 'absolute', top: 12, left: 12, padding: '10px 14px', background: 'rgba(10,14,20,0.78)',
        border: '1px solid #2c3644', borderRadius: 6, fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#c9d4e2',
        display: 'grid', gridTemplateColumns: 'auto 160px 36px', gap: '6px 10px', alignItems: 'center',
      }}>
        {SLIDERS.map((k) => (
          <label key={k} style={{ display: 'contents' }}>
            <span>{k}</span>
            <input type="range" min={0} max={1} step={0.01} value={v[k]}
              onChange={(e) => setV((s) => ({ ...s, [k]: Number(e.target.value) }))} />
            <span>{v[k].toFixed(2)}</span>
          </label>
        ))}
        <div ref={stats} style={{ gridColumn: '1 / -1', opacity: 0.7 }} />
      </div>
    </div>
  )
}

import { Text } from '@react-three/drei'
import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import type { SystemInfo } from '../state/types'

/** Wall display of REAL host telemetry from the backend (psutil / nvidia-smi / docker ps). */
export function SystemWall({ position, rotationY = 0, compact = false }: { position: [number, number, number]; rotationY?: number; compact?: boolean }) {
  const live = useStore((s) => s.system)
  const [docker, setDocker] = useState<SystemInfo['docker'] | null>(null)
  useEffect(() => {
    let alive = true
    fetch('/api/system').then((r) => r.json()).then((d) => alive && setDocker(d.docker)).catch(() => {})
    return () => { alive = false }
  }, [])
  const lines: string[] = []
  if (!live) lines.push('TELEMETRY LINK DOWN — backend not connected')
  else {
    lines.push(`CPU ${live.cpu_pct?.toFixed(0) ?? '?'}%  ·  ${live.cpu_count ?? '?'} cores`)
    lines.push(`MEMORY ${live.mem_used_gb ?? '?'} / ${live.mem_total_gb ?? '?'} GB  (${live.mem_pct ?? '?'}%)`)
    lines.push(live.gpu?.available ? live.gpu.gpus!.map((g) => `GPU ${g.name} ${g.util_pct}%`).join('  ') : `GPU: ${live.gpu?.reason ?? 'unavailable'}`)
    if (live.claude_processes != null) lines.push(`CLAUDE PROCESSES: ${live.claude_processes}`)
    if (!compact) {
      if (docker?.available) lines.push(`DOCKER: ${docker.containers?.length ?? 0} running` + (docker.containers?.length ? ` — ${docker.containers.slice(0, 3).map((c) => c.name).join(', ')}` : ''))
      else lines.push(`DOCKER: ${docker?.reason ?? 'checking…'}`)
    }
  }
  const cpu = live?.cpu_pct ?? 0
  const mem = live?.mem_pct ?? 0
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, 2.4, -0.05]}>
        <planeGeometry args={[18, 5.6]} />
        <meshBasicMaterial color="#04121e" transparent opacity={0.92} />
      </mesh>
      <Text position={[-8.4, 4.6, 0]} fontSize={0.55} color="#7a9cff" anchorX="left" letterSpacing={0.12}>
        {compact ? 'LOCAL COMPUTE — HOST TELEMETRY (LIVE)' : 'HARDWARE STATUS — HOST TELEMETRY (LIVE)'}
      </Text>
      {lines.map((l, i) => (
        <Text key={i} position={[-8.4, 3.7 - i * 0.62, 0]} fontSize={0.42} color="#cfe3ff" anchorX="left">{l}</Text>
      ))}
      {[cpu, mem].map((v, i) => (
        <group key={i} position={[4, 3.6 - i * 0.62, 0]}>
          <mesh position={[2, 0, 0]}><planeGeometry args={[4, 0.3]} /><meshBasicMaterial color="#10283d" /></mesh>
          <mesh position={[(4 * v) / 200, 0, 0.01]}><planeGeometry args={[(4 * v) / 100 || 0.001, 0.3]} /><meshBasicMaterial color={v > 85 ? '#ff4a3d' : v > 65 ? '#ffb02e' : '#47d16c'} toneMapped={false} /></mesh>
        </group>
      ))}
    </group>
  )
}

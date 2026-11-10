import { useMemo, useRef } from 'react'
import { Crowd, type CrowdMember, type PersonnelVariant } from '../personnel/Crowd'
import { rng } from '../world/noise'
import { INTERIORS } from './layouts'
import { useStore } from '../state/store'
import type { DepartmentId } from '../world/layout'

// Decorative (simulated) crew for the active interior. They occupy a subset of stations
// and never wear the live-agent uniform/ring, so they cannot be confused with real agents.
const CREW: Partial<Record<DepartmentId, PersonnelVariant[]>> = {
  command: ['officer', 'officer', 'analyst', 'technician'],
  engineering: ['engineer', 'technician', 'engineer'],
  intelligence: ['analyst', 'officer', 'analyst'],
  operations: ['officer', 'analyst', 'technician'],
  research: ['scientist', 'scientist', 'technician'],
  security: ['trooper', 'officer', 'technician'],
  bunker: ['technician', 'engineer'],
}

export function InteriorCrew() {
  const interior = useStore((s) => s.interior)
  const members = useRef<CrowdMember[]>([])
  members.current = useMemo(() => {
    const l = interior ? INTERIORS[interior] : undefined
    if (!l) return []
    const r = rng(l.id.length * 977)
    const variants = CREW[l.id] ?? ['officer']
    const out: CrowdMember[] = []
    // take every third station so live agents keep plenty of free posts
    l.stations.forEach((s, i) => {
      if (i % 3 !== 1 || s.type === 'briefing') return
      const holo = s.type === 'holotable'
      const ang = r() * Math.PI * 2
      const x = holo ? s.x + Math.cos(ang) * 4.2 : s.x + Math.sin(s.rot) * 1.1
      const z = holo ? s.z + Math.sin(ang) * 4.2 : s.z + Math.cos(s.rot) * 1.1
      out.push({
        x: l.origin[0] + x, y: l.origin[1], z: l.origin[2] + z,
        heading: holo ? Math.atan2(-Math.cos(ang), -Math.sin(ang)) : s.rot + Math.PI,
        speed: 0, action: s.type === 'security' || r() > 0.25 ? 'work' : 'talk',
        variant: variants[i % variants.length], phase: r() * 10, visible: true,
      })
    })
    // a sentry at the entry
    out.push({ x: l.origin[0] + l.entry[0] * 0.85 + 2, y: l.origin[1], z: l.origin[2] + l.entry[1] * 0.85 + 2, heading: Math.atan2(-l.entry[0], -l.entry[1]), speed: 0, action: 'guard', variant: 'trooper', phase: 3, visible: true })
    return out
  }, [interior])
  if (!interior || !members.current.length) return null
  return <Crowd key={interior} members={members} capacity={members.current.length} />
}

// Shared building blocks for the command interface: formatting, ticks, filter chips, empty states, stat tiles.
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import { STATUS_COLOR } from '../agents/AgentLayer'
import type { AgentInfo } from '../state/types'
import { stepIndex } from '../lib/search'
import { IconSearch } from './icons'

export const ago = (ts: number) => {
  const s = Math.max(0, Date.now() / 1000 - ts)
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
export const dur = (s: number) => (s < 60 ? `${s.toFixed(0)}s` : s < 3600 ? `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`)
export const fmtTokens = (n?: number) => (n == null ? '—' : n > 1e6 ? `${(n / 1e6).toFixed(2)}M` : n > 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`)
export const clock = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })

export function useTick(ms = 1000) {
  const [, set] = useState(0)
  useEffect(() => { const t = setInterval(() => set((x) => x + 1), ms); return () => clearInterval(t) }, [ms])
}

/** Enter or Space activates a non-button element that behaves like one. */
export const activate = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn() }
}

export function SearchField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="search">
      <IconSearch size={14} />
      <input type="search" value={value} placeholder={label} aria-label={label} spellCheck={false} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
    </div>
  )
}

const BUSY = new Set<AgentInfo['status']>(['working', 'delegating'])
export function StatusDot({ s }: { s: AgentInfo['status'] }) {
  return <span className={`dot ${BUSY.has(s) ? 'pulse' : ''}`} style={{ background: STATUS_COLOR[s], color: STATUS_COLOR[s] }} aria-hidden="true" />
}

/** A single-choice filter strip (a radio group drawn as segmented chips), arrow keys move the choice. */
export function Chips<T extends string>({ value, options, onChange, label, size = 'sm' }: { value: T; options: readonly (readonly [T, string, number?])[]; onChange: (v: T) => void; label: string; size?: 'sm' | 'md' }) {
  const idx = options.findIndex((o) => o[0] === value)
  return (
    <div className={`chips ${size}`} role="radiogroup" aria-label={label}
      onKeyDown={(e) => {
        const n = stepIndex(idx, e.key, options.length, 'horizontal')
        if (n !== idx && n >= 0) { e.preventDefault(); onChange(options[n][0]); (e.currentTarget.children[n] as HTMLElement)?.focus() }
      }}>
      {options.map(([id, text, count]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} tabIndex={value === id ? 0 : -1} className={value === id ? 'on' : ''} onClick={() => onChange(id)}>
          {text}{count !== undefined && <span className="count">{count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Empty({ title, children, tone }: { title: string; children?: ReactNode; tone?: 'warn' | 'bad' }) {
  return (
    <div className={`empty ${tone ?? ''}`} role="status">
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  )
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return <div className="skeleton" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <span key={i} style={{ width: `${88 - i * 14}%` }} />)}</div>
}

export function SectionHead({ title, meta, children }: { title: string; meta?: ReactNode; children?: ReactNode }) {
  return (
    <div className="sec-head">
      <h3>{title}</h3>
      {meta && <span className="sec-meta">{meta}</span>}
      {children && <div className="sec-actions">{children}</div>}
    </div>
  )
}

/** Small source label: LIVE (from hook events), SIM (scenery) or DEMO (fictional sample). */
export function SourceTag({ kind }: { kind: 'live' | 'sim' | 'demo' | 'local' }) {
  const text = { live: 'LIVE', sim: 'SIM', demo: 'DEMO', local: 'THIS BROWSER' }[kind]
  const title = {
    live: 'From Claude Code hook events recorded by the base',
    sim: 'Environmental simulation: scenery, not real telemetry',
    demo: 'Fictional demo data, not live telemetry',
    local: 'Kept in this browser only; never sent to the base',
  }[kind]
  return <span className={`src-tag ${kind}`} title={title}>{text}</span>
}

/** The installation's mark: an original geometric crest (hexagon, chevrons, slit). */
export function Crest({ size = 30 }: { size?: number }) {
  return (
    <svg className="crest" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M16 1.5l12.6 7.25v14.5L16 30.5 3.4 23.25V8.75z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M16 6.5l8.2 4.75v9.5L16 25.5l-8.2-4.75v-9.5z" fill="none" stroke="currentColor" strokeWidth="1" opacity=".55" />
      <path d="M10 13l6 3.4 6-3.4M10 17.6l6 3.4 6-3.4" fill="none" stroke="var(--crimson-hi)" strokeWidth="1.6" strokeLinejoin="miter" />
      <path d="M16 6.5v5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

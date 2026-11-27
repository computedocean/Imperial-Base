// Command search (Ctrl+K or /): one ranked list of agents, missions, facilities, panels, camera modes, tours and actions.
import { useEffect, useMemo, useRef, useState } from 'react'
import { enterAt } from '../camera/CameraRig'
import { INTERIORS } from '../interiors/layouts'
import { useCases } from '../lib/cases'
import { rankItems, recordEntries, stepIndex, type SearchItem, type SearchTarget } from '../lib/search'
import { useSimStatus } from '../sim/world'
import { useStore, type CameraMode, type PanelId, type TourId } from '../state/store'
import { FACILITIES, facilityById } from '../world/layout'
import { IconSearch } from './icons'

export const PANEL_LABEL: Record<PanelId, string> = {
  overview: 'Command overview', agents: 'Agents', missions: 'Missions', events: 'Events', isb: 'ISB: security & intelligence', aircraft: 'Air control', facilities: 'Facilities',
}
const MODES: [CameraMode, string, string][] = [['orbit', 'Exterior view', '1'], ['tactical', 'Tactical map', '2'], ['firstperson', 'First person', '3'], ['thirdperson', 'Third person', '4'], ['cinematic', 'Cinematic tour', '5']]
export const TOURS: { id: TourId; label: string }[] = [
  { id: 'flyover', label: 'Base flyover' }, { id: 'shuttle', label: 'Shuttle arrival' }, { id: 'hangar', label: 'Hangar' },
  { id: 'command', label: 'Command chamber' }, { id: 'bunker', label: 'Server bunker' }, { id: 'agents', label: 'Agent activity' }, { id: 'duel', label: 'Lightsaber duel' },
  { id: 'destroyer', label: 'Star Destroyer' }, { id: 'march', label: 'March on the Temple' }, { id: 'bikes', label: 'Speeder bike patrol' },
]

/** record groups shown only when searching (an empty query lists recent agents and navigation) */
const RECORD_GROUPS = new Set(['Missions', 'Events', 'Case files', 'Aircraft'])

function buildItems(close: () => void): SearchItem[] {
  const st = useStore.getState()
  const now = Date.now() / 1000
  const go = (fn: () => void) => () => { close(); fn() }
  const items: SearchItem[] = []
  for (const [id, label] of Object.entries(PANEL_LABEL) as [PanelId, string][]) {
    items.push({ id: `panel:${id}`, group: 'Panels', label, keywords: id === 'isb' ? 'imperial security bureau incidents cases threat intelligence' : id, run: go(() => st.setPanel(id)) })
  }
  for (const f of FACILITIES) {
    items.push({ id: `fac:${f.id}`, group: 'Facilities', label: f.name, hint: f.short, keywords: f.description, run: go(() => { st.enterInterior(null); st.setCameraMode('orbit'); st.select({ kind: 'facility', id: f.id }) }) })
    if (INTERIORS[f.id]) items.push({ id: `enter:${f.id}`, group: 'Facilities', label: `Enter ${f.short.toLowerCase()}`, hint: f.name, keywords: 'interior walk inside', run: go(() => enterAt(f.id)) })
  }
  for (const [m, label, key] of MODES) items.push({ id: `mode:${m}`, group: 'Camera', label, hint: `Key ${key}`, keywords: 'camera view', run: go(() => st.setCameraMode(m)) })
  for (const t of TOURS) items.push({ id: `tour:${t.id}`, group: 'Tours', label: t.label, keywords: 'cinematic tour camera', run: go(() => st.watchTour(t.id)) })
  items.push(
    { id: 'act:labels', group: 'Actions', label: st.showLabels ? 'Hide building labels' : 'Show building labels', hint: 'Key L', run: go(() => st.toggleLabels()) },
    { id: 'act:tod', group: 'Actions', label: 'Change time of day', hint: 'Key N', keywords: 'golden dusk night lighting', run: go(() => st.cycleTimeOfDay()) },
    { id: 'act:hud', group: 'Actions', label: 'Hide the interface', hint: 'Key H brings it back', keywords: 'hud', run: go(() => st.toggleHud()) },
    { id: 'act:attention', group: 'Actions', label: 'Show agents that need me', keywords: 'attention waiting failed permission', run: go(() => { st.setRosterFilter('attention'); st.setPanel('agents') }) },
  )
  // records: agents, missions, meaningful events, case files (this browser) and simulated aircraft (SIM)
  const sim = useSimStatus.getState()
  const aircraft = [
    { id: 'shuttle', label: 'Imperial shuttle', state: sim.shuttlePhase },
    { id: 'freighter', label: 'Impounded freighter', state: sim.freighterPhase },
    { id: 'walker', label: 'Heavy walker Thunder-1', state: 'perimeter patrol' },
    { id: 'barge', label: 'Hutt sail barge', state: 'cruising the dunes' },
    ...(sim.gunshipPhase !== 'away' ? [{ id: 'gunship', label: 'Bounty hunter gunship', state: sim.gunshipPhase }] : []),
    ...(sim.xwingActive ? [{ id: 'xwing', label: 'Unidentified starfighters', state: 'attacking' }] : []),
    ...sim.fighters.map((f) => ({ id: f.id, label: `TIE patrol ${f.callsign}`, state: f.state })),
  ]
  const records = recordEntries({ agents: st.agents, tasks: st.tasks, events: st.events, cases: useCases.getState().cases, aircraft, now })
  const open = (t: SearchTarget) => {
    if (t.kind === 'agent') { st.setPanel('agents'); st.select({ kind: 'agent', id: t.id }) }
    else if (t.kind === 'mission') { st.setPanel('missions'); st.select({ kind: 'agent', id: t.agentId }) }
    else if (t.kind === 'event') { st.setPanel('events'); if (t.agentKey && st.agents[t.agentKey]) st.select({ kind: 'agent', id: t.agentKey }) }
    else if (t.kind === 'case') { useCases.getState().focus(t.id); st.setPanel('isb') }
    else { st.enterInterior(null); st.follow({ kind: 'aircraft', id: t.id }) }
  }
  // agents first (most often wanted), then navigation, then the other records
  const recs = records.map(({ target, ...r }) => ({ ...r, run: go(() => open(target)) }))
  return [...recs.filter((r) => r.group === 'Agents'), ...items, ...recs.filter((r) => r.group !== 'Agents')]
}


export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen)
  const setOpen = useStore((s) => s.setPaletteOpen)
  if (!open) return null
  return <PaletteDialog onClose={() => setOpen(false)} />
}

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const returnFocus = useRef<Element | null>(document.activeElement)
  const all = useMemo(() => buildItems(onClose), [onClose])
  const results = useMemo(() => rankItems(query, query.trim() ? all : all.filter((i, n) => (i.group === 'Agents' ? n < 6 : !RECORD_GROUPS.has(i.group))), 40), [query, all])
  useEffect(() => { input.current?.focus(); const r = returnFocus.current; return () => { (r as HTMLElement | null)?.focus?.() } }, [])
  useEffect(() => setIndex(0), [query])
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [index])
  const activeId = results[index] ? `pal-${results[index].id}` : undefined
  let lastGroup = ''
  return (
    <div className="palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command search">
        <div className="palette-input">
          <IconSearch size={16} />
          <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search agents, missions, events, case files, facilities and actions…"
            role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={activeId} aria-autocomplete="list" spellCheck={false}
            onKeyUp={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') { e.preventDefault(); onClose() }
              else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => stepIndex(i, e.key, results.length)) }
              else if (e.key === 'Enter') { e.preventDefault(); results[index]?.run() }
              else if (e.key === 'Tab') e.preventDefault() // focus stays in the dialog
            }} />
          <kbd>Esc</kbd>
        </div>
        <ul id="palette-list" ref={list} role="listbox" aria-label="Results" className="palette-list">
          {results.length === 0 && <li className="palette-empty" role="presentation">Nothing matches "{query}".</li>}
          {results.map((r, i) => {
            const head = !query.trim() && r.group !== lastGroup
            lastGroup = r.group
            return (
              <li key={r.id} role="presentation">
                {head && <div className="palette-group" aria-hidden="true">{r.group}</div>}
                <div id={`pal-${r.id}`} role="option" aria-selected={i === index} className={`palette-item ${i === index ? 'on' : ''}`}
                  onMouseMove={() => i !== index && setIndex(i)} onClick={() => r.run()}>
                  {query.trim() && <span className="pi-group">{r.group}</span>}<span className="pi-label">{r.label}</span>
                  {r.hint && <span className="pi-hint">{r.hint}</span>}
                </div>
              </li>
            )
          })}
        </ul>
        <div className="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Ctrl</kbd><kbd>K</kbd> or <kbd>/</kbd> anywhere</span></div>
      </div>
    </div>
  )
}

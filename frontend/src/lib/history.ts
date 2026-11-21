// Event history for the command overview and the ISB panel: the latest stored events from the read-only
// GET /api/events (behind the same LocalBoundary checks as every route), merged with the live events already in
// the store. Fetched while one of those panels is open, then once a minute. Never fetched in demo mode.
import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { useStore } from '../state/store'
import type { HookEvent } from '../state/types'
import { mergeEvents } from './intel'

export const HISTORY_LIMIT = 2000
const REFRESH_MS = 60_000

interface HistoryState {
  events: HookEvent[]
  fetchedAt: number | null
  loading: boolean
  error: string | null
  refresh(): Promise<void>
}

export const useHistory = create<HistoryState>((set, get) => ({
  events: [],
  fetchedAt: null,
  loading: false,
  error: null,
  async refresh() {
    if (get().loading || useStore.getState().demo) return
    set({ loading: true })
    try {
      const r = await fetch(`/api/events?limit=${HISTORY_LIMIT}`)
      if (!r.ok) throw new Error(`The base answered ${r.status}.`)
      const data: unknown = await r.json()
      set({ events: Array.isArray(data) ? (data as HookEvent[]) : [], fetchedAt: Date.now() / 1000, error: null })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Could not load the event history.' })
    } finally {
      set({ loading: false })
    }
  },
}))

/** Stored history plus live events, deduplicated. Mount it in any panel that needs the wider window. */
export function useEventHistory() {
  const demo = useStore((s) => s.demo)
  const connected = useStore((s) => s.connected)
  const live = useStore((s) => s.events)
  const { events, fetchedAt, loading, error, refresh } = useHistory()
  useEffect(() => {
    if (demo || !connected) return
    void refresh()
    const t = window.setInterval(() => void refresh(), REFRESH_MS)
    return () => window.clearInterval(t)
  }, [demo, connected, refresh])
  const merged = useMemo(() => (demo ? live : mergeEvents(events, live)), [demo, events, live])
  return { events: merged, fetchedAt, loading: loading && !fetchedAt, error: demo ? null : error, refresh }
}

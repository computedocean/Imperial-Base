// Activity feed helpers: filtering, counts and the text labels that carry severity (never colour alone).
import type { FeedItem } from '../state/store'

export type FeedFilter = 'all' | 'agent' | 'alerts' | 'sim'

/** Lines shown before "Show more"; the store keeps the newest 120. */
export const FEED_PAGE = 12
export const FEED_MORE = 60

export const FEED_SEVERITY: Record<FeedItem['tone'], string> = {
  alert: 'Alert', warn: 'Warning', ok: 'Done', info: 'Info', sim: 'Sim',
}

const isAlert = (f: FeedItem) => f.tone === 'warn' || f.tone === 'alert'

export function filterFeed(feed: FeedItem[], filter: FeedFilter, limit = FEED_PAGE): FeedItem[] {
  return feed.filter((f) => (filter === 'all' ? true : filter === 'alerts' ? isAlert(f) : f.source === filter)).slice(0, limit)
}

export function feedCounts(feed: FeedItem[]): Record<FeedFilter, number> {
  const c = { all: feed.length, agent: 0, sim: 0, alerts: 0 }
  for (const f of feed) {
    c[f.source]++
    if (isAlert(f)) c.alerts++
  }
  return c
}

export const stripSimPrefix = (text: string) => text.replace(/^\[SIM\]\s*/, '')

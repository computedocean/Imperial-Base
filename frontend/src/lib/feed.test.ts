import { describe, expect, it } from 'vitest'
import type { FeedItem } from '../state/store'
import { FEED_PAGE, FEED_SEVERITY, feedCounts, filterFeed, stripSimPrefix } from './feed'

const item = (id: string, tone: FeedItem['tone'], source: FeedItem['source'], ts = 100): FeedItem => ({ id, ts, text: `${source} ${tone}`, tone, source })

describe('activity feed', () => {
  const feed = [item('1', 'alert', 'agent'), item('2', 'ok', 'agent'), item('3', 'warn', 'sim'), item('4', 'info', 'sim'), item('5', 'warn', 'agent')]

  it('filters by source and by severity', () => {
    expect(filterFeed(feed, 'all').map((f) => f.id)).toEqual(['1', '2', '3', '4', '5'])
    expect(filterFeed(feed, 'agent').map((f) => f.id)).toEqual(['1', '2', '5'])
    expect(filterFeed(feed, 'sim').map((f) => f.id)).toEqual(['3', '4'])
    expect(filterFeed(feed, 'alerts').map((f) => f.id)).toEqual(['1', '3', '5'])
  })

  it('limits the visible history', () => {
    const many = Array.from({ length: 80 }, (_, i) => item(String(i), 'info', 'agent'))
    expect(filterFeed(many, 'all')).toHaveLength(FEED_PAGE)
    expect(filterFeed(many, 'all', 50)).toHaveLength(50)
  })

  it('counts every filter for the chip badges', () => {
    expect(feedCounts(feed)).toEqual({ all: 5, agent: 3, sim: 2, alerts: 3 })
  })

  it('gives every tone a text label, so severity never relies on colour alone', () => {
    for (const tone of ['info', 'warn', 'alert', 'ok', 'sim'] as const) expect(FEED_SEVERITY[tone].length).toBeGreaterThan(1)
    expect(FEED_SEVERITY.alert).toBe('Alert')
    expect(FEED_SEVERITY.warn).toBe('Warning')
  })

  it('drops the [SIM] text prefix because the source tag already says it', () => {
    expect(stripSimPrefix('[SIM] Shuttle on approach')).toBe('Shuttle on approach')
    expect(stripSimPrefix('Agent reported for duty')).toBe('Agent reported for duty')
  })
})

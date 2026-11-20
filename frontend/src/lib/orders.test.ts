import { describe, expect, it } from 'vitest'
import type { OrderInfo } from '../state/types'
import { orderLabel, pickOrder } from './orders'

const order = (id: string, updated_at: number, title = id): OrderInfo => ({
  id, session_id: `s-${id}`, agent_id: `session:s-${id}`, title, status: 'idle', created_at: 0, updated_at, turns: 1, messages: [],
})

describe('pickOrder', () => {
  const orders = { a: order('a', 10), b: order('b', 30), c: order('c', 20) }

  it('keeps the conversation the Commander chose', () => {
    expect(pickOrder(orders, 'a')?.id).toBe('a')
  })

  it('falls back to the most recently active one', () => {
    expect(pickOrder(orders, null)?.id).toBe('b')
    expect(pickOrder(orders, 'gone')?.id).toBe('b')
  })

  it('returns nothing when there are no conversations', () => {
    expect(pickOrder({}, null)).toBeNull()
  })
})

describe('orderLabel', () => {
  it('shortens long titles and names empty ones', () => {
    expect(orderLabel(order('a', 0, 'Short'))).toBe('Short')
    expect(orderLabel(order('a', 0, 'Rebuild the hangar doors and repaint'), 12)).toBe('Rebuild the…')
    expect(orderLabel(order('a', 0, '  '))).toBe('Order')
  })
})

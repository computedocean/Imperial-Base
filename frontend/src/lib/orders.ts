// Client for the Commander's chat (backend/app/orders.py). Live updates arrive over the websocket;
// these calls only send: a new order, a follow-up, or a stop.
import type { OrderInfo } from '../state/types'

async function post(path: string, body: unknown): Promise<OrderInfo> {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) {
    let detail = `The base refused the request (${r.status}).`
    try { const j = await r.json(); if (typeof j?.detail === 'string') detail = j.detail } catch { /* keep the default */ }
    throw new Error(detail)
  }
  return r.json()
}

export const startOrder = (text: string) => post('/api/orders', { text })
export const sendToOrder = (id: string, text: string) => post(`/api/orders/${encodeURIComponent(id)}/messages`, { text })
export const stopOrder = (id: string) => post(`/api/orders/${encodeURIComponent(id)}/stop`, {})

/** The conversation to show: the chosen one if it still exists, otherwise the most recently active. */
export function pickOrder(orders: Record<string, OrderInfo>, chosen: string | null): OrderInfo | null {
  if (chosen && orders[chosen]) return orders[chosen]
  let best: OrderInfo | null = null
  for (const o of Object.values(orders)) if (!best || o.updated_at > best.updated_at) best = o
  return best
}

/** Short label for a conversation chip. */
export function orderLabel(o: OrderInfo, max = 22): string {
  const t = o.title.trim() || 'Order'
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}

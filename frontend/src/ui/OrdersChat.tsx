// The Commander's chat: give an order, and a Claude Code agent carries it out in the base's own folder.
// Docked under the mission list. Each conversation is one agent; several can work at once.
import { useEffect, useRef, useState } from 'react'
import { orderLabel, pickOrder, sendToOrder, startOrder, stopOrder } from '../lib/orders'
import { useStore } from '../state/store'
import type { OrderInfo } from '../state/types'

const STATUS_TEXT: Record<OrderInfo['status'], string> = {
  running: 'Agent at work…', idle: 'Awaiting your next order', failed: 'The last order failed', stopped: 'Stopped',
}

export function OrdersChat() {
  const orders = useStore((s) => s.orders)
  const info = useStore((s) => s.ordersInfo)
  const agents = useStore((s) => s.agents)
  const select = useStore((s) => s.select)
  const [chosen, setChosen] = useState<string | null>(null)
  const [fresh, setFresh] = useState(false) // composing a new conversation instead of replying
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const thread = useRef<HTMLDivElement>(null)

  const current = fresh ? null : pickOrder(orders, chosen)
  const count = current?.messages.length ?? 0
  useEffect(() => {
    const el = thread.current
    if (el) el.scrollTop = el.scrollHeight
  }, [count, current?.id])

  const list = Object.values(orders).sort((a, b) => a.created_at - b.created_at)
  const working = current?.status === 'running'
  const canSend = !!info?.enabled && !busy && !working && text.trim().length > 0

  const send = async () => {
    if (!canSend) return
    setBusy(true)
    setError(null)
    try {
      const o = current ? await sendToOrder(current.id, text) : await startOrder(text)
      useStore.getState().applyOrder(o)
      setChosen(o.id)
      setFresh(false)
      setText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The order could not be sent.')
    } finally {
      setBusy(false)
    }
  }
  const stop = async () => {
    if (!current) return
    try { useStore.getState().applyOrder(await stopOrder(current.id)) } catch (e) { setError(e instanceof Error ? e.message : 'Could not stop the agent.') }
  }

  const agent = current ? agents[current.agent_id] : undefined
  return (
    <div className="orders" aria-label="Orders">
      <div className="orders-head">
        <span className="orders-title">ORDERS</span>
        <span className="orders-folder" title="Agents started here work in this folder only. File edits go through; other actions need to be allowed in your Claude Code settings.">{info?.folder ?? '—'} folder</span>
        <div className="chips orders-chips" role="toolbar" aria-label="Conversations">
          {list.map((o) => (
            <button key={o.id} className={`${current?.id === o.id ? 'on' : ''} st-${o.status}`} aria-pressed={current?.id === o.id} title={o.title} onClick={() => { setChosen(o.id); setFresh(false) }}>
              <span className="dot" />{orderLabel(o)}
            </button>
          ))}
          {list.length > 0 && <button className={fresh ? 'on' : ''} aria-pressed={fresh} title="Start another agent on a new order" onClick={() => setFresh(true)}>+ New</button>}
        </div>
      </div>
      <div className="orders-thread" ref={thread} aria-live="polite">
        {!info && <div className="empty sm">Connecting to the base…</div>}
        {info && !info.enabled && <div className="empty sm">Orders are unavailable. {info.reason}</div>}
        {info?.enabled && !current && <div className="empty sm">Type an order below. An agent will report for duty in the {info.folder} folder and carry it out.</div>}
        {current?.messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.role === 'commander' && <span className="who">You</span>}
            {m.role === 'agent' && <span className="who">{agent?.name ?? 'Agent'}</span>}
            <span className="body">{m.text}</span>
          </div>
        ))}
      </div>
      {current && (
        <div className={`orders-status st-${current.status}`}>
          <span className="dot" />{STATUS_TEXT[current.status]}
          <span className="grow" />
          {agent && <button onClick={() => select({ kind: 'agent', id: current.agent_id })} title="Open this agent in the inspector">Show agent</button>}
          {working && <button className="warn" onClick={stop}>Stop</button>}
        </div>
      )}
      {error && <div className="orders-error" role="alert">{error}</div>}
      <div className="orders-compose">
        <textarea
          value={text}
          rows={2}
          maxLength={8000}
          disabled={!info?.enabled}
          aria-label={current ? 'Reply to this agent' : 'New order'}
          placeholder={working ? 'Wait for the agent to finish, or stop it…' : current ? 'Reply to this agent…' : 'Give an order…'}
          onChange={(e) => setText(e.target.value)}
          // keep the base's own shortcuts (H, S, N, 1-5, WASD…) from firing while typing
          onKeyUp={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
          }}
        />
        <button className="on" disabled={!canSend} onClick={send} title="Enter sends · Shift+Enter adds a line">{busy ? '…' : 'Send'}</button>
      </div>
    </div>
  )
}

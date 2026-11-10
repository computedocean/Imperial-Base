import { useStore, type LiveUpdate } from '../state/store'

/** Live link to the backend. Event-driven (no polling); reconnects with capped backoff. */
export function connectLive(): () => void {
  let sock: WebSocket | null = null
  let stopped = false
  let delay = 1000
  let pingTimer: number | undefined
  let retryTimer: number | undefined
  // Live events are applied in batches (at most every 50 ms): a burst (a busy agent, or the backend
  // catching up after downtime) becomes one store update instead of one React render per message.
  let pending: LiveUpdate[] = []
  let flushTimer: number | undefined
  const flush = () => {
    flushTimer = undefined
    const batch = pending
    pending = []
    useStore.getState().applyEvents(batch)
  }

  const open = () => {
    if (stopped) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    sock = new WebSocket(`${proto}://${location.host}/ws`)
    sock.onopen = () => {
      delay = 1000
      useStore.getState().setConnected(true)
      pingTimer = window.setInterval(() => sock?.readyState === 1 && sock.send(JSON.stringify({ type: 'ping' })), 30000)
    }
    sock.onmessage = (m) => {
      let msg: any
      try { msg = JSON.parse(m.data) } catch { return }
      const st = useStore.getState()
      if (msg.type === 'snapshot') { pending = []; st.applySnapshot(msg) }
      else if (msg.type === 'event') {
        pending.push({ event: msg.event, agents: msg.agents ?? [], tasks: msg.tasks ?? [] })
        // a timer, not requestAnimationFrame: rAF is paused in background tabs and the queue would grow
        if (flushTimer === undefined) flushTimer = window.setTimeout(flush, 50)
      }
      else if (msg.type === 'system') st.setSystem(msg.system)
    }
    sock.onclose = () => {
      useStore.getState().setConnected(false)
      window.clearInterval(pingTimer)
      if (!stopped) retryTimer = window.setTimeout(open, delay)
      delay = Math.min(delay * 2, 15000)
    }
    sock.onerror = () => sock?.close()
  }
  open()
  return () => {
    stopped = true
    window.clearTimeout(retryTimer)
    window.clearTimeout(flushTimer)
    window.clearInterval(pingTimer)
    sock?.close()
  }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'

const wsUrl =
  import.meta.env.VITE_WS_URL ?? 'ws://localhost:3000/ws'

type ConnState = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export default function App() {
  const [state, setState] = useState<ConnState>('idle')
  const [log, setLog] = useState<string[]>([])
  const wsRef = useRef<WebSocket | null>(null)

  const append = useCallback((line: string) => {
    setLog((prev) => [...prev.slice(-49), line])
  }, [])

  useEffect(() => {
    setState('connecting')
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setState('open')
      append('[open]')
    }
    ws.onmessage = (ev) => {
      append(`[in] ${ev.data}`)
    }
    ws.onerror = () => {
      setState('error')
      append('[error]')
    }
    ws.onclose = () => {
      setState('closed')
      append('[close]')
      wsRef.current = null
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [append])

  const sendPing = () => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      append('[send blocked: socket not open]')
      return
    }
    const body = `ping-${Date.now()}`
    ws.send(body)
    append(`[out] ${body}`)
  }

  return (
    <div className="dev-shell">
      <h1>No Rake</h1>
      <p className="muted">Step 1: dev loop — WebSocket smoke test</p>

      <dl className="facts">
        <dt>WebSocket URL</dt>
        <dd>
          <code>{wsUrl}</code>
        </dd>
        <dt>Socket state</dt>
        <dd>
          <code>{state}</code>
        </dd>
      </dl>

      <p className="hint">
        Start both processes from repo root: <code>npm run dev</code>
        <br />
        Expect a JSON <code>hello</code> from the server, then echo on send.
      </p>

      <button type="button" onClick={sendPing}>
        Send test message
      </button>

      <pre className="log" aria-live="polite">
        {log.length === 0 ? '…waiting for events…' : log.join('\n')}
      </pre>
    </div>
  )
}

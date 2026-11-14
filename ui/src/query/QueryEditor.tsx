import { useEffect, useRef, type KeyboardEvent } from 'react'
import type { RunTarget } from '../bindings'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { useQueryStore } from './queryStore'

const NO_CONNECTIONS: never[] = []

/** The selection is the target. Without a selection, the statement at the cursor is the target. */
function targetOf(input: HTMLTextAreaElement | null): RunTarget {
  if (!input) return { type: 'all' }
  const { selectionStart: from, selectionEnd: to } = input
  return from === to
    ? { type: 'at', offset: from }
    : { type: 'range', from, to }
}

export function QueryEditor() {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const connections = useWorkspaceStore(
    (state) => state.workspace?.connections ?? NO_CONNECTIONS,
  )
  const session = useQueryStore((state) => state.session)
  const connectState = useQueryStore((state) => state.connectState)
  const sql = useQueryStore((state) => state.sql)
  const runState = useQueryStore((state) => state.runState)
  const jumpTo = useQueryStore((state) => state.jumpTo)
  const connect = useQueryStore((state) => state.connect)
  const disconnect = useQueryStore((state) => state.disconnect)
  const setSql = useQueryStore((state) => state.setSql)
  const run = useQueryStore((state) => state.run)
  const cancel = useQueryStore((state) => state.cancel)
  const setJumpTo = useQueryStore((state) => state.setJumpTo)
  const reset = useQueryStore((state) => state.reset)

  const active = connections.find((c) => c.id === session?.connectionId)
  const isConnecting = connectState.status === 'connecting'
  const canRun = session !== null && runState === 'idle'

  // The backend closes the sessions when the workspace closes.
  useEffect(() => reset, [reset])

  useEffect(() => {
    if (jumpTo === null) return
    inputRef.current?.focus()
    inputRef.current?.setSelectionRange(jumpTo, jumpTo)
    setJumpTo(null)
  }, [jumpTo, setJumpTo])

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    void run(event.shiftKey ? { type: 'all' } : targetOf(inputRef.current))
  }

  return (
    <section className="pane query" aria-label="Editor">
      <div className="query__bar">
        <label className="query__connection">
          <span className="visually-hidden">Connection</span>
          <select
            value={session?.connectionId ?? ''}
            disabled={isConnecting || runState !== 'idle'}
            onChange={(event) =>
              void (event.target.value
                ? connect(event.target.value)
                : disconnect())
            }
          >
            <option value="">Not connected</option>
            {connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.name}
              </option>
            ))}
          </select>
        </label>
        {active && (
          <span className={`badge badge--${active.environment}`}>
            {active.environment}
          </span>
        )}
        {isConnecting && <span role="status">Connecting…</span>}
        {session && (
          <span className="query__server">PostgreSQL {session.version}</span>
        )}
        <span className="title-bar__spacer" />
        <button
          type="button"
          className="button button--small button--primary"
          disabled={!canRun}
          title="Run the selection, or the statement at the cursor (Ctrl+Enter)"
          onClick={() => void run(targetOf(inputRef.current))}
        >
          Run
        </button>
        <button
          type="button"
          className="button button--small"
          disabled={!canRun}
          title="Run all statements (Ctrl+Shift+Enter)"
          onClick={() => void run({ type: 'all' })}
        >
          Run all
        </button>
        <button
          type="button"
          className="button button--small button--danger"
          disabled={runState !== 'running'}
          onClick={() => void cancel()}
        >
          Cancel
        </button>
      </div>
      {connectState.status === 'failed' && (
        <div className="message message--error" role="alert">
          <p className="message__title">The connection failed</p>
          <p className="message__detail">{connectState.error.detail}</p>
          {connectState.error.advice && (
            <p className="message__detail">{connectState.error.advice}</p>
          )}
        </div>
      )}
      <textarea
        ref={inputRef}
        className="query__input"
        aria-label="SQL"
        spellCheck={false}
        placeholder="Write SQL here. Ctrl+Enter runs the statement at the cursor."
        value={sql}
        onChange={(event) => setSql(event.target.value)}
        onKeyDown={onKeyDown}
      />
    </section>
  )
}

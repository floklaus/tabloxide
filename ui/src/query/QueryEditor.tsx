import { useEffect, useRef } from 'react'
import type { RunTarget } from '../bindings'
import { CodeEditor, type CodeEditorHandle } from '../editor/CodeEditor'
import { setActiveEditor } from '../editor/editorBridge'
import { usePreferencesStore } from '../preferences/preferencesStore'
import { TabBar } from '../tabs/TabBar'
import { isDirty, useTabsStore } from '../tabs/tabsStore'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { activeQueryStore, useQuery } from './queryStore'
import { requestRun } from './runConfirm'

const NO_CONNECTIONS: never[] = []

export function QueryEditor() {
  const editorRef = useRef<CodeEditorHandle>(null)
  const connections = useWorkspaceStore(
    (state) => state.workspace?.connections ?? NO_CONNECTIONS,
  )
  const tab = useTabsStore((state) =>
    state.tabs.find((item) => item.id === state.activeId),
  )
  const setContent = useTabsStore((state) => state.setContent)
  const setConnection = useTabsStore((state) => state.setConnection)
  const saveTab = useTabsStore((state) => state.save)
  const editorPreferences = usePreferencesStore(
    (state) => state.preferences.editor,
  )
  const session = useQuery((state) => state.session)
  const connectState = useQuery((state) => state.connectState)
  const runState = useQuery((state) => state.runState)
  const jumpTo = useQuery((state) => state.jumpTo)

  useEffect(() => {
    setActiveEditor(editorRef)
    return () => setActiveEditor(null)
  }, [])

  useEffect(() => {
    if (jumpTo === null) return
    editorRef.current?.focusAt(jumpTo)
    activeQueryStore().getState().setJumpTo(null)
  }, [jumpTo])

  if (!tab) return <section className="pane query" aria-label="Editor" />

  const active = connections.find((c) => c.id === tab.connectionId)
  const isConnecting = connectState.status === 'connecting'
  const canRun = active !== undefined && runState === 'idle' && !isConnecting
  const run = (target: RunTarget) => {
    if (!canRun) return
    void requestRun(tab.content, target)
  }
  const selectConnection = (connectionId: string) => {
    const query = activeQueryStore().getState()
    setConnection(tab.id, connectionId || null)
    void (connectionId ? query.connect(connectionId) : query.disconnect())
  }

  return (
    <section className="pane query" aria-label="Editor">
      <TabBar />
      <div className="query__bar">
        <label className="query__connection">
          <span className="visually-hidden">Connection</span>
          <select
            value={active?.id ?? ''}
            disabled={isConnecting || runState !== 'idle'}
            onChange={(event) => selectConnection(event.target.value)}
          >
            <option value="">No connection</option>
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
        {active?.read_only && <span className="badge">read-only</span>}
        {isConnecting && <span role="status">Connecting…</span>}
        {session && (
          <span className="query__server">PostgreSQL {session.version}</span>
        )}
        {active && !session && !isConnecting && (
          <span className="query__server">Connects at the first run</span>
        )}
        <span className="title-bar__spacer" />
        <button
          type="button"
          className="button button--small"
          disabled={!isDirty(tab)}
          title="Save the file (Ctrl+S)"
          onClick={() => void saveTab(tab.id)}
        >
          Save
        </button>
        <button
          type="button"
          className="button button--small button--primary"
          disabled={!canRun}
          title="Run the selection, or the statement at the cursor (Ctrl+Enter)"
          onClick={() => run(editorRef.current?.getTarget() ?? { type: 'all' })}
        >
          Run
        </button>
        <button
          type="button"
          className="button button--small"
          disabled={!canRun}
          title="Run all statements (Ctrl+Shift+Enter)"
          onClick={() => run({ type: 'all' })}
        >
          Run all
        </button>
        <button
          type="button"
          className="button button--small button--danger"
          disabled={runState !== 'running'}
          onClick={() => void activeQueryStore().getState().cancel()}
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
      <CodeEditor
        ref={editorRef}
        tabId={tab.id}
        value={tab.content}
        preferences={editorPreferences}
        onChange={(value) => setContent(tab.id, value)}
        onRun={run}
        onSave={() => void saveTab(tab.id)}
      />
    </section>
  )
}

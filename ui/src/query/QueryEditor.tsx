import { engineLanguage, serverLabel } from '../engines/engineStore'
import { useEffect, useRef, useState } from 'react'
import { AssistantSessionView } from '../assistant/AssistantSessionView'
import { InlineChange } from '../assistant/InlineChange'
import {
  explainSelection,
  inlineChangeKey,
  useInlineChange,
} from '../assistant/inlineChange'
import type { RunTarget } from '../bindings'
import { combineSources } from '../completion/combine'
import { completeSql } from '../completion/sqlCompletion'
import { usePlanStore } from '../plan/planStore'
import { Icon } from '../shell/icons'
import { MenuButton } from '../shell/menu/MenuButton'
import { useShellStore } from '../shell/shellStore'
import { SaveSnippetDialog } from '../snippets/SaveSnippetDialog'
import { completeSnippets } from '../snippets/snippets'
import { CodeEditor, type CodeEditorHandle } from '../editor/CodeEditor'
import { setActiveEditor } from '../editor/editorBridge'
import { usePreferencesStore } from '../preferences/preferencesStore'
import { TabBar } from '../tabs/TabBar'
import { isDirty, sqlTabOf, useTabsStore } from '../tabs/tabsStore'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { activeQueryStore, useQuery } from './queryStore'
import { requestRun } from './runConfirm'

const NO_CONNECTIONS: never[] = []

export function QueryEditor() {
  const editorRef = useRef<CodeEditorHandle>(null)
  const connections = useWorkspaceStore(
    (state) => state.workspace?.connections ?? NO_CONNECTIONS,
  )
  // While an assistant tab is active, the SQL editor stays in the page, hidden.
  // Thus it keeps its undo history, and the assistant can insert SQL into it.
  const tab = useTabsStore(sqlTabOf)
  const assistantSessionId = useTabsStore(
    (state) =>
      state.tabs.find((item) => item.id === state.activeId)?.assistantSessionId,
  )
  const setContent = useTabsStore((state) => state.setContent)
  const saveTab = useTabsStore((state) => state.save)
  const editorPreferences = usePreferencesStore(
    (state) => state.preferences.editor,
  )
  const session = useQuery((state) => state.session)
  const connectState = useQuery((state) => state.connectState)
  const runState = useQuery((state) => state.runState)
  const jumpTo = useQuery((state) => state.jumpTo)
  const [formatError, setFormatError] = useState<string | null>(null)
  const [snippetText, setSnippetText] = useState<string | null>(null)
  const setCursor = useShellStore((state) => state.setCursor)

  useEffect(() => {
    setActiveEditor(editorRef)
    return () => setActiveEditor(null)
  }, [])

  useEffect(() => {
    if (jumpTo === null) return
    editorRef.current?.focusAt(jumpTo)
    activeQueryStore().getState().setJumpTo(null)
  }, [jumpTo])

  if (!tab)
    return (
      <section className="pane query" aria-label="Editor" data-area="editor" />
    )

  const active = connections.find((c) => c.id === tab.connectionId)
  const language = engineLanguage(active?.engine ?? 'postgres')
  const isConnecting = connectState.status === 'connecting'
  const canRun = active !== undefined && runState === 'idle' && !isConnecting
  const run = (target: RunTarget) => {
    if (!canRun) return
    void requestRun(tab.content, target)
  }
  return (
    <section className="pane query" aria-label="Editor" data-area="editor">
      <TabBar />
      {assistantSessionId !== undefined && (
        <AssistantSessionView sessionId={assistantSessionId} />
      )}
      <div className="query__sql" hidden={assistantSessionId !== undefined}>
        <div className="query__bar">
          <button
            type="button"
            className="button button--primary query__run"
            disabled={!canRun}
            aria-keyshortcuts="Control+Enter"
            title="Run the selection, or the statement at the cursor"
            onClick={() =>
              run(editorRef.current?.getTarget() ?? { type: 'all' })
            }
          >
            <Icon name="play" size={14} />
            Run
            <span className="query__key" aria-hidden="true">
              Ctrl+Enter
            </span>
          </button>
          <button
            type="button"
            className="button"
            disabled={!canRun}
            title="Run all statements (Ctrl+Shift+Enter)"
            onClick={() => run({ type: 'all' })}
          >
            Run all
          </button>
          <button
            type="button"
            className="button button--danger-outline"
            disabled={runState !== 'running'}
            onClick={() => void activeQueryStore().getState().cancel()}
          >
            Cancel
          </button>
          {active?.read_only && <span className="badge">read-only</span>}
          {isConnecting && <span role="status">Connecting…</span>}
          <span className="title-bar__spacer" />
          {session && (
            <span className="query__server">
              {serverLabel(active?.engine ?? 'postgres', session.version)}
            </span>
          )}
          {active && !session && !isConnecting && (
            <span className="query__server">Connects at the first run</span>
          )}
          <MenuButton
            label="More query actions"
            menuLabel="Query actions"
            className="icon-button"
            items={() => [
              {
                kind: 'action',
                label: 'Explain',
                detail: 'The plan. The statement does not run.',
                disabled: !active || runState !== 'idle',
                run: () => void usePlanStore.getState().read(false),
              },
              {
                kind: 'action',
                label: 'Explain analyze',
                detail: 'Runs a statement that reads data, and measures it.',
                disabled: !active || runState !== 'idle',
                run: () => void usePlanStore.getState().read(true),
              },
              { kind: 'separator' },
              {
                kind: 'action',
                label: 'Format the SQL',
                shortcut: 'Shift+Alt+F',
                run: () => {
                  setFormatError(null)
                  editorRef.current?.format()
                },
              },
              {
                kind: 'action',
                label: 'Save as snippet…',
                run: () =>
                  setSnippetText(
                    editorRef.current?.getSelectedText() ?? tab.content,
                  ),
              },
            ]}
          >
            <Icon name="more" size={16} />
          </MenuButton>
          <button
            type="button"
            className="button"
            disabled={!isDirty(tab)}
            title="Save the file (Ctrl+S)"
            onClick={() => void saveTab(tab.id)}
          >
            Save
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
        {formatError && (
          <div className="message message--error" role="alert">
            <p className="message__detail">{formatError}</p>
            <button
              type="button"
              className="link-button"
              onClick={() => setFormatError(null)}
            >
              Dismiss
            </button>
          </div>
        )}
        {snippetText !== null && (
          <SaveSnippetDialog
            template={snippetText}
            onClose={() => setSnippetText(null)}
          />
        )}
        <CodeEditor
          ref={editorRef}
          tabId={tab.id}
          value={tab.content}
          preferences={editorPreferences}
          onChange={(value) => setContent(tab.id, value)}
          onRun={run}
          onSave={() => void saveTab(tab.id)}
          engine={active?.engine ?? 'postgres'}
          language={language}
          onFormatError={setFormatError}
          onCursorChange={setCursor}
          onAiChange={() => void useInlineChange.getState().start()}
          onAiExplain={() => void explainSelection()}
          onAiKey={inlineChangeKey}
          completionSource={
            language === 'sql'
              ? combineSources(
                  (context) => completeSql(context, tab.connectionId),
                  completeSnippets,
                )
              : undefined
          }
        />
        <InlineChange />
      </div>
    </section>
  )
}

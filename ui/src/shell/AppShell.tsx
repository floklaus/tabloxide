import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
} from 'react-resizable-panels'
import { useEffect, useState } from 'react'
import { AssistantPanel } from '../assistant/AssistantPanel'
import { useAssistantStore } from '../assistant/assistantStore'
import { ConnectionList } from '../connections/ConnectionList'
import { FileTree } from '../files/FileTree'
import { GitPanel } from '../git/GitPanel'
import { useGitStore } from '../git/gitStore'
import { startWorkspaceWatch } from '../workspace/watch'
import { PreferencesDialog } from '../preferences/PreferencesDialog'
import { usePreferencesStore } from '../preferences/preferencesStore'
import { resetQueryStores } from '../query/queryStore'
import { RunConfirmDialog } from '../query/RunConfirmDialog'
import { useResultsViewStore } from '../results/resultsViewStore'
import { SchemaTree } from '../schema/SchemaTree'
import { useSchemaStore } from '../schema/schemaStore'
import { persistTabs, useTabsStore } from '../tabs/tabsStore'
import { QueryEditor } from '../query/QueryEditor'
import { ResultsPane } from '../results/ResultsPane'
import { ThemeToggle } from '../theme/ThemeToggle'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { StatusBar } from './StatusBar'

type SidebarView = 'files' | 'connections' | 'schema' | 'git'

const SIDEBAR_VIEWS: { id: SidebarView; label: string }[] = [
  { id: 'files', label: 'Files' },
  { id: 'connections', label: 'Connections' },
  { id: 'schema', label: 'Schema' },
  { id: 'git', label: 'Git' },
]

const MAIN_LAYOUT_ID = 'tabloxide.layout.main'
const WORK_LAYOUT_ID = 'tabloxide.layout.work'
/** The pane library keeps one layout for each set of panes. */
const MAIN_PANES = ['sidebar', 'work']
const ASSISTANT_PANES = [...MAIN_PANES, 'assistant']
const ASSISTANT_OPEN_KEY = 'tabloxide.assistant.open'

function loadShowsAssistant(): boolean {
  try {
    return localStorage.getItem(ASSISTANT_OPEN_KEY) === 'true'
  } catch {
    return false
  }
}

function storeShowsAssistant(shows: boolean): void {
  try {
    localStorage.setItem(ASSISTANT_OPEN_KEY, String(shows))
  } catch {
    // Without the storage, the panel is closed at the next start.
  }
}

export function AppShell() {
  const [showsAssistant, setShowsAssistant] = useState(loadShowsAssistant)
  const mainLayout = useDefaultLayout({
    id: MAIN_LAYOUT_ID,
    panelIds: showsAssistant ? ASSISTANT_PANES : MAIN_PANES,
  })
  const workLayout = useDefaultLayout({ id: WORK_LAYOUT_ID })
  const workspaceName = useWorkspaceStore((state) => state.workspace?.name)
  const error = useWorkspaceStore((state) => state.error)
  const setError = useWorkspaceStore((state) => state.setError)
  const close = useWorkspaceStore((state) => state.close)
  const tabsError = useTabsStore((state) => state.error)
  const setTabsError = useTabsStore((state) => state.setError)
  const [showsPreferences, setShowsPreferences] = useState(false)
  const [sidebarView, setSidebarView] = useState<SidebarView>('files')
  const toggleAssistant = () => {
    storeShowsAssistant(!showsAssistant)
    setShowsAssistant(!showsAssistant)
  }

  // The tabs and the sessions belong to the workspace. They start and end with this screen.
  useEffect(() => {
    void usePreferencesStore.getState().load()
    void useTabsStore.getState().load()
    const stopPersist = persistTabs()
    // Without the watch, the application shows external changes only after a refresh.
    void startWorkspaceWatch().then((message) => {
      if (message) useWorkspaceStore.getState().setError(message)
    })
    return () => {
      stopPersist()
      useTabsStore.getState().reset()
      resetQueryStores()
      useSchemaStore.getState().reset()
      useGitStore.getState().reset()
      useAssistantStore.getState().reset()
      useResultsViewStore.getState().setView('results')
    }
  }, [])

  return (
    <div className="app-shell">
      <header className="title-bar">
        <span className="title-bar__name">Tabloxide</span>
        {workspaceName && (
          <span className="title-bar__workspace">{workspaceName}</span>
        )}
        <span className="title-bar__spacer" />
        <button
          type="button"
          className="button button--small"
          aria-pressed={showsAssistant}
          title="Show or hide the AI assistant"
          onClick={toggleAssistant}
        >
          Assistant
        </button>
        <button
          type="button"
          className="button button--small"
          onClick={() => void close()}
        >
          Close workspace
        </button>
        <button
          type="button"
          className="button button--small"
          onClick={() => setShowsPreferences(true)}
        >
          Preferences
        </button>
        <ThemeToggle />
      </header>

      {error && (
        <div className="banner" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="link-button"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {tabsError && (
        <div className="banner" role="alert">
          <span>{tabsError}</span>
          <button
            type="button"
            className="link-button"
            onClick={() => setTabsError(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      <RunConfirmDialog />
      {showsPreferences && (
        <PreferencesDialog onClose={() => setShowsPreferences(false)} />
      )}

      <Group
        className="app-shell__panes"
        orientation="horizontal"
        defaultLayout={mainLayout.defaultLayout}
        onLayoutChanged={mainLayout.onLayoutChanged}
      >
        <Panel id="sidebar" defaultSize="20%" minSize="12%" collapsible>
          <nav className="pane" aria-label="Sidebar">
            <div
              className="results__views"
              role="tablist"
              aria-label="Sidebar views"
            >
              {SIDEBAR_VIEWS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  className="results__view"
                  aria-selected={sidebarView === item.id}
                  onClick={() => setSidebarView(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {sidebarView === 'files' && <FileTree />}
            {sidebarView === 'connections' && <ConnectionList />}
            {sidebarView === 'schema' && <SchemaTree />}
            {sidebarView === 'git' && <GitPanel />}
          </nav>
        </Panel>
        <Separator className="separator" aria-label="Resize the sidebar" />
        <Panel id="work" minSize="30%">
          <Group
            orientation="vertical"
            defaultLayout={workLayout.defaultLayout}
            onLayoutChanged={workLayout.onLayoutChanged}
          >
            <Panel id="editor" defaultSize="60%" minSize="15%">
              <QueryEditor />
            </Panel>
            <Separator
              className="separator"
              aria-label="Resize the editor and the results"
            />
            <Panel id="results" minSize="15%">
              <ResultsPane />
            </Panel>
          </Group>
        </Panel>
        {showsAssistant && (
          <>
            <Separator
              className="separator"
              aria-label="Resize the assistant"
            />
            <Panel id="assistant" defaultSize="28%" minSize="15%">
              <AssistantPanel />
            </Panel>
          </>
        )}
      </Group>

      <StatusBar />
    </div>
  )
}

import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
} from 'react-resizable-panels'
import { useEffect, useState } from 'react'
import { ConnectionList } from '../connections/ConnectionList'
import { FileTree } from '../files/FileTree'
import { PreferencesDialog } from '../preferences/PreferencesDialog'
import { usePreferencesStore } from '../preferences/preferencesStore'
import { resetQueryStores } from '../query/queryStore'
import { persistTabs, useTabsStore } from '../tabs/tabsStore'
import { QueryEditor } from '../query/QueryEditor'
import { ResultsPane } from '../results/ResultsPane'
import { ThemeToggle } from '../theme/ThemeToggle'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { StatusBar } from './StatusBar'

const MAIN_LAYOUT_ID = 'tabloxide.layout.main'
const WORK_LAYOUT_ID = 'tabloxide.layout.work'

export function AppShell() {
  const mainLayout = useDefaultLayout({ id: MAIN_LAYOUT_ID })
  const workLayout = useDefaultLayout({ id: WORK_LAYOUT_ID })
  const workspaceName = useWorkspaceStore((state) => state.workspace?.name)
  const error = useWorkspaceStore((state) => state.error)
  const setError = useWorkspaceStore((state) => state.setError)
  const close = useWorkspaceStore((state) => state.close)
  const tabsError = useTabsStore((state) => state.error)
  const setTabsError = useTabsStore((state) => state.setError)
  const [showsPreferences, setShowsPreferences] = useState(false)

  // The tabs and the sessions belong to the workspace. They start and end with this screen.
  useEffect(() => {
    void usePreferencesStore.getState().load()
    void useTabsStore.getState().load()
    const stopPersist = persistTabs()
    return () => {
      stopPersist()
      useTabsStore.getState().reset()
      resetQueryStores()
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
            <FileTree />
            <ConnectionList />
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
      </Group>

      <StatusBar />
    </div>
  )
}

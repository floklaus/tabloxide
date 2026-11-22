import { SessionsPanel } from '../assistant/SessionsPanel'
import { ConnectionList } from '../connections/ConnectionList'
import { FileTree } from '../files/FileTree'
import { GitPanel } from '../git/GitPanel'
import { HistoryPanel } from '../history/HistoryPanel'
import { useResultsViewStore } from '../results/resultsViewStore'
import { SchemaTree } from '../schema/SchemaTree'
import { useShellStore } from './shellStore'

const LABELS = {
  files: 'Files',
  connections: 'Connections',
  schema: 'Schema',
  git: 'Git',
  history: 'History',
  sessions: 'Assistant sessions',
} as const

/** The view of the sidebar that the left tool strip selects. */
export function Sidebar() {
  const view = useShellStore((state) => state.sidebarView)
  return (
    <nav className="pane sidebar" aria-label={`Sidebar: ${LABELS[view]}`}>
      {view === 'files' && <FileTree />}
      {view === 'connections' && <ConnectionList />}
      {view === 'schema' && <SchemaTree />}
      {view === 'git' && <GitPanel />}
      {view === 'sessions' && <SessionsPanel />}
      {view === 'history' && (
        <HistoryPanel
          onRun={() => useResultsViewStore.getState().setView('results')}
        />
      )}
    </nav>
  )
}

import { useQuery } from '../query/queryStore'
import { useTabsStore } from '../tabs/tabsStore'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { useShellStore } from './shellStore'
import { useAppInfo, type AppInfoState } from './useAppInfo'

const NO_CONNECTIONS: never[] = []

function statusText(state: AppInfoState): string {
  switch (state.status) {
    case 'loading':
      return 'Connecting to the backend…'
    case 'ready':
      return `${state.info.name} ${state.info.version}`
    case 'error':
      return `Backend not available: ${state.message}`
  }
}

/** The connection of the active tab, the cursor position, and the version. */
export function StatusBar() {
  const state = useAppInfo()
  const connections = useWorkspaceStore(
    (store) => store.workspace?.connections ?? NO_CONNECTIONS,
  )
  const connectionId = useTabsStore(
    (store) =>
      store.tabs.find((tab) => tab.id === store.activeId)?.connectionId,
  )
  const session = useQuery((store) => store.session)
  const cursor = useShellStore((store) => store.cursor)
  const connection = connections.find((item) => item.id === connectionId)
  const server = session
    ? connection?.engine === 'duckdb'
      ? session.version
      : `PostgreSQL ${session.version}`
    : 'not connected'

  return (
    <footer className="status-bar">
      <span>
        {connection ? `${connection.name} · ${server}` : 'No connection'}
      </span>
      {cursor && (
        <span>
          Ln {cursor.line}, Col {cursor.column}
        </span>
      )}
      <span className="status-bar__spacer" />
      <span role="status">{statusText(state)}</span>
    </footer>
  )
}

import { useAppInfo, type AppInfoState } from './useAppInfo'

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

export function StatusBar() {
  const state = useAppInfo()

  return (
    <footer className="status-bar">
      <span role="status">{statusText(state)}</span>
    </footer>
  )
}

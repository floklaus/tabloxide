import { Icon, type IconName } from './icons'
import { useShellStore, type SidebarView } from './shellStore'

const VIEWS: { id: SidebarView; label: string; icon: IconName }[] = [
  { id: 'files', label: 'Files', icon: 'files' },
  { id: 'connections', label: 'Connections', icon: 'connections' },
  { id: 'schema', label: 'Schema', icon: 'schema' },
  { id: 'git', label: 'Git', icon: 'git' },
  { id: 'history', label: 'History', icon: 'history' },
]

/** The buttons of the sidebar views. A second click on the open view hides the sidebar. */
export function LeftToolStrip() {
  const view = useShellStore((state) => state.sidebarView)
  const isOpen = useShellStore((state) => state.panels.sidebar)
  const toggle = useShellStore((state) => state.toggleSidebarView)
  return (
    <nav className="tool-strip" aria-label="Left tool strip">
      {VIEWS.map((item) => (
        <button
          key={item.id}
          type="button"
          className="tool-strip__button"
          aria-label={item.label}
          title={item.label}
          aria-pressed={isOpen && view === item.id}
          onClick={() => toggle(item.id)}
        >
          <Icon name={item.icon} />
        </button>
      ))}
    </nav>
  )
}

/** The button of the assistant panel. */
export function RightToolStrip() {
  const isOpen = useShellStore((state) => state.panels.assistant)
  const toggle = useShellStore((state) => state.togglePanel)
  return (
    <nav className="tool-strip" aria-label="Right tool strip">
      <button
        type="button"
        className="tool-strip__button"
        aria-label="Assistant"
        title="Assistant (Ctrl+J)"
        aria-pressed={isOpen}
        onClick={() => toggle('assistant')}
      >
        <Icon name="assistant" />
      </button>
    </nav>
  )
}

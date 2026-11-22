import { useEffect, useState } from 'react'
import type { Engine, RecentWorkspaceInfo } from '../bindings'
import { relativeTime } from '../lib/relativeTime'
import { Icon, Logo } from '../shell/icons'
import { ShortcutsDialog } from '../help/ShortcutsDialog'
import { ThemeToggle } from '../theme/ThemeToggle'
import { CloneDialog } from './CloneDialog'
import { useWorkspaceStore } from './workspaceStore'

const ENGINE_LABELS: Record<Engine, string> = {
  postgres: 'PostgreSQL',
  duckdb: 'DuckDB',
}

/** The engines and the time of the last open, for example "PostgreSQL · 2 hours ago". */
function recentDetail(entry: RecentWorkspaceInfo): string {
  if (!entry.exists) return 'The folder does not exist'
  return [
    entry.engines.map((engine) => ENGINE_LABELS[engine]).join(', '),
    entry.opened_at == null ? null : relativeTime(entry.opened_at),
  ]
    .filter(Boolean)
    .join(' · ')
}

/** The start screen. It opens or clones a workspace. */
export function WelcomeScreen() {
  const recent = useWorkspaceStore((state) => state.recent)
  const error = useWorkspaceStore((state) => state.error)
  const openFolder = useWorkspaceStore((state) => state.openFolder)
  const openPath = useWorkspaceStore((state) => state.openPath)
  const [showsClone, setShowsClone] = useState(false)
  const [showsShortcuts, setShowsShortcuts] = useState(false)

  // Ctrl+O opens a folder, as in the File menu of a workspace. F1 shows the shortcuts.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F1' && !event.defaultPrevented) {
        event.preventDefault()
        setShowsShortcuts(true)
        return
      }
      const isModifier = event.ctrlKey || event.metaKey
      if (
        isModifier &&
        !event.shiftKey &&
        !event.altKey &&
        event.code === 'KeyO'
      ) {
        event.preventDefault()
        void useWorkspaceStore.getState().openFolder()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <main className="welcome">
      <div className="welcome__theme">
        <button
          type="button"
          className="button button--small"
          aria-keyshortcuts="F1"
          onClick={() => setShowsShortcuts(true)}
        >
          Keyboard shortcuts
        </button>
        <ThemeToggle />
      </div>
      {showsShortcuts && (
        <ShortcutsDialog onClose={() => setShowsShortcuts(false)} />
      )}
      <div className="welcome__intro">
        <h1 className="welcome__title">
          <Logo size={44} />
        </h1>
        <p className="welcome__text">
          A workspace is a folder that contains your SQL files and the
          connection definitions. Open a folder first. Then you can add
          connections, write SQL, and see the schema.
        </p>
      </div>
      <div className="welcome__actions">
        <button
          type="button"
          className="welcome__card welcome__card--primary"
          aria-keyshortcuts="Control+O"
          onClick={() => void openFolder()}
        >
          <Icon name="files" size={22} />
          <span className="welcome__card-title">Open folder…</span>
          <span className="welcome__card-detail">Ctrl+O</span>
        </button>
        <button
          type="button"
          className="welcome__card"
          onClick={() => setShowsClone(true)}
        >
          <Icon name="git" size={22} />
          <span className="welcome__card-title">Clone a repository…</span>
          <span className="welcome__card-detail">From a Git address</span>
        </button>
      </div>
      {showsClone && <CloneDialog onClose={() => setShowsClone(false)} />}
      {error && (
        <p className="message message--error welcome__error" role="alert">
          {error}
        </p>
      )}
      {recent.length > 0 && (
        <section className="welcome__recent" aria-labelledby="recent-title">
          <h2 id="recent-title" className="welcome__recent-title">
            Recent workspaces
          </h2>
          <ul className="recent-list">
            {recent.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  className="recent-list__item"
                  onClick={() => void openPath(entry.path)}
                >
                  <Icon name="files" />
                  <span className="recent-list__text">
                    <span className="recent-list__name">{entry.name}</span>
                    <span className="recent-list__path">{entry.path}</span>
                  </span>
                  <span
                    className={`recent-list__detail ${entry.exists ? '' : 'recent-list__detail--missing'}`}
                  >
                    {recentDetail(entry)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}

import { ThemeToggle } from '../theme/ThemeToggle'
import { useWorkspaceStore } from './workspaceStore'

export function WelcomeScreen() {
  const recent = useWorkspaceStore((state) => state.recent)
  const error = useWorkspaceStore((state) => state.error)
  const openFolder = useWorkspaceStore((state) => state.openFolder)
  const openPath = useWorkspaceStore((state) => state.openPath)

  return (
    <main className="welcome">
      <div className="welcome__theme">
        <ThemeToggle />
      </div>
      <h1 className="welcome__title">Tabloxide</h1>
      <p className="welcome__text">
        A workspace is a folder that contains your SQL files and the connection
        definitions.
      </p>
      <p className="welcome__text">
        Open a folder first. Then you can add connections, write SQL, and see
        the schema.
      </p>
      <button
        type="button"
        className="button button--primary"
        onClick={() => void openFolder()}
      >
        Open folder…
      </button>
      {error && (
        <p className="message message--error" role="alert">
          {error}
        </p>
      )}
      {recent.length > 0 && (
        <section className="welcome__recent" aria-labelledby="recent-title">
          <h2 id="recent-title" className="pane__title">
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
                  <span className="recent-list__name">{entry.name}</span>
                  <span className="recent-list__path">{entry.path}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}

import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
} from 'react-resizable-panels'
import { ThemeToggle } from '../theme/ThemeToggle'
import { StatusBar } from './StatusBar'

const MAIN_LAYOUT_ID = 'tabloxide.layout.main'
const WORK_LAYOUT_ID = 'tabloxide.layout.work'

export function AppShell() {
  const mainLayout = useDefaultLayout({ id: MAIN_LAYOUT_ID })
  const workLayout = useDefaultLayout({ id: WORK_LAYOUT_ID })

  return (
    <div className="app-shell">
      <header className="title-bar">
        <span className="title-bar__name">Tabloxide</span>
        <ThemeToggle />
      </header>

      <Group
        className="app-shell__panes"
        orientation="horizontal"
        defaultLayout={mainLayout.defaultLayout}
        onLayoutChanged={mainLayout.onLayoutChanged}
      >
        <Panel id="sidebar" defaultSize="20%" minSize="12%" collapsible>
          <nav className="pane" aria-label="Sidebar">
            <h2 className="pane__title">Sidebar</h2>
            <p className="pane__hint">
              Connections, schema, and files show here.
            </p>
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
              <section className="pane" aria-label="Editor">
                <h2 className="pane__title">Editor</h2>
                <p className="pane__hint">The SQL editor shows here.</p>
              </section>
            </Panel>
            <Separator
              className="separator"
              aria-label="Resize the editor and the results"
            />
            <Panel id="results" minSize="15%">
              <section className="pane" aria-label="Results">
                <h2 className="pane__title">Results</h2>
                <p className="pane__hint">Query results show here.</p>
              </section>
            </Panel>
          </Group>
        </Panel>
      </Group>

      <StatusBar />
    </div>
  )
}

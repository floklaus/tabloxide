import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
} from 'react-resizable-panels'
import { useEffect } from 'react'
import { AssistantPanel } from '../assistant/AssistantPanel'
import { useAssistantStore } from '../assistant/assistantStore'
import { resetCatalogs } from '../completion/catalogCache'
import { useGitStore } from '../git/gitStore'
import { usePlanStore } from '../plan/planStore'
import { PreferencesDialog } from '../preferences/PreferencesDialog'
import { usePreferencesStore } from '../preferences/preferencesStore'
import { QueryEditor } from '../query/QueryEditor'
import { resetQueryStores } from '../query/queryStore'
import { RunConfirmDialog } from '../query/RunConfirmDialog'
import { ResultsPane } from '../results/ResultsPane'
import { useResultsViewStore } from '../results/resultsViewStore'
import { useSchemaStore } from '../schema/schemaStore'
import { invalidateSnippets } from '../snippets/snippets'
import { persistTabs, useTabsStore } from '../tabs/tabsStore'
import { ShortcutsDialog } from '../help/ShortcutsDialog'
import { CloneDialog } from '../workspace/CloneDialog'
import { startWorkspaceWatch } from '../workspace/watch'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { buildCommands } from './commands'
import { ConnectionEditor } from './ConnectionEditor'
import { Icon, Logo } from './icons'
import { MenuBar } from './menu/MenuBar'
import { buildMenus } from './menus'
import { CommandPalette } from './palette/CommandPalette'
import { applyZoom, useShellStore } from './shellStore'
import { handleShortcut } from './shortcuts'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { BranchWidget, ConnectionWidget, ProjectWidget } from './TitleWidgets'
import { LeftToolStrip, RightToolStrip } from './ToolStrip'

const MAIN_LAYOUT_ID = 'tabloxide.layout.main'
const WORK_LAYOUT_ID = 'tabloxide.layout.work'

/** The messages of the workspace and of the tabs. */
function Banners() {
  const error = useWorkspaceStore((state) => state.error)
  const setError = useWorkspaceStore((state) => state.setError)
  const tabsError = useTabsStore((state) => state.error)
  const setTabsError = useTabsStore((state) => state.setError)
  return (
    <>
      {[
        { text: error, dismiss: () => setError(null) },
        { text: tabsError, dismiss: () => setTabsError(null) },
      ]
        .filter((banner) => banner.text)
        .map((banner) => (
          <div key={banner.text} className="banner" role="alert">
            <span>{banner.text}</span>
            <button
              type="button"
              className="link-button"
              onClick={banner.dismiss}
            >
              Dismiss
            </button>
          </div>
        ))}
    </>
  )
}

/** The dialogs that the menus, the palette, and the shortcuts open. */
function Dialogs() {
  const dialog = useShellStore((state) => state.dialog)
  const close = useShellStore((state) => state.closeDialog)
  return (
    <>
      <RunConfirmDialog />
      {dialog === 'preferences' && <PreferencesDialog onClose={close} />}
      {dialog === 'clone' && <CloneDialog onClose={close} />}
      {dialog === 'palette' && <CommandPalette />}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={close} />}
      <ConnectionEditor />
    </>
  )
}

function TitleBar() {
  const openDialog = useShellStore((state) => state.openDialog)
  return (
    <header className="title-bar">
      <Logo />
      <MenuBar buildMenus={buildMenus} />
      <span className="title-bar__divider" aria-hidden="true" />
      <ProjectWidget />
      <ConnectionWidget />
      <BranchWidget />
      <span className="title-bar__spacer" />
      <button
        type="button"
        className="palette-button"
        aria-keyshortcuts="Control+K"
        onClick={() => openDialog('palette')}
      >
        <Icon name="search" size={16} />
        <span className="palette-button__text">Search or run a command</span>
        <kbd className="palette-button__key">Ctrl+K</kbd>
      </button>
    </header>
  )
}

/** The editor and the results, below or beside each other. */
function Work() {
  const position = useShellStore((state) => state.resultsPosition)
  const showsResults = useShellStore((state) => state.panels.results)
  const layout = useDefaultLayout({
    id: `${WORK_LAYOUT_ID}.${position}`,
    panelIds: showsResults ? ['editor', 'results'] : ['editor'],
  })
  return (
    <Group
      key={position}
      orientation={position === 'below' ? 'vertical' : 'horizontal'}
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
    >
      <Panel id="editor" defaultSize="60%" minSize="15%">
        <QueryEditor />
      </Panel>
      {showsResults && (
        <>
          <Separator
            className="separator"
            aria-label="Resize the editor and the results"
          />
          <Panel id="results" minSize="15%">
            <ResultsPane />
          </Panel>
        </>
      )}
    </Group>
  )
}

/** Loads the data of the workspace, and resets it when the workspace closes. */
function useWorkspaceLifetime() {
  useEffect(() => {
    void usePreferencesStore.getState().load()
    void useTabsStore.getState().load()
    // The branch widget of the title bar needs the Git state.
    void useGitStore.getState().refresh()
    const stopPersist = persistTabs()
    // Without the watch, the application shows external changes only after a refresh.
    void startWorkspaceWatch().then((message) => {
      if (message) useWorkspaceStore.getState().setError(message)
    })
    return () => {
      stopPersist()
      useTabsStore.getState().reset()
      resetQueryStores()
      resetCatalogs()
      invalidateSnippets()
      usePlanStore.getState().reset()
      useSchemaStore.getState().reset()
      useGitStore.getState().reset()
      useAssistantStore.getState().reset()
      useResultsViewStore.getState().setView('results')
      useShellStore.getState().closeDialog()
      useShellStore.getState().editConnection(null)
    }
  }, [])

  useEffect(() => {
    applyZoom(useShellStore.getState().zoom)
    const onKeyDown = (event: KeyboardEvent) =>
      handleShortcut(event, buildCommands())
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

export function AppShell() {
  const panels = useShellStore((state) => state.panels)
  const mainLayout = useDefaultLayout({
    id: MAIN_LAYOUT_ID,
    panelIds: [
      ...(panels.sidebar ? ['sidebar'] : []),
      'work',
      ...(panels.assistant ? ['assistant'] : []),
    ],
  })
  useWorkspaceLifetime()

  return (
    <div className="app-shell">
      <TitleBar />
      <Banners />
      <Dialogs />
      <div className="app-shell__body">
        <LeftToolStrip />
        <Group
          className="app-shell__panes"
          orientation="horizontal"
          defaultLayout={mainLayout.defaultLayout}
          onLayoutChanged={mainLayout.onLayoutChanged}
        >
          {panels.sidebar && (
            <>
              <Panel id="sidebar" defaultSize="20%" minSize="12%">
                <Sidebar />
              </Panel>
              <Separator
                className="separator"
                aria-label="Resize the sidebar"
              />
            </>
          )}
          <Panel id="work" minSize="30%">
            <Work />
          </Panel>
          {panels.assistant && (
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
        <RightToolStrip />
      </div>
      {panels.statusBar && <StatusBar />}
    </div>
  )
}

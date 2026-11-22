import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
} from 'react-resizable-panels'
import { useEffect, useId, useState } from 'react'
import { AssistantPanel } from '../assistant/AssistantPanel'
import { useAssistantStore } from '../assistant/assistantStore'
import { resetCatalogs } from '../completion/catalogCache'
import { useGitStore } from '../git/gitStore'
import { usePlanStore } from '../plan/planStore'
import { PreferencesDialog } from '../preferences/PreferencesDialog'
import { usePreferencesStore } from '../preferences/preferencesStore'
import { QueryEditor } from '../query/QueryEditor'
import { resetQueryStores, useQuery } from '../query/queryStore'
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
import { LayoutEditor } from './layout/LayoutEditor'
import { MenuBar } from './menu/MenuBar'
import { buildMenus } from './menus'
import { CommandPalette } from './palette/CommandPalette'
import { applyDensity, applyZoom, useShellStore } from './shellStore'
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
      {dialog === 'layout' && <LayoutEditor onClose={close} />}
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

/**
 * The editor and the results as two tabs of one card. After a run, the results tab
 * opens. The two panes stay in the page, thus the editor keeps its state.
 */
function TabbedWork() {
  const [view, setView] = useState<'editor' | 'results'>('editor')
  const statements = useQuery((state) => state.statements)
  // A new result opens the results tab. React permits this state change in the render.
  const [seen, setSeen] = useState(statements)
  if (statements !== seen) {
    setSeen(statements)
    if (statements.length > 0) setView('results')
  }
  const tabs = [
    { id: 'editor', label: 'SQL editor' },
    { id: 'results', label: 'Results' },
  ] as const
  const baseId = useId()

  return (
    <div className="work-tabs">
      <div
        className="work-tabs__list"
        role="tablist"
        aria-label="Editor or results"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${baseId}-${tab.id}`}
            aria-controls={`${baseId}-${tab.id}-panel`}
            aria-selected={view === tab.id}
            className="results__view"
            onClick={() => setView(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`${baseId}-${tab.id}-panel`}
          role="tabpanel"
          aria-labelledby={`${baseId}-${tab.id}`}
          className="work-tabs__panel"
          hidden={view !== tab.id}
        >
          {tab.id === 'editor' ? <QueryEditor /> : <ResultsPane />}
        </div>
      ))}
    </div>
  )
}

/** The column of the editor, with the results and the assistant below it if the layout says so. */
function EditorColumn() {
  const panels = useShellStore((state) => state.panels)
  const position = useShellStore((state) => state.resultsPosition)
  const assistantPlacement = useShellStore((state) => state.assistantPlacement)
  const editorSize = useShellStore((state) => state.editorSize)
  const showsTabs = panels.results && position === 'tab'
  const showsResults = panels.results && position === 'below'
  const showsAssistant =
    panels.assistant && assistantPlacement === 'below-editor'
  const layout = useDefaultLayout({
    id: `${WORK_LAYOUT_ID}.column.${editorSize}`,
    panelIds: [
      'editor',
      ...(showsResults ? ['results'] : []),
      ...(showsAssistant ? ['assistant'] : []),
    ],
  })
  return (
    <Group
      key={editorSize}
      orientation="vertical"
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
    >
      <Panel id="editor" defaultSize={`${editorSize}%`} minSize="15%">
        {showsTabs ? <TabbedWork /> : <QueryEditor />}
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
      {showsAssistant && (
        <>
          <Separator className="separator" aria-label="Resize the assistant" />
          <Panel id="assistant" minSize="15%">
            <AssistantPanel />
          </Panel>
        </>
      )}
    </Group>
  )
}

/** The editor column, and the results beside it if the layout says so. */
function Work() {
  const showsBeside = useShellStore(
    (state) => state.panels.results && state.resultsPosition === 'beside',
  )
  const layout = useDefaultLayout({
    id: `${WORK_LAYOUT_ID}.beside`,
    panelIds: showsBeside ? ['column', 'results'] : ['column'],
  })
  if (!showsBeside) return <EditorColumn />
  return (
    <Group
      orientation="horizontal"
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
    >
      <Panel id="column" defaultSize="55%" minSize="25%">
        <EditorColumn />
      </Panel>
      <Separator
        className="separator"
        aria-label="Resize the editor and the results"
      />
      <Panel id="results" minSize="20%">
        <ResultsPane />
      </Panel>
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
    applyDensity(useShellStore.getState().density)
    const onKeyDown = (event: KeyboardEvent) =>
      handleShortcut(event, buildCommands())
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

function SidebarPanel({ side }: { side: 'left' | 'right' }) {
  const width = useShellStore((state) => state.sidebarWidth)
  const separator = (
    <Separator className="separator" aria-label="Resize the sidebar" />
  )
  return (
    <>
      {side === 'right' && separator}
      <Panel id="sidebar" defaultSize={`${width}px`} minSize="160px">
        <Sidebar />
      </Panel>
      {side === 'left' && separator}
    </>
  )
}

export function AppShell() {
  const panels = useShellStore((state) => state.panels)
  const side = useShellStore((state) => state.sidebarSide)
  const sidebarWidth = useShellStore((state) => state.sidebarWidth)
  const assistantPlacement = useShellStore((state) => state.assistantPlacement)
  const showsAssistant = panels.assistant && assistantPlacement === 'right'
  const mainLayout = useDefaultLayout({
    id: `${MAIN_LAYOUT_ID}.${sidebarWidth}`,
    panelIds: [
      ...(panels.sidebar && side === 'left' ? ['sidebar'] : []),
      'work',
      ...(showsAssistant ? ['assistant'] : []),
      ...(panels.sidebar && side === 'right' ? ['sidebar'] : []),
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
          key={sidebarWidth}
          className="app-shell__panes"
          orientation="horizontal"
          defaultLayout={mainLayout.defaultLayout}
          onLayoutChanged={mainLayout.onLayoutChanged}
        >
          {panels.sidebar && side === 'left' && <SidebarPanel side="left" />}
          <Panel id="work" minSize="30%">
            <Work />
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
          {panels.sidebar && side === 'right' && <SidebarPanel side="right" />}
        </Group>
        <RightToolStrip />
      </div>
      {panels.statusBar && <StatusBar />}
    </div>
  )
}

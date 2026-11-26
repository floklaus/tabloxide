import { engineLanguage, findEngine } from '../engines/engineStore'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { commands as backend } from '../bindings'
import { explainSelection, useInlineChange } from '../assistant/inlineChange'
import { invalidateCatalog } from '../completion/catalogCache'
import { useConnectionStore } from '../connections/connectionStore'
import { activeEditor } from '../editor/editorBridge'
import { useGitStore } from '../git/gitStore'
import { toMessage } from '../lib/errors'
import { usePlanStore } from '../plan/planStore'
import { activeQueryStore } from '../query/queryStore'
import { requestRun } from '../query/runConfirm'
import { useResultsViewStore } from '../results/resultsViewStore'
import { useSchemaStore } from '../schema/schemaStore'
import { isDirty, sqlTabForTools, useTabsStore } from '../tabs/tabsStore'
import { useThemeStore } from '../theme/themeStore'
import { THEME_LABELS, THEMES } from '../theme/theme'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { useShellStore } from './shellStore'

/** A function of the application that a menu, the palette, or a shortcut runs. */
export type Command = {
  id: string
  label: string
  /** The menu of the command. The palette shows it as the group. */
  group: 'File' | 'Connections' | 'Git' | 'View' | 'Query' | 'Help'
  /** The key combination, for example `Ctrl+Shift+N`. `Ctrl` is `Cmd` on macOS. */
  shortcut?: string
  /** `false` if the command cannot run now. */
  isEnabled: () => boolean
  run: () => void | Promise<void>
}

const shell = () => useShellStore.getState()

/** The SQL tab of the commands. While an assistant tab is active, it is the last SQL tab. */
function activeTab() {
  return sqlTabForTools()
}

/** The connection of the active tab. */
export function activeConnection() {
  const id = activeTab()?.connectionId
  return useWorkspaceStore
    .getState()
    .workspace?.connections.find((connection) => connection.id === id)
}

const report = (error: unknown) =>
  useWorkspaceStore.getState().setError(toMessage(error))

const hasRepository = () =>
  useGitStore.getState().overview?.state === 'repository'

async function openFile(): Promise<void> {
  const selected = await openDialog({
    directory: false,
    multiple: false,
    filters: [{ name: 'SQL', extensions: ['sql'] }],
  })
  if (typeof selected !== 'string') return
  const relative = await backend.fileRelativePath(selected)
  if (relative.status === 'error') {
    useWorkspaceStore.getState().setError(relative.error.message)
    return
  }
  await useTabsStore.getState().openFile(relative.data)
}

async function saveAll(): Promise<void> {
  const { tabs, save } = useTabsStore.getState()
  for (const tab of tabs.filter(
    (item) => item.path !== null && isDirty(item),
  )) {
    await save(tab.id)
  }
}

/** Opens the connection form for a new connection. */
export async function newConnection(): Promise<void> {
  try {
    const profile = await backend.connectionTemplate()
    shell().editConnection({ profile, isNew: true })
  } catch (error) {
    report(error)
  }
}

/** Sets the connection of the active tab and connects. `null` disconnects. */
export function switchConnection(connectionId: string | null): void {
  const tab = activeTab()
  if (!tab) return
  useTabsStore.getState().setConnection(tab.id, connectionId)
  const query = activeQueryStore().getState()
  void (connectionId ? query.connect(connectionId) : query.disconnect())
}

function runTarget(all: boolean) {
  const tab = activeTab()
  if (!tab) return
  const target = all
    ? ({ type: 'all' } as const)
    : (activeEditor()?.getTarget() ?? ({ type: 'all' } as const))
  void requestRun(tab.content, target)
}

async function toggleFullScreen(): Promise<void> {
  const window = getCurrentWindow()
  await window.setFullscreen(!(await window.isFullscreen()))
}

const canRun = () =>
  activeConnection() !== undefined &&
  activeQueryStore().getState().runState === 'idle'

/** Returns all commands. The functions read the stores when they run. */
export function buildCommands(): Command[] {
  const always = () => true
  const hasTab = () => activeTab() !== undefined
  const hasConnection = () => activeConnection() !== undefined
  // The plan tree reads the JSON of EXPLAIN. Thus it is only for the SQL engines.
  // A connector engine with plans gives them to the assistant only.
  const canExplain = () => {
    const engine = findEngine(activeConnection()?.engine ?? 'postgres')
    return (
      canRun() &&
      engine?.info.language === 'sql' &&
      engine.info.capabilities.explainPlan
    )
  }
  const commands: Command[] = [
    // File
    {
      id: 'file.new-tab',
      label: 'New query tab',
      group: 'File',
      shortcut: 'Ctrl+T',
      isEnabled: always,
      run: () => void useTabsStore.getState().newTab(),
    },
    {
      id: 'file.open',
      label: 'Open file…',
      group: 'File',
      shortcut: 'Ctrl+O',
      isEnabled: always,
      run: () => openFile().catch(report),
    },
    {
      id: 'file.save',
      label: 'Save',
      group: 'File',
      shortcut: 'Ctrl+S',
      isEnabled: () => {
        const tab = activeTab()
        return tab !== undefined && isDirty(tab)
      },
      run: () => {
        const tab = activeTab()
        if (tab) void useTabsStore.getState().save(tab.id)
      },
    },
    {
      id: 'file.save-all',
      label: 'Save all',
      group: 'File',
      shortcut: 'Ctrl+Alt+S',
      isEnabled: () =>
        useTabsStore
          .getState()
          .tabs.some((tab) => tab.path !== null && isDirty(tab)),
      run: () => saveAll().catch(report),
    },
    {
      id: 'file.export-csv',
      label: 'Export the result as CSV…',
      group: 'File',
      isEnabled: () => activeQueryStore().getState().statements.length > 0,
      run: () => {
        const query = activeQueryStore().getState()
        void query.exportCsv(query.selected)
      },
    },
    {
      id: 'file.open-workspace',
      label: 'Open workspace…',
      group: 'File',
      isEnabled: always,
      run: () => void useWorkspaceStore.getState().openFolder(),
    },
    {
      id: 'file.close-workspace',
      label: 'Close workspace',
      group: 'File',
      isEnabled: always,
      run: () => void useWorkspaceStore.getState().close(),
    },
    {
      id: 'file.preferences',
      label: 'Preferences…',
      group: 'File',
      shortcut: 'Ctrl+,',
      isEnabled: always,
      run: () => shell().openDialog('preferences'),
    },
    {
      id: 'file.quit',
      label: 'Quit',
      group: 'File',
      shortcut: 'Ctrl+Q',
      isEnabled: always,
      run: () => getCurrentWindow().close().catch(report),
    },
    // Query
    {
      id: 'query.run',
      label: 'Run the statement at the cursor',
      group: 'Query',
      shortcut: 'Ctrl+Enter',
      isEnabled: canRun,
      run: () => runTarget(false),
    },
    {
      id: 'query.run-all',
      label: 'Run all statements',
      group: 'Query',
      shortcut: 'Ctrl+Shift+Enter',
      isEnabled: canRun,
      run: () => runTarget(true),
    },
    {
      id: 'query.explain',
      label: 'Explain the statement at the cursor',
      group: 'Query',
      isEnabled: canExplain,
      run: () => usePlanStore.getState().read(false),
    },
    {
      id: 'query.explain-analyze',
      label: 'Explain analyze the statement at the cursor',
      group: 'Query',
      isEnabled: canExplain,
      run: () => usePlanStore.getState().read(true),
    },
    {
      id: 'query.ai-change',
      label: 'Change the selection with AI…',
      group: 'Query',
      shortcut: 'Ctrl+I',
      isEnabled: hasTab,
      run: () => useInlineChange.getState().start(),
    },
    {
      id: 'query.ai-explain',
      label: 'Explain the selection with AI',
      group: 'Query',
      shortcut: 'Ctrl+Shift+I',
      isEnabled: hasTab,
      run: explainSelection,
    },
    {
      id: 'query.format',
      label: 'Format the SQL',
      group: 'Query',
      shortcut: 'Shift+Alt+F',
      isEnabled: () =>
        hasTab() &&
        engineLanguage(activeConnection()?.engine ?? 'postgres') === 'sql',
      run: () => activeEditor()?.format(),
    },
    // Connections
    {
      id: 'connections.new',
      label: 'New connection…',
      group: 'Connections',
      shortcut: 'Ctrl+Shift+N',
      isEnabled: always,
      run: newConnection,
    },
    {
      id: 'connections.edit',
      label: 'Edit connection…',
      group: 'Connections',
      isEnabled: hasConnection,
      run: () => {
        const profile = activeConnection()
        if (profile) shell().editConnection({ profile, isNew: false })
      },
    },
    {
      id: 'connections.duplicate',
      label: 'Duplicate connection',
      group: 'Connections',
      isEnabled: hasConnection,
      run: () => {
        const profile = activeConnection()
        if (profile) void useConnectionStore.getState().duplicate(profile.id)
      },
    },
    {
      id: 'connections.connect',
      label: 'Connect',
      group: 'Connections',
      isEnabled: () =>
        hasConnection() && !activeQueryStore().getState().session,
      run: () => {
        const profile = activeConnection()
        if (profile) void activeQueryStore().getState().connect(profile.id)
      },
    },
    {
      id: 'connections.disconnect',
      label: 'Disconnect',
      group: 'Connections',
      isEnabled: () => activeQueryStore().getState().session !== null,
      run: () => void activeQueryStore().getState().disconnect(),
    },
    {
      id: 'connections.refresh-schema',
      label: 'Read the schema again',
      group: 'Connections',
      shortcut: 'F5',
      isEnabled: hasConnection,
      run: () => {
        const profile = activeConnection()
        if (profile) invalidateCatalog(profile.id)
        void useSchemaStore.getState().refresh()
      },
    },
    {
      id: 'connections.test',
      label: 'Test connection',
      group: 'Connections',
      isEnabled: hasConnection,
      run: () => {
        const profile = activeConnection()
        if (!profile) return
        shell().showSidebar('connections')
        void useConnectionStore.getState().test(profile)
      },
    },
    {
      id: 'connections.manage',
      label: 'Manage connections…',
      group: 'Connections',
      isEnabled: always,
      run: () => shell().showSidebar('connections'),
    },
    // Git
    {
      id: 'git.commit',
      label: 'Commit…',
      group: 'Git',
      isEnabled: hasRepository,
      run: () => shell().showSidebar('git'),
    },
    {
      id: 'git.push',
      label: 'Push',
      group: 'Git',
      shortcut: 'Ctrl+Shift+K',
      isEnabled: hasRepository,
      run: () => useGitStore.getState().push(),
    },
    {
      id: 'git.pull',
      label: 'Pull',
      group: 'Git',
      isEnabled: hasRepository,
      run: () => useGitStore.getState().pull(),
    },
    {
      id: 'git.fetch',
      label: 'Fetch',
      group: 'Git',
      isEnabled: hasRepository,
      run: () => useGitStore.getState().fetch(),
    },
    {
      id: 'git.changes',
      label: 'Show changes',
      group: 'Git',
      shortcut: 'Ctrl+D',
      isEnabled: always,
      run: () => shell().showSidebar('git'),
    },
    {
      id: 'git.clone',
      label: 'Clone repository…',
      group: 'Git',
      isEnabled: always,
      run: () => shell().openDialog('clone'),
    },
    {
      id: 'git.init',
      label: 'Initialize repository',
      group: 'Git',
      isEnabled: () =>
        useGitStore.getState().overview?.state === 'no-repository',
      run: () => useGitStore.getState().init(),
    },
    // Help
    {
      id: 'help.palette',
      label: 'Search or run a command',
      group: 'Help',
      shortcut: 'Ctrl+K',
      isEnabled: always,
      run: () => shell().openDialog('palette'),
    },
    {
      id: 'help.shortcuts',
      label: 'Keyboard shortcuts',
      group: 'Help',
      shortcut: 'F1',
      isEnabled: always,
      run: () => shell().openDialog('shortcuts'),
    },
    // View
    {
      id: 'view.sidebar',
      label: 'Show or hide the sidebar',
      group: 'View',
      shortcut: 'Ctrl+B',
      isEnabled: always,
      run: () => shell().togglePanel('sidebar'),
    },
    {
      id: 'view.assistant',
      label: 'Show or hide the assistant',
      group: 'View',
      shortcut: 'Ctrl+J',
      isEnabled: always,
      run: () => shell().togglePanel('assistant'),
    },
    {
      id: 'view.results',
      label: 'Show or hide the results',
      group: 'View',
      shortcut: 'Ctrl+R',
      isEnabled: always,
      run: () => shell().togglePanel('results'),
    },
    {
      id: 'view.git-console',
      label: 'Show the Git console',
      group: 'View',
      shortcut: 'Ctrl+`',
      isEnabled: () => useWorkspaceStore.getState().workspace !== null,
      run: () => {
        if (!shell().panels.results) shell().togglePanel('results')
        useResultsViewStore.getState().setView('console')
      },
    },
    {
      id: 'view.status-bar',
      label: 'Show or hide the status bar',
      group: 'View',
      isEnabled: always,
      run: () => shell().togglePanel('statusBar'),
    },
    {
      id: 'view.layout-standard',
      label: 'Layout: Standard',
      group: 'View',
      isEnabled: always,
      run: () => shell().applyLayout('standard'),
    },
    {
      id: 'view.layout-simple',
      label: 'Layout: Simple',
      group: 'View',
      isEnabled: always,
      run: () => shell().applyLayout('simple'),
    },
    {
      id: 'view.layout-edit',
      label: 'Edit layout…',
      group: 'View',
      isEnabled: always,
      run: () => shell().openDialog('layout'),
    },
    ...shell().customLayouts.map((layout): Command => ({
      id: `view.layout-${layout.id}`,
      label: `Layout: ${layout.name}`,
      group: 'View',
      isEnabled: always,
      run: () => shell().applyLayout(layout.id),
    })),
    {
      id: 'view.results-tab',
      label: 'Results as a tab in the editor',
      group: 'View',
      isEnabled: always,
      run: () => shell().setResultsPosition('tab'),
    },
    {
      id: 'view.results-below',
      label: 'Results below the editor',
      group: 'View',
      isEnabled: always,
      run: () => shell().setResultsPosition('below'),
    },
    {
      id: 'view.results-beside',
      label: 'Results beside the editor',
      group: 'View',
      isEnabled: always,
      run: () => shell().setResultsPosition('beside'),
    },
    {
      id: 'view.zoom-in',
      label: 'Zoom in',
      group: 'View',
      shortcut: 'Ctrl+=',
      isEnabled: always,
      run: () => shell().zoomIn(),
    },
    {
      id: 'view.zoom-out',
      label: 'Zoom out',
      group: 'View',
      shortcut: 'Ctrl+-',
      isEnabled: always,
      run: () => shell().zoomOut(),
    },
    {
      id: 'view.zoom-reset',
      label: 'Reset zoom',
      group: 'View',
      shortcut: 'Ctrl+0',
      isEnabled: always,
      run: () => shell().resetZoom(),
    },
    {
      id: 'view.full-screen',
      label: 'Full screen',
      group: 'View',
      shortcut: 'F11',
      isEnabled: always,
      run: () => toggleFullScreen().catch(report),
    },
    ...THEMES.map((theme): Command => ({
      id: `view.theme-${theme}`,
      label: `Theme: ${THEME_LABELS[theme]}`,
      group: 'View',
      isEnabled: always,
      run: () => useThemeStore.getState().setTheme(theme),
    })),
  ]
  return commands
}

/** Returns the command with `id`. Throws an error for an unknown identifier. */
export function commandById(commands: Command[], id: string): Command {
  const command = commands.find((item) => item.id === id)
  if (!command) throw new Error(`Unknown command: ${id}`)
  return command
}

import type { Environment } from '../bindings'
import { useConnectionStore } from '../connections/connectionStore'
import { useGitStore } from '../git/gitStore'
import { useThemeStore } from '../theme/themeStore'
import { THEME_LABELS, THEMES } from '../theme/theme'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import {
  activeConnection,
  buildCommands,
  commandById,
  switchConnection,
  type Command,
} from './commands'
import { tidy, type Menu, type MenuItem } from './menu/menuModel'
import {
  BUILT_IN_LAYOUTS,
  describeSettings,
  type SavedLayout,
} from './layout/layoutModel'
import { saveCurrentLayout } from './layout/layoutActions'
import { useShellStore } from './shellStore'

const ENVIRONMENTS: { value: Environment; label: string }[] = [
  { value: 'development', label: 'Development' },
  { value: 'staging', label: 'Staging' },
  { value: 'production', label: 'Production' },
]

const ENGINE_LABELS = { postgres: 'PostgreSQL', duckdb: 'DuckDB' } as const

function action(command: Command): MenuItem {
  return {
    kind: 'action',
    label: command.label,
    shortcut: command.shortcut,
    disabled: !command.isEnabled(),
    run: () => void command.run(),
  }
}

const separator: MenuItem = { kind: 'separator' }

/** The connections of the workspace as radio items, grouped by environment. */
export function connectionItems(filter = ''): MenuItem[] {
  const connections = useWorkspaceStore.getState().workspace?.connections ?? []
  const current = activeConnection()?.id
  const needle = filter.trim().toLowerCase()
  return ENVIRONMENTS.flatMap(({ value, label }) => {
    const matching = connections.filter(
      (connection) =>
        connection.environment === value &&
        connection.name.toLowerCase().includes(needle),
    )
    if (matching.length === 0) return []
    return [
      { kind: 'heading', label } as MenuItem,
      ...matching.map((connection): MenuItem => ({
        kind: 'radio',
        label: connection.name,
        detail: ENGINE_LABELS[connection.engine ?? 'postgres'],
        checked: connection.id === current,
        run: () => switchConnection(connection.id),
      })),
    ]
  })
}

/** The local branches as radio items. */
export function branchItems(): MenuItem[] {
  const overview = useGitStore.getState().overview
  if (overview?.state !== 'repository') return []
  return overview.branches.map((branch) => ({
    kind: 'radio',
    label: branch.name,
    checked: branch.is_current,
    run: () => void useGitStore.getState().switchBranch(branch.name),
  }))
}

/** The recent workspaces as radio items. */
export function recentItems(): MenuItem[] {
  const { recent, workspace, openPath } = useWorkspaceStore.getState()
  return recent.map((entry) => ({
    kind: 'radio',
    label: entry.name,
    detail: entry.path,
    checked: entry.path === workspace?.path,
    run: () => void openPath(entry.path),
  }))
}

function environmentItems(): MenuItem[] {
  const profile = activeConnection()
  if (!profile) return []
  return ENVIRONMENTS.map(({ value, label }) => ({
    kind: 'radio',
    label,
    checked: profile.environment === value,
    run: () =>
      void useConnectionStore
        .getState()
        .save({ ...profile, environment: value }, null),
  }))
}

/** The layouts as radio items, and the layout actions. */
export function layoutItems(): MenuItem[] {
  const shell = useShellStore.getState()
  const radio = (layout: SavedLayout): MenuItem => ({
    kind: 'radio',
    label: layout.name,
    detail: describeSettings(layout.settings),
    checked: shell.layoutId === layout.id,
    run: () => shell.applyLayout(layout.id),
  })
  return tidy([
    { kind: 'heading', label: 'Built in' },
    ...BUILT_IN_LAYOUTS.map(radio),
    separator,
    ...(shell.customLayouts.length > 0
      ? [
          { kind: 'heading', label: 'Custom' } as MenuItem,
          ...shell.customLayouts.map(radio),
        ]
      : []),
    separator,
    {
      kind: 'action',
      label: 'Edit layout…',
      run: () => shell.openDialog('layout'),
    },
    {
      kind: 'action',
      label: 'Save current layout as…',
      run: () => saveCurrentLayout(),
    },
  ])
}

/** Returns the menus of the menu bar with the current state of each item. */
export function buildMenus(): Menu[] {
  const commands = buildCommands()
  const item = (id: string) => action(commandById(commands, id))
  const shell = useShellStore.getState()
  const recent = recentItems()
  const branches = branchItems()
  const connections = connectionItems()
  const environments = environmentItems()
  const check = (
    label: string,
    panel: keyof typeof shell.panels,
    commandId: string,
  ): MenuItem => ({
    kind: 'check',
    label,
    shortcut: commandById(commands, commandId).shortcut,
    checked: shell.panels[panel],
    run: () => shell.togglePanel(panel),
  })
  const theme = useThemeStore.getState().theme

  return [
    {
      label: 'File',
      items: tidy([
        item('file.new-tab'),
        item('file.open'),
        {
          kind: 'submenu',
          label: 'Open recent',
          items: recent,
          disabled: recent.length === 0,
        },
        separator,
        item('file.save'),
        item('file.save-all'),
        separator,
        item('file.export-csv'),
        separator,
        item('file.open-workspace'),
        item('file.close-workspace'),
        separator,
        item('file.preferences'),
        separator,
        item('file.quit'),
      ]),
    },
    {
      label: 'Connections',
      items: tidy([
        item('connections.new'),
        item('connections.edit'),
        item('connections.duplicate'),
        separator,
        item('connections.connect'),
        item('connections.disconnect'),
        {
          kind: 'submenu',
          label: 'Switch connection',
          items: connections,
          disabled: connections.length === 0,
        },
        separator,
        item('connections.refresh-schema'),
        item('connections.test'),
        {
          kind: 'submenu',
          label: 'Set environment',
          items: environments,
          disabled: environments.length === 0,
        },
        separator,
        item('connections.manage'),
      ]),
    },
    {
      label: 'Git',
      items: tidy([
        item('git.commit'),
        item('git.push'),
        item('git.pull'),
        item('git.fetch'),
        separator,
        {
          kind: 'submenu',
          label: 'Branch',
          items: branches,
          disabled: branches.length === 0,
        },
        item('git.changes'),
        separator,
        item('git.clone'),
        item('git.init'),
      ]),
    },
    {
      label: 'View',
      items: tidy([
        { kind: 'submenu', label: 'Layout', items: layoutItems() },
        separator,
        { kind: 'heading', label: 'Panels' },
        check('Sidebar', 'sidebar', 'view.sidebar'),
        check('Assistant', 'assistant', 'view.assistant'),
        check('Results', 'results', 'view.results'),
        check('Status bar', 'statusBar', 'view.status-bar'),
        separator,
        {
          kind: 'submenu',
          label: 'Density',
          items: [
            {
              kind: 'radio',
              label: 'Comfortable',
              checked: shell.density === 'comfortable',
              run: () => shell.setDensity('comfortable'),
            },
            {
              kind: 'radio',
              label: 'Compact',
              checked: shell.density === 'compact',
              run: () => shell.setDensity('compact'),
            },
          ],
        },
        {
          kind: 'submenu',
          label: 'Results position',
          items: [
            {
              kind: 'radio',
              label: 'Below the editor',
              checked: shell.resultsPosition === 'below',
              run: () => shell.setResultsPosition('below'),
            },
            {
              kind: 'radio',
              label: 'Beside the editor',
              checked: shell.resultsPosition === 'beside',
              run: () => shell.setResultsPosition('beside'),
            },
            {
              kind: 'radio',
              label: 'Tab in the editor',
              checked: shell.resultsPosition === 'tab',
              run: () => shell.setResultsPosition('tab'),
            },
          ],
        },
        {
          kind: 'submenu',
          label: 'Theme',
          items: THEMES.map((value) => ({
            kind: 'radio',
            label: THEME_LABELS[value],
            checked: theme === value,
            run: () => useThemeStore.getState().setTheme(value),
          })),
        },
        separator,
        item('view.zoom-in'),
        item('view.zoom-out'),
        item('view.zoom-reset'),
        separator,
        item('view.full-screen'),
        separator,
        item('view.palette'),
      ]),
    },
    {
      label: 'Help',
      items: [item('help.shortcuts')],
    },
  ]
}

import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { activeQueryStore } from '../query/queryStore'
import { useTabsStore } from '../tabs/tabsStore'
import { makeProfile, makeWorkspace } from '../test/fixtures'
import { useThemeStore } from '../theme/themeStore'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { AppShell } from './AppShell'
import { resetShellStore, useShellStore } from './shellStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    close: vi.fn().mockResolvedValue(undefined),
    isFullscreen: vi.fn().mockResolvedValue(false),
    setFullscreen: vi.fn().mockResolvedValue(undefined),
  }),
}))

const appInfo = vi.mocked(commands.appInfo)
const initialWorkspaceState = useWorkspaceStore.getState()

function renderShell() {
  render(<AppShell />)
  return userEvent.setup()
}

/** Opens a menu of the menu bar. */
async function openMenu(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  await user.click(
    within(screen.getByRole('navigation', { name: 'Menu bar' })).getByRole(
      'button',
      { name },
    ),
  )
  return screen.getByRole('menu', { name })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetShellStore()
  useWorkspaceStore.setState(initialWorkspaceState, true)
  useWorkspaceStore.setState({
    workspace: makeWorkspace([
      makeProfile(),
      makeProfile({ id: 'id-2', name: 'Live', environment: 'production' }),
    ]),
  })
  appInfo.mockResolvedValue({ name: 'Tabloxide', version: '0.1.0' })
})

describe('AppShell layout', () => {
  test('shows the title bar, the tool strips, the editor, the results, and the status bar', async () => {
    renderShell()

    expect(
      screen.getByRole('navigation', { name: 'Menu bar' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Project: sql-project' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Connection: none' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('navigation', { name: 'Left tool strip' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('navigation', { name: 'Sidebar: Files' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Editor' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Results' })).toBeInTheDocument()
    expect(await screen.findByText('Tabloxide 0.1.0')).toBeInTheDocument()
  })

  test('shows an error message when the backend is not available', async () => {
    appInfo.mockRejectedValue(new Error('no backend'))

    renderShell()

    expect(
      await screen.findByText('Backend not available: no backend'),
    ).toBeInTheDocument()
  })

  test('the tool strip selects the sidebar view and hides the sidebar on a second click', async () => {
    const user = renderShell()
    const strip = screen.getByRole('navigation', { name: 'Left tool strip' })

    await user.click(within(strip).getByRole('button', { name: 'Git' }))
    expect(
      screen.getByRole('navigation', { name: 'Sidebar: Git' }),
    ).toBeInTheDocument()
    expect(within(strip).getByRole('button', { name: 'Git' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await user.click(within(strip).getByRole('button', { name: 'Git' }))
    expect(screen.queryByRole('navigation', { name: /^Sidebar/ })).toBeNull()

    await user.click(within(strip).getByRole('button', { name: 'History' }))
    expect(
      screen.getByRole('navigation', { name: 'Sidebar: History' }),
    ).toBeInTheDocument()
  })

  test('shows and hides the assistant panel, and keeps the editor', async () => {
    const user = renderShell()
    const editor = screen.getByRole('region', { name: 'Editor' })
    const toggle = screen.getByRole('button', { name: 'Assistant' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await user.click(toggle)

    expect(
      screen.getByRole('region', { name: 'Assistant' }),
    ).toBeInTheDocument()
    // A new editor element would lose the undo history and the cursor of each tab.
    expect(screen.getByRole('region', { name: 'Editor' })).toBe(editor)
  })
})

describe('menu bar', () => {
  test('the View menu hides the results and the status bar', async () => {
    const user = renderShell()

    let menu = await openMenu(user, 'View')
    await user.click(
      within(menu).getByRole('menuitemcheckbox', { name: /Results/ }),
    )
    expect(screen.queryByRole('region', { name: 'Results' })).toBeNull()

    menu = await openMenu(user, 'View')
    expect(
      within(menu).getByRole('menuitemcheckbox', { name: /Results/ }),
    ).toHaveAttribute('aria-checked', 'false')
    await user.click(
      within(menu).getByRole('menuitemcheckbox', { name: /Status bar/ }),
    )
    expect(screen.queryByText('Tabloxide 0.1.0')).toBeNull()
  })

  test('the keyboard opens a menu, moves to a submenu, and selects a theme', async () => {
    useThemeStore.setState({ theme: 'system' })
    const user = renderShell()
    const viewButton = within(
      screen.getByRole('navigation', { name: 'Menu bar' }),
    ).getByRole('button', { name: 'View' })

    viewButton.focus()
    await user.keyboard('{ArrowDown}')
    const menu = screen.getByRole('menu', { name: 'View' })
    // The focus is on the first item, the Layout submenu.
    expect(document.activeElement).toHaveTextContent('Layout')
    await user.keyboard('{End}')
    expect(document.activeElement).toHaveTextContent('Full screen')
    const theme = within(menu).getByRole('menuitem', { name: /Theme/ })
    theme.focus()
    await user.keyboard('{ArrowRight}')
    const themes = screen.getByRole('menu', { name: 'Theme' })
    expect(document.activeElement).toHaveTextContent('System')
    await user.click(
      within(themes).getByRole('menuitemradio', { name: 'Neon' }),
    )

    expect(document.documentElement.dataset.theme).toBe('neon')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  test('View › Density › Compact makes the window compact', async () => {
    const user = renderShell()

    const menu = await openMenu(user, 'View')
    within(menu)
      .getByRole('menuitem', { name: /Density/ })
      .focus()
    await user.keyboard('{ArrowRight}')
    await user.click(screen.getByRole('menuitemradio', { name: 'Compact' }))

    expect(document.documentElement.dataset.density).toBe('compact')
    expect(useShellStore.getState().density).toBe('compact')
  })

  test('Escape closes the menu and returns the focus to its button', async () => {
    const user = renderShell()

    await openMenu(user, 'File')
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toHaveTextContent('File')
  })

  test('the arrow keys move between the menus of the menu bar', async () => {
    const user = renderShell()

    await openMenu(user, 'File')
    await user.keyboard('{ArrowRight}')

    expect(
      screen.getByRole('menu', { name: 'Connections' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('menu', { name: 'File' })).toBeNull()
  })

  test('a command that is not available is disabled', async () => {
    const user = renderShell()

    const menu = await openMenu(user, 'Connections')

    expect(
      within(menu).getByRole('menuitem', { name: /Edit connection/ }),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(
      within(menu).getByRole('menuitem', { name: /New connection/ }),
    ).not.toHaveAttribute('aria-disabled')
  })

  test('File › Preferences opens the preferences dialog', async () => {
    const user = renderShell()

    const menu = await openMenu(user, 'File')
    await user.click(
      within(menu).getByRole('menuitem', { name: /Preferences/ }),
    )

    expect(
      await screen.findByRole('dialog', { name: 'Preferences' }),
    ).toBeInTheDocument()
  })
})

describe('title bar widgets', () => {
  test('the connection widget switches the connection of the active tab', async () => {
    useTabsStore.setState({
      tabs: [
        {
          id: 'tab-1',
          title: 'Query 1',
          path: null,
          content: '',
          savedContent: null,
          connectionId: null,
        },
      ],
      activeId: 'tab-1',
      isLoaded: true,
      error: null,
    })
    vi.mocked(commands.uiStateLoad).mockResolvedValue({
      status: 'ok',
      data: { tabs: [], active_tab: null },
    })
    const user = renderShell()
    // The shell loads the tabs of the workspace. Set the tab again after the load.
    await waitFor(() => expect(commands.uiStateLoad).toHaveBeenCalled())
    useTabsStore.setState({
      tabs: [
        {
          id: 'tab-1',
          title: 'Query 1',
          path: null,
          content: '',
          savedContent: null,
          connectionId: null,
        },
      ],
      activeId: 'tab-1',
    })

    await user.click(screen.getByRole('button', { name: 'Connection: none' }))
    // jsdom has no layout. A click there goes to the resize handles of the panes,
    // thus the test types into the field that has the focus.
    expect(
      screen.getByRole('searchbox', { name: 'Find a connection' }),
    ).toHaveFocus()
    await user.keyboard('li')
    const menu = screen.getByRole('menu', { name: 'Connection' })
    expect(
      within(menu).queryByRole('menuitemradio', { name: /Local/ }),
    ).toBeNull()
    // The environment is a badge heading, and each connection shows its engine.
    expect(within(menu).getByText('production')).toHaveClass(
      'badge--production',
    )
    expect(
      within(menu).getByRole('menuitemradio', { name: /Live/ }),
    ).toHaveTextContent('PostgreSQL')
    await user.click(within(menu).getByRole('menuitemradio', { name: /Live/ }))

    expect(useTabsStore.getState().tabs[0].connectionId).toBe('id-2')
    expect(
      await screen.findByRole('button', {
        name: 'Connection: Live, production',
      }),
    ).toBeInTheDocument()
    expect(commands.sessionOpen).toHaveBeenCalledWith('id-2')
  })

  test('the branch widget shows the branch and the counts of the repository', async () => {
    vi.mocked(commands.gitOverview).mockResolvedValue({
      status: 'ok',
      data: {
        state: 'repository',
        version: '2.43.0',
        root: '/work/sql-project',
        merge_message: null,
        branches: [
          {
            name: 'feature',
            is_current: false,
            last_commit: Date.now() / 1000 - 3 * 86400,
          },
          { name: 'main', is_current: true, last_commit: Date.now() / 1000 },
        ],
        remote_branches: [
          { name: 'origin/main', local_name: 'main', last_commit: null },
          {
            name: 'origin/release-0.2',
            local_name: 'release-0.2',
            last_commit: Date.now() / 1000 - 14 * 86400,
          },
        ],
        status: {
          branch: 'main',
          has_commits: true,
          upstream: 'origin/main',
          ahead: 1,
          behind: 0,
          files: [],
        },
      },
    })
    const user = renderShell()

    await user.click(
      await screen.findByRole('button', { name: 'Git branch: main ↑1' }),
    )
    const menu = screen.getByRole('menu', { name: 'Git branch' })
    expect(
      within(menu).getByRole('menuitemradio', { name: /^main/ }),
    ).toHaveTextContent('↑1')
    expect(
      within(menu).getByRole('menuitemradio', { name: /^feature/ }),
    ).toHaveTextContent('3 days ago')
    // A remote branch with a local branch of the same name is not in the list.
    expect(
      within(menu).queryByRole('menuitemradio', { name: /^origin\/main/ }),
    ).toBeNull()
    expect(within(menu).getByText('Remote branches')).toBeInTheDocument()
    await user.click(
      within(menu).getByRole('menuitemradio', { name: /^feature/ }),
    )

    expect(commands.gitBranchSwitch).toHaveBeenCalledWith('feature')
  })

  test('a remote branch in the branch widget switches to a local branch that tracks it', async () => {
    vi.mocked(commands.gitOverview).mockResolvedValue({
      status: 'ok',
      data: {
        state: 'repository',
        version: '2.43.0',
        root: '/work/sql-project',
        merge_message: null,
        branches: [{ name: 'main', is_current: true, last_commit: null }],
        remote_branches: [
          {
            name: 'origin/release-0.2',
            local_name: 'release-0.2',
            last_commit: Date.now() / 1000 - 14 * 86400,
          },
        ],
        status: {
          branch: 'main',
          has_commits: true,
          upstream: 'origin/main',
          ahead: 0,
          behind: 0,
          files: [],
        },
      },
    })
    const user = renderShell()

    await user.click(
      await screen.findByRole('button', { name: 'Git branch: main' }),
    )
    const menu = screen.getByRole('menu', { name: 'Git branch' })
    const remote = within(menu).getByRole('menuitemradio', {
      name: /^origin\/release-0.2/,
    })
    expect(remote).toHaveTextContent('2 weeks ago')
    await user.click(remote)

    expect(commands.gitBranchSwitch).toHaveBeenCalledWith('release-0.2')
  })
})

describe('command palette', () => {
  test('Ctrl+K opens the palette, and Enter runs the selected command', async () => {
    const user = renderShell()

    await user.keyboard('{Control>}k{/Control}')
    const input = screen.getByRole('combobox', {
      name: 'Search or run a command',
    })
    expect(input).toHaveFocus()
    await user.keyboard('>status bar')
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('Show or hide the status bar')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()
    expect(useShellStore.getState().panels.statusBar).toBe(false)
  })

  test('Help › Search or run a command opens the palette, and the View menu does not have it', async () => {
    const user = renderShell()

    const view = await openMenu(user, 'View')
    expect(
      within(view).queryByRole('menuitem', { name: /Search or run a command/ }),
    ).toBeNull()
    await user.keyboard('{Escape}')

    const help = await openMenu(user, 'Help')
    await user.click(
      within(help).getByRole('menuitem', { name: /Search or run a command/ }),
    )

    expect(
      screen.getByRole('combobox', { name: 'Search or run a command' }),
    ).toHaveFocus()
  })

  test('the palette finds the files of the workspace and opens one', async () => {
    vi.mocked(commands.fileList).mockImplementation(async (folder) => ({
      status: 'ok',
      data:
        folder === ''
          ? [{ name: 'reports', path: 'reports', is_directory: true }]
          : [
              {
                name: 'runs_by_day.sql',
                path: 'reports/runs_by_day.sql',
                is_directory: false,
              },
            ],
    }))
    vi.mocked(commands.fileRead).mockResolvedValue({
      status: 'ok',
      data: 'select 1',
    })
    const user = renderShell()

    await user.click(
      screen.getByRole('button', { name: /Search or run a command/ }),
    )
    expect(
      screen.getByRole('combobox', { name: 'Search or run a command' }),
    ).toHaveFocus()
    await user.keyboard('runs')
    const option = await screen.findByRole('option', {
      name: /runs_by_day\.sql/,
    })
    expect(option).toHaveTextContent('reports/')
    await user.click(option)

    await waitFor(() =>
      expect(
        useTabsStore
          .getState()
          .tabs.some((tab) => tab.path === 'reports/runs_by_day.sql'),
      ).toBe(true),
    )
  })

  test('Escape closes the palette', async () => {
    const user = renderShell()

    await user.keyboard('{Control>}k{/Control}')
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()
  })
})

describe('shortcuts', () => {
  test('Ctrl+B hides the sidebar and Ctrl+J shows the assistant', async () => {
    const user = renderShell()

    await user.keyboard('{Control>}b{/Control}')
    await user.keyboard('{Control>}j{/Control}')

    expect(screen.queryByRole('navigation', { name: /^Sidebar/ })).toBeNull()
    expect(
      screen.getByRole('region', { name: 'Assistant' }),
    ).toBeInTheDocument()
  })

  test('Ctrl+T opens a new tab', async () => {
    const user = renderShell()
    await waitFor(() => expect(useTabsStore.getState().isLoaded).toBe(true))
    const before = useTabsStore.getState().tabs.length

    await user.keyboard('{Control>}t{/Control}')

    expect(useTabsStore.getState().tabs.length).toBe(before + 1)
  })

  test('F1 and Help › Keyboard shortcuts open the list of the shortcuts', async () => {
    const user = renderShell()

    await user.keyboard('{F1}')
    expect(
      screen.getByRole('dialog', { name: 'Keyboard shortcuts' }),
    ).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()

    const menu = await openMenu(user, 'Help')
    await user.click(
      within(menu).getByRole('menuitem', { name: /Keyboard shortcuts/ }),
    )
    expect(
      screen.getByRole('dialog', { name: 'Keyboard shortcuts' }),
    ).toBeInTheDocument()
  })
})

describe('layouts', () => {
  test('the results can be a tab in the editor, and the user switches between the tabs', async () => {
    useShellStore.getState().setResultsPosition('tab')
    const user = renderShell()

    const tabs = screen.getByRole('tablist', { name: 'Editor or results' })
    expect(
      within(tabs).getByRole('tab', { name: 'SQL editor' }),
    ).toHaveAttribute('aria-selected', 'true')
    await user.click(within(tabs).getByRole('tab', { name: 'Results' }))

    expect(screen.getByRole('region', { name: 'Results' })).toBeVisible()
    expect(
      screen.getByRole('region', { name: 'Editor', hidden: true }),
    ).not.toBeVisible()
  })

  test('in the tab mode, a new result opens the results tab', async () => {
    useShellStore.getState().setResultsPosition('tab')
    renderShell()
    await waitFor(() => expect(useTabsStore.getState().isLoaded).toBe(true))
    const tabs = screen.getByRole('tablist', { name: 'Editor or results' })

    act(() =>
      activeQueryStore().setState({
        statements: [
          {
            range: { from: 0, to: 8 },
            elapsed_ms: 1,
            outcome: { type: 'command', affected_rows: 1 },
          },
        ],
      }),
    )

    expect(within(tabs).getByRole('tab', { name: 'Results' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  test('the sidebar can be on the right and the assistant below the editor', () => {
    useShellStore.getState().applySettings({
      ...useShellStore.getState(),
      sidebarSide: 'right',
      assistantPlacement: 'below-editor',
      panels: {
        sidebar: true,
        assistant: true,
        results: true,
        statusBar: true,
      },
    })

    renderShell()

    const sidebar = screen.getByRole('navigation', { name: /^Sidebar/ })
    const editor = screen.getByRole('region', { name: 'Editor' })
    const assistant = screen.getByRole('region', { name: 'Assistant' })
    // The sidebar is after the editor in the document, thus on the right.
    expect(
      editor.compareDocumentPosition(sidebar) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    // The assistant is in the column of the editor.
    expect(editor.closest('[data-group]')?.contains(assistant)).toBe(true)
  })

  test('View › Layout › Edit layout opens the layout editor', async () => {
    const user = renderShell()

    const menu = await openMenu(user, 'View')
    within(menu)
      .getByRole('menuitem', { name: /^Layout/ })
      .focus()
    await user.keyboard('{ArrowRight}')
    await user.click(screen.getByRole('menuitem', { name: /Edit layout/ }))

    expect(
      screen.getByRole('dialog', { name: 'Edit layout' }),
    ).toBeInTheDocument()
  })
})

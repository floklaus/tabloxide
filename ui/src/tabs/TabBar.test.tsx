import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { getQueryStore, resetQueryStores } from '../query/queryStore'
import { makeProfile, makeWorkspace } from '../test/fixtures'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { TabBar } from './TabBar'
import { useTabsStore, type Tab } from './tabsStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }))

function tab(overrides: Partial<Tab>): Tab {
  return {
    id: 't1',
    title: 'Query 1',
    path: null,
    content: '',
    savedContent: null,
    connectionId: null,
    ...overrides,
  }
}

function renderTabs(tabs: Tab[]) {
  useTabsStore.setState({ tabs, activeId: tabs[0].id, isLoaded: true })
  render(<TabBar />)
  return userEvent.setup()
}

function titles(): string[] {
  return screen.getAllByRole('tab').map((item) => item.textContent ?? '')
}

describe('TabBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTabsStore.getState().reset()
    useWorkspaceStore.setState({ workspace: null })
    resetQueryStores()
  })

  test('shows the tabs and marks the active tab', () => {
    renderTabs([
      tab({}),
      tab({ id: 't2', title: 'a.sql', path: 'a.sql', savedContent: '' }),
    ])

    expect(titles()).toEqual(['Query 1', 'a.sql'])
    expect(screen.getByRole('tab', { name: 'Query 1' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  test('shows the connection name of a tab', () => {
    useWorkspaceStore.setState({
      workspace: makeWorkspace([makeProfile({ id: 'c1', name: 'Live' })]),
    })

    renderTabs([tab({ connectionId: 'c1' }), tab({ id: 't2', title: 'b.sql' })])

    expect(titles()).toEqual(['Query 1 — Live', 'b.sql'])
  })

  test('activates a tab when the user clicks it', async () => {
    const user = renderTabs([tab({}), tab({ id: 't2', title: 'a.sql' })])

    await user.click(screen.getByRole('tab', { name: 'a.sql' }))

    expect(useTabsStore.getState().activeId).toBe('t2')
  })

  test('adds a tab with the new tab button', async () => {
    const user = renderTabs([tab({})])

    await user.click(screen.getByRole('button', { name: 'New query tab' }))

    expect(titles()).toEqual(['Query 1', 'Query 2'])
  })

  test('closes a tab without changes immediately', async () => {
    const user = renderTabs([tab({}), tab({ id: 't2', title: 'a.sql' })])

    await user.click(screen.getByRole('button', { name: 'Close a.sql' }))

    expect(titles()).toEqual(['Query 1'])
  })

  test('asks before it closes a tab with unsaved changes', async () => {
    const user = renderTabs([
      tab({}),
      tab({
        id: 't2',
        title: 'a.sql',
        path: 'a.sql',
        content: 'new',
        savedContent: 'old',
      }),
    ])
    expect(screen.getByLabelText('Unsaved changes')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close a.sql' }))
    const dialog = screen.getByRole('dialog', { name: 'Close the tab?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(titles()).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Close a.sql' }))
    await user.click(
      screen.getByRole('button', { name: 'Close without saving' }),
    )
    expect(titles()).toEqual(['Query 1'])
  })

  test('closes the database session of a closed tab', async () => {
    const user = renderTabs([tab({}), tab({ id: 't2', title: 'a.sql' })])
    getQueryStore('t2').setState({
      session: { id: 5, connectionId: 'c1', version: '17' },
    })

    await user.click(screen.getByRole('button', { name: 'Close a.sql' }))

    expect(commands.sessionClose).toHaveBeenCalledWith(5)
  })
})

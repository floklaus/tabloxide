import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { resetShellStore, useShellStore } from '../shell/shellStore'
import { useTabsStore } from '../tabs/tabsStore'
import { useAssistantStore } from './assistantStore'
import { SessionsPanel } from './SessionsPanel'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)

/** Gives the sessions a title and a result. Returns their identifiers. */
function makeSessions(): string[] {
  const store = useAssistantStore.getState()
  const first = store.sessions[0]
  first.store.setState({ title: 'Count the items', outcome: 'done' })
  const secondId = store.newSession()
  const second = useAssistantStore
    .getState()
    .sessions.find((entry) => entry.id === secondId)
  second?.store.setState({ title: 'Find the slow query', outcome: 'failed' })
  return [first.id, secondId]
}

function renderView() {
  render(<SessionsPanel />)
  return userEvent.setup()
}

const option = (name: string) =>
  screen.getByRole('option', { name: new RegExp(`^${name},`) })

describe('SessionsPanel', () => {
  beforeEach(() => {
    resetShellStore()
    useTabsStore.getState().reset()
    useAssistantStore.getState().reset()
  })

  test('lists the sessions, the newest first, each with its status mark', () => {
    makeSessions()
    renderView()

    const view = screen.getByRole('region', { name: 'Sessions' })
    const names = within(view)
      .getAllByRole('option')
      .map((item) => item.getAttribute('aria-label'))
    expect(names).toEqual([
      'Find the slow query, Failed',
      'Count the items, Done',
    ])
    expect(within(view).getByRole('img', { name: 'Failed' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent(
      '2 sessions · 0 running',
    )
  })

  test('Space opens the session in its tab, and the focus stays', async () => {
    const [firstId] = makeSessions()
    const user = renderView()
    const row = option('Count the items')
    row.focus()

    await user.keyboard(' ')

    expect(useAssistantStore.getState().activeId).toBe(firstId)
    expect(row).toHaveAttribute('aria-selected', 'true')
    expect(useTabsStore.getState().tabs.at(-1)?.assistantSessionId).toBe(
      firstId,
    )
    expect(row).toHaveFocus()
  })

  test('Ctrl+Enter shows the session in the assistant panel', async () => {
    const [firstId] = makeSessions()
    useShellStore.setState({
      panels: { ...useShellStore.getState().panels, assistant: false },
    })
    const user = renderView()
    option('Count the items').focus()

    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(useAssistantStore.getState().activeId).toBe(firstId)
    expect(useShellStore.getState().panels.assistant).toBe(true)
  })

  test('the primary action starts a new session', async () => {
    makeSessions()
    const user = renderView()

    await user.click(screen.getByRole('button', { name: 'New session' }))

    expect(screen.getAllByRole('option')).toHaveLength(3)
    expect(option('New conversation')).toHaveAttribute('aria-selected', 'true')
  })

  test('the filter shows the sessions with the text, and no match clears it', async () => {
    makeSessions()
    const user = renderView()
    const filter = screen.getByRole('searchbox', {
      name: 'Filter the sessions',
    })

    await user.type(filter, 'slow')
    expect(screen.getAllByRole('option')).toHaveLength(1)

    await user.clear(filter)
    await user.type(filter, 'invoice')
    expect(
      screen.getByText('No sessions contain “invoice”.'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear the filter' }))
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })

  test('without sessions, the view says so and gives one action', async () => {
    useAssistantStore.setState({ sessions: [] })
    const user = renderView()

    expect(
      screen.getByText('No assistant session is open.'),
    ).toBeInTheDocument()
    const actions = screen.getAllByRole('button', { name: 'New session' })
    await user.click(actions[actions.length - 1])
    expect(screen.getAllByRole('option')).toHaveLength(1)
  })

  test('type-ahead moves to a session, and Ctrl+F moves to the filter', async () => {
    makeSessions()
    const user = renderView()
    option('Find the slow query').focus()

    await user.keyboard('c')
    expect(option('Count the items')).toHaveFocus()

    await user.keyboard('{Control>}f{/Control}')
    expect(
      screen.getByRole('searchbox', { name: 'Filter the sessions' }),
    ).toHaveFocus()
  })

  test('Shift+F10 opens the context menu, and Stop is off for an idle session', async () => {
    makeSessions()
    const user = renderView()
    option('Count the items').focus()

    await user.keyboard('{Shift>}{F10}{/Shift}')

    const menu = screen.getByRole('menu', {
      name: 'Actions for Count the items',
    })
    expect(
      within(menu).getByRole('menuitem', { name: /Stop the request/ }),
    ).toHaveAttribute('aria-disabled', 'true')
    await user.click(
      within(menu).getByRole('menuitem', { name: /Open in a tab/ }),
    )
    expect(useTabsStore.getState().tabs.at(-1)?.assistantSessionId).toBe(
      useAssistantStore.getState().sessions[0].id,
    )
  })

  test('the state of a row follows its session', () => {
    const [firstId] = makeSessions()
    renderView()

    act(() =>
      useAssistantStore
        .getState()
        .sessions.find((entry) => entry.id === firstId)
        ?.store.setState({ title: 'Count the items', outcome: 'stopped' }),
    )

    expect(option('Count the items')).toHaveAccessibleName(
      'Count the items, Stopped',
    )
  })
})

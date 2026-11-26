import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { resetQueryStores } from '../query/queryStore'
import { useTabsStore } from '../tabs/tabsStore'
import { makeProfile, makeWorkspace } from '../test/fixtures'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { HistoryDetail } from './HistoryDetail'
import { HistoryPanel } from './HistoryPanel'
import {
  dayName,
  groupByDay,
  useHistoryStore,
  type HistoryEntry,
} from './historyStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }))

const historySearch = vi.mocked(commands.historySearch)
const historyClear = vi.mocked(commands.historyClear)
const sessionOpen = vi.mocked(commands.sessionOpen)
const queryRun = vi.mocked(commands.queryRun)

const NOW = Date.now() / 1000

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 1,
    connection_id: 'c1',
    connection_name: 'Local',
    sql: 'select * from orders',
    executed_at_secs: NOW,
    elapsed_ms: 12,
    status: 'ok',
    rows: 3,
    error: null,
    ...overrides,
  }
}

function ok<T>(data: T) {
  return { status: 'ok' as const, data }
}

function renderPanel(entries: HistoryEntry[]) {
  historySearch.mockResolvedValue(ok(entries))
  const onRun = vi.fn()
  render(<HistoryPanel onRun={onRun} />)
  return { user: userEvent.setup(), onRun }
}

const option = (name: RegExp) => screen.findByRole('option', { name })

describe('HistoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetQueryStores()
    useHistoryStore.getState().reset()
    useTabsStore.getState().reset()
    useTabsStore.getState().newTab()
    useWorkspaceStore.setState({
      workspace: makeWorkspace([
        makeProfile({ id: 'c1' }),
        makeProfile({ id: 'c2', name: 'Other' }),
      ]),
    })
  })

  test('shows the entries in groups by day, with a status mark', async () => {
    renderPanel([
      entry(),
      entry({
        id: 2,
        sql: 'select x',
        status: 'failed',
        rows: null,
        error: 'no x',
      }),
    ])

    const first = await option(/^select \* from orders, Succeeded/)
    expect(first).toHaveTextContent('Local')
    expect(first).toHaveTextContent('12 ms · 3 rows')
    expect(await option(/^select x, Failed/)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Today' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('2 entries')
  })

  test('says that the history is empty', async () => {
    renderPanel([])

    expect(await screen.findByText(/The history is empty/)).toBeInTheDocument()
  })

  test('searches with the text that the user types, and can clear it', async () => {
    const { user } = renderPanel([])

    await user.type(screen.getByRole('searchbox'), 'orders')

    await waitFor(() =>
      expect(historySearch).toHaveBeenLastCalledWith('orders'),
    )
    expect(
      await screen.findByText('No entries contain “orders”.'),
    ).toBeInTheDocument()
  })

  test('the scope and the result filter show only some entries', async () => {
    const { user } = renderPanel([
      entry(),
      entry({
        id: 2,
        connection_id: 'c2',
        connection_name: 'Other',
        sql: 'select 2',
      }),
      entry({ id: 3, sql: 'select 3', status: 'failed', error: 'no' }),
    ])
    await option(/^select 2,/)

    await user.click(
      screen.getByRole('button', { name: /^Scope: all connections/ }),
    )
    await user.click(screen.getByRole('menuitemradio', { name: 'Other' }))
    expect(screen.getAllByRole('option')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: /^Scope: other/ }))
    await user.click(
      screen.getByRole('menuitemradio', { name: 'All connections' }),
    )
    await user.click(screen.getByRole('button', { name: 'Show: all results' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Failed' }))
    expect(
      screen
        .getAllByRole('option')
        .map((row) => row.getAttribute('aria-label')),
    ).toEqual(['select 3, Failed'])
  })

  test('Enter opens the statement in a new tab with its connection', async () => {
    const { user } = renderPanel([entry()])
    ;(await option(/^select \* from orders/)).focus()

    await user.keyboard('{Enter}')

    const { tabs, activeId } = useTabsStore.getState()
    expect(tabs.find((tab) => tab.id === activeId)).toMatchObject({
      content: 'select * from orders',
      connectionId: 'c1',
    })
  })

  test('Ctrl+Enter runs the statement again in the SQL tab', async () => {
    const { user, onRun } = renderPanel([entry()])
    sessionOpen.mockResolvedValue(
      ok({
        status: 'connected',
        session: {
          id: 4,
          connection_id: 'c1',
          database: 'app',
          server: { version: '17' },
        },
      }),
    )
    queryRun.mockResolvedValue(ok({ statements: [], open_result: null }))
    ;(await option(/^select \* from orders/)).focus()

    await user.keyboard('{Control>}{Enter}{/Control}')

    await waitFor(() =>
      expect(queryRun).toHaveBeenCalledWith(4, 'select * from orders', {
        type: 'all',
      }),
    )
    expect(onRun).toHaveBeenCalled()
  })

  test('Space shows the entry in a preview tab', async () => {
    const { user } = renderPanel([entry()])
    ;(await option(/^select \* from orders/)).focus()

    await user.keyboard(' ')

    const tab = useTabsStore
      .getState()
      .tabs.find((item) => item.detail?.kind === 'history')
    expect(tab?.isPreview).toBe(true)
  })

  test('clears the history after a confirmation', async () => {
    const { user } = renderPanel([entry()])
    await option(/^select \* from orders/)

    await user.click(
      screen.getByRole('button', { name: 'More history actions' }),
    )
    await user.click(
      screen.getByRole('menuitem', { name: /Clear the history/ }),
    )
    expect(historyClear).not.toHaveBeenCalled()
    historySearch.mockResolvedValue(ok([]))
    const dialog = screen.getByRole('dialog', { name: 'Clear the history?' })
    await user.click(
      within(dialog).getByRole('button', { name: 'Clear history' }),
    )

    expect(historyClear).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/The history is empty/)).toBeInTheDocument()
  })
})

describe('HistoryDetail', () => {
  test('shows a failed entry with its error and the AI action', () => {
    useHistoryStore.setState({
      entries: [
        entry({
          id: 7,
          status: 'failed',
          error: 'column "prise" does not exist',
        }),
      ],
    })

    render(<HistoryDetail id={7} />)

    expect(
      screen.getByRole('heading', { name: 'Failed query' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'column "prise" does not exist',
    )
    expect(
      screen.getByRole('button', { name: 'Explain and fix' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Run again/ })).toBeEnabled()
  })

  test('an entry without its statement text has no actions', () => {
    useHistoryStore.setState({
      entries: [
        entry({
          id: 8,
          sql: '-- Not recorded: the statement can contain a password.',
        }),
      ],
    })

    render(<HistoryDetail id={8} />)

    expect(screen.getByRole('button', { name: /Run again/ })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /Open in a new tab/ }),
    ).toBeDisabled()
  })
})

describe('the groups by day', () => {
  test('names today, yesterday, and an older date', () => {
    const now = new Date(2026, 10, 26, 12)
    const at = (days: number) =>
      new Date(2026, 10, 26 - days, 9).getTime() / 1000

    expect(dayName(at(0), now)).toBe('Today')
    expect(dayName(at(1), now)).toBe('Yesterday')
    expect(dayName(at(9), now)).not.toMatch(/Today|Yesterday/)
    expect(
      groupByDay(
        [
          entry({ executed_at_secs: at(0) }),
          entry({ id: 2, executed_at_secs: at(1) }),
        ],
        now,
      ).map((group) => group.day),
    ).toEqual(['Today', 'Yesterday'])
  })
})

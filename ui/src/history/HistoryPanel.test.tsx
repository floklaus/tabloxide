import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { resetQueryStores } from '../query/queryStore'
import { useTabsStore } from '../tabs/tabsStore'
import { HistoryPanel, type HistoryEntry } from './HistoryPanel'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }))

const historySearch = vi.mocked(commands.historySearch)
const historyClear = vi.mocked(commands.historyClear)
const sessionOpen = vi.mocked(commands.sessionOpen)
const queryRun = vi.mocked(commands.queryRun)

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 1,
    connection_id: 'c1',
    connection_name: 'Local',
    sql: 'select * from orders',
    executed_at_secs: 1_800_000_000,
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

describe('HistoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetQueryStores()
    useTabsStore.getState().reset()
    useTabsStore.getState().newTab()
  })

  test('shows the entries with the connection and the result', async () => {
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

    expect(await screen.findByText('select * from orders')).toBeInTheDocument()
    expect(screen.getByText('3 rows, 12 ms')).toBeInTheDocument()
    expect(screen.getByText('Failed, 12 ms')).toBeInTheDocument()
    expect(screen.getByText('no x')).toBeInTheDocument()
    expect(screen.getAllByText('Local')).toHaveLength(2)
  })

  test('shows a message when the history is empty', async () => {
    renderPanel([])

    expect(await screen.findByText('The history is empty.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear history' })).toBeDisabled()
  })

  test('searches with the text that the user types', async () => {
    const { user } = renderPanel([])

    await user.type(screen.getByRole('searchbox'), 'orders')

    await waitFor(() =>
      expect(historySearch).toHaveBeenLastCalledWith('orders'),
    )
    expect(
      await screen.findByText('No entry contains this text.'),
    ).toBeInTheDocument()
  })

  test('opens an entry in a new tab with its connection', async () => {
    const { user } = renderPanel([entry()])

    await user.click(
      await screen.findByRole('button', { name: 'Open in a new tab' }),
    )

    const { tabs, activeId } = useTabsStore.getState()
    expect(tabs).toHaveLength(2)
    expect(tabs.find((tab) => tab.id === activeId)).toMatchObject({
      content: 'select * from orders',
      connectionId: 'c1',
    })
  })

  test('runs an entry again in the active tab', async () => {
    const { user, onRun } = renderPanel([entry()])
    sessionOpen.mockResolvedValue(
      ok({
        status: 'connected',
        session: { id: 4, connection_id: 'c1', server: { version: '17' } },
      }),
    )
    queryRun.mockResolvedValue(ok({ statements: [], open_result: null }))

    await user.click(await screen.findByRole('button', { name: 'Run again' }))

    await waitFor(() =>
      expect(queryRun).toHaveBeenCalledWith(4, 'select * from orders', {
        type: 'all',
      }),
    )
    expect(onRun).toHaveBeenCalled()
    expect(useTabsStore.getState().tabs[0].connectionId).toBe('c1')
  })

  test('gives no actions for an entry without statement text', async () => {
    renderPanel([
      entry({ sql: '-- Not recorded: the statement can contain a password.' }),
    ])

    expect(await screen.findByText(/Not recorded/)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Run again' }),
    ).not.toBeInTheDocument()
  })

  test('clears the history after a confirmation', async () => {
    const { user } = renderPanel([entry()])
    await screen.findByText('select * from orders')

    await user.click(screen.getByRole('button', { name: 'Clear history' }))
    expect(historyClear).not.toHaveBeenCalled()
    historySearch.mockResolvedValue(ok([]))
    await user.click(
      screen.getAllByRole('button', { name: 'Clear history' }).at(-1)!,
    )

    expect(historyClear).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('The history is empty.')).toBeInTheDocument()
  })
})

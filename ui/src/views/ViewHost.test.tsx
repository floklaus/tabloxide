import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { activeQueryStore, resetQueryStores } from '../query/queryStore'
import type { Column, Row } from '../results/gridModel'
import { useTabsStore } from '../tabs/tabsStore'
import { resetStatementNumbers } from './statementNumber'
import { ViewHost } from './ViewHost'
import { useViewStore } from './viewStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('./chart/ChartCanvas', () => import('./chart/FakeChartCanvas'))

const queryPreview = vi.mocked(commands.queryPreview)

const COLUMNS: Column[] = [
  { name: 'country', type_name: 'text', kind: 'text' },
  { name: 'total', type_name: 'int4', kind: 'number' },
]
const ROWS: Row[] = [
  ['DE', '10'],
  ['FR', '20'],
]
const SQL = 'select 1; select country, total from sales'
const SECOND_STATEMENT = 10

function host(overrides: Partial<Parameters<typeof ViewHost>[0]> = {}) {
  return (
    <ViewHost
      statementFrom={0}
      runIndex={0}
      columns={COLUMNS}
      rows={ROWS}
      hasMore={false}
      onNeedMore={() => {}}
      isComplete
      totalRows={ROWS.length}
      {...overrides}
    />
  )
}

function viewButton(name: string) {
  return screen.getByRole('button', { name })
}

beforeEach(() => {
  useTabsStore.getState().reset()
  resetQueryStores()
  useViewStore.getState().reset()
  resetStatementNumbers()
  activeQueryStore().setState({ ranSql: SQL })
  queryPreview.mockResolvedValue([
    { range: { from: 0, to: 8 }, risk: null },
    { range: { from: SECOND_STATEMENT, to: SQL.length }, risk: null },
  ])
})

describe('the view switch', () => {
  test('the grid is the view of a new result', async () => {
    render(host())

    await waitFor(() => expect(viewButton('Chart')).toBeEnabled())

    expect(viewButton('Grid')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('grid')).toBeInTheDocument()
  })

  test('"Chart" shows the chart of the result', async () => {
    render(host())
    await waitFor(() => expect(viewButton('Chart')).toBeEnabled())

    await userEvent.click(viewButton('Chart'))

    expect(viewButton('Chart')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('img')).toHaveAttribute('data-type', 'bar')
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
  })

  test('a result without columns has no switch', () => {
    render(host({ columns: [], rows: [] }))

    expect(screen.queryByRole('button', { name: 'Chart' })).toBeNull()
  })

  test('a new run of the statement keeps the view and its settings', async () => {
    const { unmount } = render(host())
    await waitFor(() => expect(viewButton('Chart')).toBeEnabled())
    await userEvent.click(viewButton('Chart'))
    await userEvent.click(screen.getByRole('button', { name: 'Line chart' }))
    unmount()

    render(host({ rows: [...ROWS, ['IT', '30']] }))

    await waitFor(() =>
      expect(screen.getByRole('img')).toHaveAttribute('data-type', 'line'),
    )
    expect(screen.getByRole('img')).toHaveAttribute('data-points', '3')
  })

  test('a view that does not accept the new columns gives its place to the grid', async () => {
    const { unmount } = render(host())
    await waitFor(() => expect(viewButton('Chart')).toBeEnabled())
    await userEvent.click(viewButton('Chart'))
    unmount()

    render(host({ columns: [], rows: [] }))

    expect(await screen.findByRole('grid')).toBeInTheDocument()
  })
})

describe('the number of the statement', () => {
  test('the state of a view belongs to the number of the statement in the script, not to its position in the run', async () => {
    // The user ran only the second statement of the script.
    render(host({ statementFrom: SECOND_STATEMENT, runIndex: 0 }))
    await waitFor(() => expect(viewButton('Chart')).toBeEnabled())

    await userEvent.click(viewButton('Chart'))

    expect(queryPreview).toHaveBeenCalledWith(SQL, { type: 'all' }, 'sql')
    expect(Object.keys(useViewStore.getState().tabs[''])).toEqual(['2'])
  })

  test('without an answer of the backend, the position in the run gives the number', async () => {
    queryPreview.mockRejectedValue(new Error('no backend'))
    render(host({ runIndex: 2 }))
    await waitFor(() => expect(viewButton('Chart')).toBeEnabled())

    await userEvent.click(viewButton('Chart'))

    expect(Object.keys(useViewStore.getState().tabs[''])).toEqual(['3'])
  })
})

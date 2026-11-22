import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { QueryEditor } from '../query/QueryEditor'
import { getQueryStore, resetQueryStores } from '../query/queryStore'
import { ResultsPane } from '../results/ResultsPane'
import { useResultsViewStore } from '../results/resultsViewStore'
import { useTabsStore } from '../tabs/tabsStore'
import { makeProfile, makeWorkspace } from '../test/fixtures'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import duckdbAnalyze from './fixtures/duckdb-analyze.json?raw'
import postgresExplain from './fixtures/postgres-explain.json?raw'
import { usePlanStore } from './planStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('../editor/CodeEditor', () => import('../test/FakeCodeEditor'))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))

const planRead = vi.mocked(commands.planRead)
const queryPreview = vi.mocked(commands.queryPreview)
const sessionOpen = vi.mocked(commands.sessionOpen)
const STATEMENT = 'select g, count(*) from t join u using (id) group by g'

function renderWith(engine: 'postgres' | 'duckdb') {
  const profile = makeProfile({ engine })
  useWorkspaceStore.setState({ workspace: makeWorkspace([profile]) })
  useTabsStore.setState({
    tabs: [
      {
        id: 'tab-1',
        title: 'Query 1',
        path: null,
        content: STATEMENT,
        savedContent: null,
        connectionId: profile.id,
      },
    ],
    activeId: 'tab-1',
    isLoaded: true,
    error: null,
  })
  render(
    <>
      <QueryEditor />
      <ResultsPane />
    </>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  vi.clearAllMocks()
  resetQueryStores()
  usePlanStore.getState().reset()
  useResultsViewStore.getState().setView('results')
  queryPreview.mockResolvedValue([
    { range: { from: 0, to: STATEMENT.length }, risk: null },
  ])
  sessionOpen.mockResolvedValue({
    status: 'ok',
    data: {
      status: 'connected',
      session: {
        id: 4,
        connection_id: 'id-1',
        database: 'app',
        server: { version: '17' },
      },
    },
  })
})

describe('PlanView', () => {
  test('shows the estimated plan of PostgreSQL as a tree', async () => {
    planRead.mockResolvedValue({
      status: 'ok',
      data: {
        status: 'plan',
        statement: `EXPLAIN (FORMAT JSON) ${STATEMENT}`,
        json: postgresExplain,
        is_analyzed: false,
      },
    })
    const user = renderWith('postgres')

    await user.click(screen.getByRole('button', { name: 'More query actions' }))
    await user.click(
      screen.getByRole('menuitem', { name: /^Explain(?! analyze)/ }),
    )

    expect(planRead).toHaveBeenCalledWith(4, STATEMENT, false)
    const tree = await screen.findByRole('list', { name: 'Plan steps' })
    expect(within(tree).getByText('Hash Join')).toBeInTheDocument()
    expect(within(tree).getAllByText('costly').length).toBeGreaterThan(0)
    expect(screen.getByText(/did not run the statement/)).toBeInTheDocument()
    expect(useResultsViewStore.getState().view).toBe('plan')
  })

  test('shows the measured plan of DuckDB with a misestimate', async () => {
    planRead.mockResolvedValue({
      status: 'ok',
      data: {
        status: 'plan',
        statement: `EXPLAIN (ANALYZE, FORMAT JSON) ${STATEMENT}`,
        json: duckdbAnalyze,
        is_analyzed: true,
      },
    })
    const user = renderWith('duckdb')

    await user.click(screen.getByRole('button', { name: 'More query actions' }))
    await user.click(
      screen.getByRole('menuitem', { name: /^Explain analyze(?! analyze)/ }),
    )

    expect(planRead).toHaveBeenCalledWith(4, STATEMENT, true)
    expect(await screen.findByText(/measured each step/)).toBeInTheDocument()
    expect(
      screen.getAllByText(/times more rows than expected/).length,
    ).toBeGreaterThan(0)
  })

  test('shows why the database does not give a plan', async () => {
    planRead.mockResolvedValue({
      status: 'ok',
      data: {
        status: 'rejected',
        reason: 'analyze-changes-data',
        message: 'EXPLAIN ANALYZE runs the statement.',
      },
    })
    const user = renderWith('postgres')

    await user.click(screen.getByRole('button', { name: 'More query actions' }))
    await user.click(
      screen.getByRole('menuitem', { name: /^Explain analyze(?! analyze)/ }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'EXPLAIN ANALYZE runs the statement.',
    )
  })

  test('tells the results pane that the plan read closed the open result', async () => {
    planRead.mockResolvedValue({
      status: 'ok',
      data: {
        status: 'plan',
        statement: 'x',
        json: postgresExplain,
        is_analyzed: false,
      },
    })
    const user = renderWith('postgres')
    const query = getQueryStore('tab-1')
    await query.getState().connect('id-1')
    query.setState({ open: { resultId: 1, index: 0 } })

    await user.click(screen.getByRole('button', { name: 'More query actions' }))
    await user.click(
      screen.getByRole('menuitem', { name: /^Explain(?! analyze)/ }),
    )

    await screen.findByRole('list', { name: 'Plan steps' })
    expect(query.getState().open).toBeNull()
    expect(query.getState().stopReason).toBe('plan')
  })
})

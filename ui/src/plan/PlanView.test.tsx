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
import type { Environment } from '../bindings'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { ESTIMATE_PLAN, MEASURED_PLAN } from '../test/plans'
import { PlanConfirmDialog } from './PlanConfirmDialog'
import { usePlanStore } from './planStore'
import { usePlanTarget } from './planTarget'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('../editor/CodeEditor', () => import('../test/FakeCodeEditor'))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))

const planRead = vi.mocked(commands.planRead)
const planCheck = vi.mocked(commands.planCheck)
const queryPreview = vi.mocked(commands.queryPreview)
const sessionOpen = vi.mocked(commands.sessionOpen)
const STATEMENT = 'select g, count(*) from t join u using (id) group by g'

function renderWith(
  engine: 'postgres' | 'duckdb',
  environment: Environment = 'development',
) {
  const profile = makeProfile({ engine, environment })
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
      <PlanConfirmDialog />
    </>,
  )
  return userEvent.setup()
}

async function measureAndConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'More explain actions' }))
  await user.click(
    screen.getByRole('menuitem', { name: /^Explain and measure/ }),
  )
  const dialog = await screen.findByRole('dialog')
  await user.click(
    within(dialog).getByRole('button', { name: 'Explain and measure' }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  resetQueryStores()
  usePlanStore.getState().reset()
  usePlanStore.setState({ skipsConfirm: [] })
  usePlanTarget.setState({ statement: '', explain: null, measure: null })
  useResultsViewStore.getState().setView('results')
  planCheck.mockResolvedValue({ explain: null, measure: null })
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
        text: '[]',
        plan: ESTIMATE_PLAN,
        is_analyzed: false,
      },
    })
    const user = renderWith('postgres')

    await user.click(screen.getByRole('button', { name: 'Explain' }))

    expect(planRead).toHaveBeenCalledWith(4, STATEMENT, false)
    const tree = await screen.findByRole('list', { name: 'Plan steps' })
    expect(within(tree).getByText('Hash Join')).toBeInTheDocument()
    expect(within(tree).getAllByText('costly').length).toBeGreaterThan(0)
    expect(screen.getByText(/did not run the statement/)).toBeInTheDocument()
    expect(useResultsViewStore.getState().view).toBe('plan')
  })

  test('explains each step and each field, and can hide the fields', async () => {
    planRead.mockResolvedValue({
      status: 'ok',
      data: {
        status: 'plan',
        statement: `EXPLAIN (VERBOSE, FORMAT JSON) ${STATEMENT}`,
        text: '[]',
        plan: ESTIMATE_PLAN,
        is_analyzed: false,
      },
    })
    const user = renderWith('postgres')
    await user.click(screen.getByRole('button', { name: 'Explain' }))

    const tree = await screen.findByRole('list', { name: 'Plan steps' })
    expect(
      within(tree).getAllByText(/Reads all rows of the table/).length,
    ).toBe(2)
    expect(within(tree).getAllByText(/The planner expected/).length).toBe(6)
    expect(
      within(tree).getAllByText(
        /The condition that the step checks on each row/,
      ).length,
    ).toBeGreaterThan(0)
    expect(screen.getByText('How to read this plan')).toBeInTheDocument()

    await user.click(
      screen.getByRole('checkbox', { name: 'Show all fields of each step' }),
    )

    expect(within(tree).queryByText('Plan Width')).toBeNull()
    expect(
      within(tree).getAllByText(/Reads all rows of the table/).length,
    ).toBe(2)
  })

  test('shows the measured plan of DuckDB with a misestimate', async () => {
    planRead.mockResolvedValue({
      status: 'ok',
      data: {
        status: 'plan',
        statement: `EXPLAIN (ANALYZE, FORMAT JSON) ${STATEMENT}`,
        text: '[]',
        plan: MEASURED_PLAN,
        is_analyzed: true,
      },
    })
    const user = renderWith('duckdb')

    await measureAndConfirm(user)

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
        message: 'Explain and measure runs the statement.',
      },
    })
    const user = renderWith('postgres')

    await measureAndConfirm(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Explain and measure runs the statement.',
    )
  })

  test('tells the results pane that the plan read closed the open result', async () => {
    planRead.mockResolvedValue({
      status: 'ok',
      data: {
        status: 'plan',
        statement: 'x',
        text: '[]',
        plan: ESTIMATE_PLAN,
        is_analyzed: false,
      },
    })
    const user = renderWith('postgres')
    const query = getQueryStore('tab-1')
    await query.getState().connect('id-1')
    query.setState({ open: { resultId: 1, index: 0 } })

    await user.click(screen.getByRole('button', { name: 'Explain' }))

    await screen.findByRole('list', { name: 'Plan steps' })
    expect(query.getState().open).toBeNull()
    expect(query.getState().stopReason).toBe('plan')
  })

  test('the Plan tab starts with the statement at the cursor and the two actions', async () => {
    renderWith('postgres')
    useResultsViewStore.getState().setView('plan')

    expect(
      await screen.findByText('Explain the statement at the cursor'),
    ).toBeInTheDocument()
    expect(screen.getAllByText(STATEMENT).length).toBeGreaterThan(0)
    expect(
      screen.getByRole('button', { name: 'Explain and measure' }),
    ).toBeEnabled()
  })

  test('a statement that changes data cannot be measured, and the tab says why', async () => {
    planCheck.mockResolvedValue({
      explain: null,
      measure: {
        reason: 'analyze-changes-data',
        message: 'Explain and measure runs the statement.',
      },
    })
    const user = renderWith('postgres')
    useResultsViewStore.getState().setView('plan')

    expect(
      await screen.findByText('Explain and measure runs the statement.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Explain and measure' }),
    ).toBeDisabled()
    await user.click(
      screen.getByRole('button', { name: 'More explain actions' }),
    )
    expect(
      screen.getByRole('menuitem', { name: /^Explain and measure/ }),
    ).toHaveAttribute('aria-disabled', 'true')
  })

  test('Cancel in the confirmation does not read the plan', async () => {
    const user = renderWith('postgres')
    await user.click(
      screen.getByRole('button', { name: 'More explain actions' }),
    )
    await user.click(
      screen.getByRole('menuitem', { name: /^Explain and measure/ }),
    )

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(planRead).not.toHaveBeenCalled()
  })

  test('"Do not ask again" skips the next confirmation of the connection', async () => {
    planRead.mockResolvedValue({
      status: 'ok',
      data: {
        status: 'plan',
        statement: 'x',
        text: '[]',
        plan: MEASURED_PLAN,
        is_analyzed: true,
      },
    })
    usePlanStore.setState({ skipsConfirm: [] })
    const user = renderWith('duckdb')
    await user.click(
      screen.getByRole('button', { name: 'More explain actions' }),
    )
    await user.click(
      screen.getByRole('menuitem', { name: /^Explain and measure/ }),
    )
    const dialog = await screen.findByRole('dialog')
    await user.click(
      within(dialog).getByRole('checkbox', {
        name: 'Do not ask again for this connection',
      }),
    )
    await user.click(
      within(dialog).getByRole('button', { name: 'Explain and measure' }),
    )
    await screen.findByText(/measured each step/)

    await user.click(screen.getByRole('button', { name: 'Explain again' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    await vi.waitFor(() => expect(planRead).toHaveBeenCalledTimes(2))
    expect(planRead).toHaveBeenLastCalledWith(4, STATEMENT, true)
  })

  test('a production connection always asks, without "Do not ask again"', async () => {
    usePlanStore.setState({ skipsConfirm: ['id-1'] })
    const user = renderWith('postgres', 'production')
    await user.click(
      screen.getByRole('button', { name: 'More explain actions' }),
    )
    await user.click(
      screen.getByRole('menuitem', { name: /^Explain and measure/ }),
    )

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('A production connection always asks.')
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
  })

  test('the Original view shows the JSON of the engine', async () => {
    planRead.mockResolvedValue({
      status: 'ok',
      data: {
        status: 'plan',
        statement: 'x',
        text: '[{"Plan":{"Node Type":"Sort"}}]',
        plan: ESTIMATE_PLAN,
        is_analyzed: false,
      },
    })
    const user = renderWith('postgres')
    await user.click(screen.getByRole('button', { name: 'Explain' }))
    await screen.findByRole('list', { name: 'Plan steps' })

    expect(screen.getByText('Estimate')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Original' }))

    expect(screen.queryByRole('list', { name: 'Plan steps' })).toBeNull()
    expect(screen.getByLabelText('Original plan')).toHaveTextContent(
      '"Node Type": "Sort"',
    )
  })

  test('shows the steps, the explanations, and the hints of the common form', async () => {
    planRead.mockResolvedValue({
      status: 'ok',
      data: {
        status: 'plan',
        statement: 'explain',
        text: '{"queryPlanner": {}}',
        is_analyzed: true,
        plan: {
          isMeasured: true,
          totalMs: 3,
          planningMs: null,
          costUnit: 'documents',
          totals: [
            {
              name: 'rejectedPlans',
              value: '0',
              explanation: 'Plans that the planner did not use.',
              group: 'step',
            },
          ],
          hints: [
            {
              step: '0.0',
              level: 'warning',
              title: 'Sort in memory',
              text: 'An index with the sort key makes the sort unnecessary.',
            },
          ],
          root: {
            operation: 'FETCH',
            target: null,
            explanation: 'Reads the documents.',
            fields: [],
            estimatedRows: null,
            actualRows: 12,
            loops: null,
            selfCost: 12,
            selfMs: 1,
            children: [
              {
                operation: 'SORT',
                target: null,
                explanation: 'Sorts the documents in memory.',
                fields: [
                  {
                    name: 'memLimit',
                    value: '104857600',
                    explanation: 'The memory limit of the sort, in bytes.',
                    group: 'memory',
                  },
                ],
                estimatedRows: null,
                actualRows: 12,
                loops: null,
                selfCost: 12,
                selfMs: 2,
                children: [],
              },
            ],
          },
        },
      },
    })
    const user = renderWith('postgres')

    await user.click(screen.getByRole('button', { name: 'Explain' }))

    const tree = await screen.findByRole('list', { name: 'Plan steps' })
    expect(within(tree).getByText(/Reads the documents\./)).toBeInTheDocument()
    expect(
      within(tree).getByText(/Sorts the documents in memory\./),
    ).toBeInTheDocument()
    expect(
      within(tree).getByText('The memory limit of the sort, in bytes.'),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('list', { name: 'Hints for SORT' })).getByText(
        /Sort in memory\. An index with the sort key/,
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Measured')).toBeInTheDocument()
  })

  test('a plan without steps shows only the original text', async () => {
    planRead.mockResolvedValue({
      status: 'ok',
      data: {
        status: 'plan',
        statement: 'explain',
        text: '{"queryPlanner":{"winningPlan":{"stage":"COLLSCAN"}}}',
        is_analyzed: false,
        plan: null,
      },
    })
    const user = renderWith('postgres')
    // A JSON that is not a plan of PostgreSQL gives no steps.

    await user.click(screen.getByRole('button', { name: 'Explain' }))

    expect(
      await screen.findByText(/The engine gives this plan only as text/),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Original plan')).toHaveTextContent(
      '"stage": "COLLSCAN"',
    )
    expect(screen.getByRole('radio', { name: 'Steps' })).toBeDisabled()
  })
})

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands, type HistoryEntry_Serialize } from '../bindings'
import { explainEntry } from '../history/historyStore'
import { usePreferencesStore } from '../preferences/preferencesStore'
import { getQueryStore, resetQueryStores } from '../query/queryStore'
import { ResultsPane } from '../results/ResultsPane'
import { useResultsViewStore } from '../results/resultsViewStore'
import { useTabsStore } from '../tabs/tabsStore'
import { makeProfile, makeWorkspace } from '../test/fixtures'
import { ESTIMATE_PLAN } from '../test/plans'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { usePlanStore } from './planStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))

const planRead = vi.mocked(commands.planRead)
const RAN = 'select 1;\nselect * from item where price > 10;'
const SECOND = { from: 10, to: RAN.length - 1 }

function seed(elapsedMs: number, connectionId: string | null = 'id-1') {
  useWorkspaceStore.setState({
    workspace: makeWorkspace([
      makeProfile(),
      makeProfile({ id: 'id-2', name: 'Other' }),
    ]),
  })
  useTabsStore.setState({
    tabs: [
      {
        id: 'tab-1',
        title: 'Query 1',
        path: null,
        content: 'select 2',
        savedContent: null,
        connectionId,
      },
    ],
    activeId: 'tab-1',
    sqlId: 'tab-1',
    isLoaded: true,
    error: null,
  })
  getQueryStore('tab-1').setState({
    session: { id: 4, connectionId: 'id-1', version: '17' },
    ranSql: RAN,
    selected: 0,
    statements: [
      {
        range: SECOND,
        elapsed_ms: elapsedMs,
        outcome: {
          type: 'rows',
          columns: [{ name: 'n', type_name: 'int4', kind: 'number' }],
          rows: [['1']],
          is_complete: true,
          total_rows: 1,
        },
      },
    ],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetQueryStores()
  usePlanStore.getState().reset()
  useResultsViewStore.getState().setView('results')
  usePreferencesStore.setState({
    preferences: {
      ...usePreferencesStore.getState().preferences,
      slow_query_ms: 1000,
    },
  })
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
})

describe('the Explain link of a result', () => {
  test('reads the plan of the statement of the result', async () => {
    seed(40)
    const user = userEvent.setup()
    render(<ResultsPane />)

    await user.click(screen.getByRole('button', { name: 'Explain' }))

    expect(planRead).toHaveBeenCalledWith(
      4,
      'select * from item where price > 10',
      false,
    )
    expect(useResultsViewStore.getState().view).toBe('plan')
  })

  test('asks after a slow statement', () => {
    seed(3200)
    render(<ResultsPane />)

    expect(screen.getByText('Took 3.2 s.')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Explain the statement?' }),
    ).toBeInTheDocument()
  })

  test('the limit comes from the preferences', () => {
    usePreferencesStore.setState({
      preferences: {
        ...usePreferencesStore.getState().preferences,
        slow_query_ms: 5000,
      },
    })
    seed(3200)
    render(<ResultsPane />)

    expect(screen.queryByText('Took 3.2 s.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Explain' })).toBeInTheDocument()
  })
})

describe('Explain of a history entry', () => {
  const entry: HistoryEntry_Serialize = {
    id: 1,
    connection_id: 'id-1',
    connection_name: 'Local',
    sql: 'select * from item',
    executed_at_secs: 0,
    elapsed_ms: 10,
    status: 'ok',
    rows: 1,
    error: null,
  }

  test('uses the SQL tab when it has the connection of the entry', async () => {
    seed(10)

    explainEntry(entry)

    await vi.waitFor(() =>
      expect(planRead).toHaveBeenCalledWith(4, 'select * from item', false),
    )
    expect(useTabsStore.getState().tabs).toHaveLength(1)
  })

  test('opens a new tab when the SQL tab has a different connection', () => {
    seed(10, 'id-2')

    explainEntry(entry)

    const tabs = useTabsStore.getState().tabs
    expect(tabs).toHaveLength(2)
    expect(tabs[1].connectionId).toBe('id-1')
    expect(tabs[1].content).toBe('select * from item')
  })
})

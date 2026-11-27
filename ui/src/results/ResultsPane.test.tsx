import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import {
  activeQueryStore,
  resetQueryStores,
  type QueryState,
  type StatementReport,
} from '../query/queryStore'
import { useTabsStore } from '../tabs/tabsStore'
import { ResultsPane } from './ResultsPane'
import { useResultsViewStore } from './resultsViewStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)

const queryCancel = vi.mocked(commands.queryCancel)
const SESSION = { id: 7, connectionId: 'c1', version: '17' }

function rows(isComplete: boolean, elapsedMs: number): StatementReport {
  return {
    range: { from: 0, to: 8 },
    elapsed_ms: elapsedMs,
    outcome: {
      type: 'rows',
      columns: [{ name: 'n', type_name: 'int4', kind: 'number' }],
      rows: [['1'], ['2']],
      is_complete: isComplete,
      total_rows: isComplete ? 2 : null,
    },
  }
}

function failed(kind: 'database' | 'cancelled'): StatementReport {
  const error = {
    kind,
    message: 'no',
    detail: null,
    hint: null,
    code: null,
    position: null,
  }
  return {
    range: { from: 0, to: 8 },
    elapsed_ms: 2100,
    outcome: { type: 'failed', error, location: null },
  }
}

function show(state: Partial<QueryState>) {
  activeQueryStore().setState({
    session: SESSION,
    ranSql: 'select 1',
    ...state,
  })
  render(<ResultsPane />)
}

describe('the run time in the results', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTabsStore.getState().reset()
    resetQueryStores()
    useResultsViewStore.getState().setView('results')
  })

  test('shows the time first in the status of a complete result', () => {
    show({ statements: [rows(true, 48)] })

    expect(screen.getByRole('status')).toHaveTextContent('48 ms · 2 rows')
  })

  test('says that the time is not final while the result has more rows', () => {
    show({ statements: [rows(false, 48)], open: { resultId: 4, index: 0 } })

    expect(screen.getByRole('status')).toHaveTextContent(
      '48 ms so far · 2 rows loaded.',
    )
    expect(screen.getByText('48 ms')).toHaveAttribute(
      'title',
      expect.stringContaining('increases when more rows load'),
    )
  })

  test('shows the time of a statement without rows', () => {
    const statement: StatementReport = {
      range: { from: 0, to: 8 },
      elapsed_ms: 1250,
      outcome: { type: 'command', affected_rows: 3 },
    }

    show({ statements: [statement] })

    expect(screen.getByRole('status')).toHaveTextContent(
      '1.25 s · The statement is complete. 3 rows affected.',
    )
  })

  test('shows the time of a statement that failed', () => {
    show({ statements: [failed('database')] })

    expect(screen.getByRole('status')).toHaveTextContent('Failed after 2.10 s.')
  })

  test('shows the time of a statement that the user cancelled', () => {
    show({ statements: [failed('cancelled')] })

    expect(screen.getByRole('status')).toHaveTextContent(
      'Cancelled after 2.10 s.',
    )
  })

  test('shows the time since the start of an active run', () => {
    show({ runState: 'running', runStartedAt: Date.now() - 3200 })

    expect(screen.getByText('Running…')).toHaveTextContent(
      /^Running… 3\.[2-9] s$/,
    )
  })

  test('cancels the active run from the results', async () => {
    const user = userEvent.setup()
    show({ runState: 'running', runStartedAt: Date.now() })

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(queryCancel).toHaveBeenCalledWith(7)
    expect(screen.getByText('Cancelling…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })

  test('a run shows the Results view when a different view is open', () => {
    useResultsViewStore.getState().setView('plan')
    show({})

    act(() => {
      activeQueryStore().setState({
        runState: 'running',
        runStartedAt: Date.now(),
      })
    })

    expect(useResultsViewStore.getState().view).toBe('results')
    expect(screen.getByText('Running…')).toBeInTheDocument()
  })

  test('has no Cancel button when no run is active', () => {
    show({ statements: [rows(true, 48)] })

    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })
})

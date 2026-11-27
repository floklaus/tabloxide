import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { runAiAction, type SessionStore } from '../../assistant/assistantStore'
import { activeQueryStore, resetQueryStores } from '../../query/queryStore'
import { ProposeChartButton } from './ProposeChartButton'
import { column } from './testColumns'

vi.mock('../../bindings', async () =>
  (await import('../../test/mockBindings')).createBindingsMock(),
)
vi.mock('../../assistant/assistantStore', () => ({ runAiAction: vi.fn() }))

const run = vi.mocked(runAiAction)
const COLUMNS = [column('country', 'text'), column('amount', 'number')]

/** A session of the assistant after its end, with this answer. */
function sessionWith(answer: string | null): SessionStore {
  const messages =
    answer === null ? [] : [{ role: 'assistant' as const, text: answer }]
  return {
    getState: () => ({
      messages,
      error: answer === null ? 'no network' : null,
    }),
  } as unknown as SessionStore
}

const ANSWER =
  'The chart shows the amount of each country.\n\n```json\n{"type": "bar", "x": "country", "y": ["amount"], "sort": "value-desc"}\n```\n'

async function ask(onSettings = vi.fn(), question = '') {
  render(<ProposeChartButton columns={COLUMNS} onSettings={onSettings} />)
  await userEvent.click(screen.getByRole('button', { name: 'Propose a chart' }))
  if (question) {
    await userEvent.type(
      screen.getByLabelText('What do you want to see? (optional)'),
      question,
    )
  }
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
  return onSettings
}

beforeEach(() => {
  vi.clearAllMocks()
  resetQueryStores()
})

describe('Propose a chart', () => {
  test('the dialog says what the request sends', async () => {
    render(<ProposeChartButton columns={COLUMNS} onSettings={vi.fn()} />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Propose a chart' }),
    )

    expect(screen.getByRole('dialog')).toHaveTextContent(
      'The request sends your question, and the names and the types of the 2 columns of this result. It sends no rows.',
    )
    expect(run).not.toHaveBeenCalled()
  })

  test('sends the question with the columns, and gives the chart the settings of the answer', async () => {
    run.mockResolvedValue(sessionWith(ANSWER))

    const onSettings = await ask(vi.fn(), 'The largest countries')

    await waitFor(() =>
      expect(onSettings).toHaveBeenCalledWith({
        type: 'bar',
        x: 'country',
        y: ['amount'],
        sort: 'value-desc',
      }),
    )
    expect(run).toHaveBeenCalledWith({
      task: 'chart',
      text: 'The largest countries',
      context: {
        type: 'result-columns',
        columns: [
          { name: 'country', type_name: null, kind: 'text' },
          { name: 'amount', type_name: null, kind: 'number' },
        ],
      },
    })
    expect(activeQueryStore().getState().notice).toBe(
      'The chart has the settings that the AI proposed. The answer is in the assistant panel.',
    )
  })

  test('an answer with a column that the result does not have changes nothing, and a notice gives the cause', async () => {
    run.mockResolvedValue(
      sessionWith(
        '```json\n{"type": "bar", "x": "region", "y": ["amount"]}\n```',
      ),
    )

    const onSettings = await ask()

    await waitFor(() =>
      expect(activeQueryStore().getState().notice).toBe(
        'The chart did not change. The answer uses the column region. The result does not have this column. The answer is in the assistant panel.',
      ),
    )
    expect(onSettings).not.toHaveBeenCalled()
  })

  test('a request that failed changes nothing', async () => {
    run.mockResolvedValue(sessionWith(null))

    const onSettings = await ask()

    await waitFor(() =>
      expect(activeQueryStore().getState().notice).toContain(
        'The AI gave no answer.',
      ),
    )
    expect(onSettings).not.toHaveBeenCalled()
  })

  test('without an API key, no request goes and nothing changes', async () => {
    run.mockResolvedValue(null)

    const onSettings = await ask()

    await waitFor(() => expect(run).toHaveBeenCalled())
    expect(onSettings).not.toHaveBeenCalled()
    expect(activeQueryStore().getState().notice).toBeNull()
  })

  test('"Cancel" sends nothing', async () => {
    render(<ProposeChartButton columns={COLUMNS} onSettings={vi.fn()} />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Propose a chart' }),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(run).not.toHaveBeenCalled()
  })
})

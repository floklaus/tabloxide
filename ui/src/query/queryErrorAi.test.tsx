import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands, type QueryError_Serialize as QueryError } from '../bindings'
import { AssistantPanel } from '../assistant/AssistantPanel'
import { useAssistantStore } from '../assistant/assistantStore'
import { ResultsPane } from '../results/ResultsPane'
import { resetShellStore } from '../shell/shellStore'
import { switchConnection } from '../shell/commands'
import { useTabsStore, type Tab } from '../tabs/tabsStore'
import { makeProfile, makeWorkspace } from '../test/fixtures'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { QueryEditor } from './QueryEditor'
import { resetQueryStores } from './queryStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('../editor/CodeEditor', () => import('../test/FakeCodeEditor'))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))

const queryRun = vi.mocked(commands.queryRun)
const assistantAsk = vi.mocked(commands.assistantAsk)

type AskResult = Awaited<ReturnType<typeof commands.assistantAsk>>

const SCRIPT = 'select 1;\nselect totl from orders'
/** The second statement of `SCRIPT`. */
const FAILED = { from: 10, to: 33 }
const FIX = 'select total from orders'
const ANSWER = `The column name is total.\n\n\`\`\`sql\n${FIX}\n\`\`\``

const tab: Tab = {
  id: 'tab-1',
  title: 'Query 1',
  path: null,
  content: '',
  savedContent: null,
  connectionId: null,
}

function ok<T>(data: T) {
  return { status: 'ok' as const, data }
}

function databaseError(kind: QueryError['kind'] = 'database'): QueryError {
  return {
    kind,
    message: 'column "totl" does not exist',
    detail: null,
    hint: 'Perhaps you meant "total".',
    code: '42703',
    position: 8,
  }
}

async function runWithError(kind: QueryError['kind'] = 'database') {
  useWorkspaceStore.setState({
    workspace: makeWorkspace([makeProfile({ id: 'c1', name: 'Shop' })]),
  })
  vi.mocked(commands.sessionOpen).mockResolvedValue(
    ok({
      status: 'connected',
      session: {
        id: 7,
        connection_id: 'c1',
        database: 'shop',
        server: { version: '17.2' },
      },
    }),
  )
  queryRun.mockResolvedValue(
    ok({
      open_result: null,
      statements: [
        {
          range: { from: 0, to: 8 },
          elapsed_ms: 1,
          outcome: { type: 'command' as const, affected_rows: 0 },
        },
        {
          range: FAILED,
          elapsed_ms: 1,
          outcome: {
            type: 'failed' as const,
            error: databaseError(kind),
            location: { offset: 17, line: 2, column: 8 },
          },
        },
      ],
    }),
  )
  assistantAsk.mockImplementation((_request, channel) => {
    channel.onmessage({ type: 'text', text: ANSWER })
    return Promise.resolve(
      ok({
        status: 'done',
        outcome: {
          stop: 'complete',
          model: 'claude-opus-5-5',
          input_tokens: 1,
          output_tokens: 1,
        },
        text: ANSWER,
      }),
    ) as Promise<AskResult>
  })
  render(
    <>
      <QueryEditor />
      <ResultsPane />
      <AssistantPanel />
    </>,
  )
  const user = userEvent.setup()
  await act(async () => switchConnection('c1'))
  const input = screen.getByRole<HTMLTextAreaElement>('textbox', {
    name: 'SQL',
  })
  await user.type(input, SCRIPT)
  await user.click(screen.getByRole('button', { name: 'Run all' }))
  // The failed statement is the last one. The results pane shows it.
  await screen.findByText('column "totl" does not exist')
  return { user, input }
}

describe('Explain and fix of a query error', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetQueryStores()
    resetShellStore()
    useAssistantStore.getState().reset()
    useAssistantStore.setState({ hasKey: true })
    vi.mocked(commands.assistantStatus).mockResolvedValue(ok({ has_key: true }))
    useTabsStore.setState({
      tabs: [tab],
      activeId: tab.id,
      isLoaded: true,
      error: null,
    })
  })

  test('sends the statement that failed and its error, without rows', async () => {
    const { user } = await runWithError()

    await user.click(screen.getByRole('button', { name: 'Explain and fix' }))

    expect(assistantAsk).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: 7,
        task: 'query-error',
        messages: [
          {
            role: 'user',
            text: 'Explain the error and fix the statement.',
            context: {
              type: 'query-error',
              statement: 'select totl from orders',
              message: 'column "totl" does not exist',
              detail: null,
              position: 8,
              hint: 'Perhaps you meant "total".',
              code: '42703',
            },
          },
        ],
      }),
      expect.anything(),
    )
  })

  test('Replace in the editor replaces only the statement that failed', async () => {
    const { user, input } = await runWithError()
    await user.click(screen.getByRole('button', { name: 'Explain and fix' }))

    const replace = await screen.findByRole('button', {
      name: 'Replace in the editor',
    })
    expect(replace).toBeEnabled()
    await user.click(replace)

    expect(input).toHaveValue(`select 1;\n${FIX}`)
    expect(queryRun).toHaveBeenCalledTimes(1)
    // The text is different now. A second replace is not possible.
    expect(replace).toBeDisabled()
  })

  test('after a change of the editor text, only Copy is available', async () => {
    const { user, input } = await runWithError()
    await user.click(screen.getByRole('button', { name: 'Explain and fix' }))
    const replace = await screen.findByRole('button', {
      name: 'Replace in the editor',
    })

    await user.type(input, ' where 1 = 1')

    expect(replace).toBeDisabled()
    expect(replace).toHaveAttribute(
      'title',
      'The text in the editor changed after the run. Copy the SQL.',
    )
    expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled()
  })

  test('a cancelled statement has no Explain and fix', async () => {
    await runWithError('cancelled')

    expect(
      screen.queryByRole('button', { name: 'Explain and fix' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Go to line 2, column 8' }),
    ).toBeInTheDocument()
  })
})

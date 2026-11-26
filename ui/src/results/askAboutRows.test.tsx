import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands, type Environment } from '../bindings'
import { AssistantPanel } from '../assistant/AssistantPanel'
import { useAssistantStore } from '../assistant/assistantStore'
import {
  DEFAULT_PREFERENCES,
  usePreferencesStore,
} from '../preferences/preferencesStore'
import { getQueryStore, resetQueryStores } from '../query/queryStore'
import { resetShellStore } from '../shell/shellStore'
import { useTabsStore, type Tab } from '../tabs/tabsStore'
import { makeProfile, makeWorkspace } from '../test/fixtures'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { ResultsPane } from './ResultsPane'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)

const assistantAsk = vi.mocked(commands.assistantAsk)

type AskResult = Awaited<ReturnType<typeof commands.assistantAsk>>

const tab: Tab = {
  id: 'tab-1',
  title: 'Query 1',
  path: null,
  content: 'select * from customer',
  savedContent: null,
  connectionId: 'c1',
}

const ROWS = [
  ['1', 'Ann'],
  ['2', null],
  ['3', 'Bo'],
]

function setup(environment: Environment, rowsForAi = 2) {
  useWorkspaceStore.setState({
    workspace: makeWorkspace([
      makeProfile({ id: 'c1', name: 'Shop', environment }),
    ]),
  })
  useTabsStore.setState({
    tabs: [tab],
    activeId: tab.id,
    sqlId: tab.id,
    isLoaded: true,
    error: null,
  })
  usePreferencesStore.setState({
    preferences: {
      ...DEFAULT_PREFERENCES,
      assistant: { ...DEFAULT_PREFERENCES.assistant, rows_for_ai: rowsForAi },
    },
  })
  getQueryStore(tab.id).setState({
    session: { id: 7, connectionId: 'c1', version: '17' },
    ranSql: tab.content,
    selected: 0,
    statements: [
      {
        range: { from: 0, to: tab.content.length },
        elapsed_ms: 1,
        outcome: {
          type: 'rows',
          columns: [
            { name: 'id', type_name: 'int4', kind: 'number' },
            { name: 'name', type_name: 'text', kind: 'text' },
          ],
          rows: ROWS,
          is_complete: true,
          total_rows: 3,
        },
      },
    ],
  })
  render(
    <>
      <ResultsPane />
      <AssistantPanel />
    </>,
  )
  return userEvent.setup()
}

describe('Ask about these rows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetQueryStores()
    resetShellStore()
    useAssistantStore.getState().reset()
    useAssistantStore.setState({ hasKey: true })
    vi.mocked(commands.assistantStatus).mockResolvedValue({
      status: 'ok',
      data: { has_key: true },
    })
    assistantAsk.mockResolvedValue({
      status: 'ok',
      data: {
        status: 'done',
        outcome: {
          stop: 'complete',
          model: 'claude-opus-5-5',
          input_tokens: 1,
          output_tokens: 1,
        },
        text: 'Two customers.',
      },
    } as AskResult)
  })

  test('the confirmation tells the rows, the columns, and the connection', async () => {
    const user = setup('development')

    await user.click(
      screen.getByRole('button', { name: 'Ask about these rows' }),
    )

    const dialog = screen.getByRole('dialog', {
      name: 'Send rows to Anthropic?',
    })
    expect(dialog).toHaveTextContent('The first 2 of 3 rows.')
    expect(dialog).toHaveTextContent('id, name')
    expect(dialog).toHaveTextContent('Shop')
    expect(within(dialog).getByText('development')).toHaveClass(
      'badge--development',
    )
    expect(
      within(dialog).getByRole('button', { name: 'Send 2 rows' }),
    ).toBeDisabled()
  })

  test('sends the question and only the number of rows of the preferences', async () => {
    const user = setup('staging')
    await user.click(
      screen.getByRole('button', { name: 'Ask about these rows' }),
    )

    await user.type(
      screen.getByRole('textbox', { name: 'Your question' }),
      'Which names are missing?',
    )
    await user.click(screen.getByRole('button', { name: 'Send 2 rows' }))

    expect(assistantAsk).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: 7,
        task: 'rows',
        messages: [
          {
            role: 'user',
            text: 'Which names are missing?',
            context: {
              type: 'rows',
              columns: [
                { name: 'id', type_name: 'int4' },
                { name: 'name', type_name: 'text' },
              ],
              rows: [
                ['1', 'Ann'],
                ['2', null],
              ],
              total_rows: 3,
            },
          },
        ],
      }),
      expect.anything(),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('Cancel sends nothing', async () => {
    const user = setup('development')
    await user.click(
      screen.getByRole('button', { name: 'Ask about these rows' }),
    )

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(assistantAsk).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('a production connection cannot send rows', () => {
    setup('production', 1000)

    const button = screen.getByRole('button', { name: 'Ask about these rows' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute(
      'title',
      'A production connection never sends rows to the AI. No setting changes this.',
    )
  })
})

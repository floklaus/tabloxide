import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { AssistantPanel } from '../assistant/AssistantPanel'
import { useAssistantStore } from '../assistant/assistantStore'
import { getQueryStore, resetQueryStores } from '../query/queryStore'
import { resetShellStore } from '../shell/shellStore'
import { useTabsStore, type Tab } from '../tabs/tabsStore'
import { makeProfile, makeWorkspace } from '../test/fixtures'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { TableDetail } from './TableDetail'
import { useSchemaStore } from './schemaStore'
import { relationKey } from './treeModel'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)

const assistantAsk = vi.mocked(commands.assistantAsk)

type AskResult = Awaited<ReturnType<typeof commands.assistantAsk>>

const tab: Tab = {
  id: 'tab-1',
  title: 'Query 1',
  path: null,
  content: '',
  savedContent: null,
  connectionId: 'c1',
}

function answerWith(text: string) {
  assistantAsk.mockImplementation((_request, channel) => {
    channel.onmessage({ type: 'text', text })
    return Promise.resolve({
      status: 'ok',
      data: {
        status: 'done',
        outcome: {
          stop: 'complete',
          model: 'claude-opus-5-5',
          input_tokens: 1,
          output_tokens: 1,
        },
        text,
      },
    } as AskResult)
  })
}

function setup() {
  useWorkspaceStore.setState({
    workspace: makeWorkspace([makeProfile({ id: 'c1', name: 'Shop' })]),
  })
  useTabsStore.setState({
    tabs: [tab],
    activeId: tab.id,
    sqlId: tab.id,
    isLoaded: true,
    error: null,
  })
  getQueryStore(tab.id).setState({
    session: { id: 7, connectionId: 'c1', version: '17' },
  })
  useSchemaStore.setState({
    selected: { schema: 'sales', name: 'orders' },
    details: {
      [relationKey('sales', 'orders')]: {
        status: 'loaded',
        data: { columns: [], indexes: [], constraints: [] },
      },
    },
  })
  render(
    <>
      <TableDetail />
      <AssistantPanel />
    </>,
  )
  return userEvent.setup()
}

describe('AI actions of a table', () => {
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
  })

  test('Explain the table sends only the name, and the backend reads the structure', async () => {
    const user = setup()
    answerWith('Each row is one order.')

    await user.click(screen.getByRole('button', { name: 'Explain the table' }))

    expect(assistantAsk).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: 7,
        task: 'explain-table',
        messages: [
          {
            role: 'user',
            text: 'Explain the table sales.orders.',
            context: { type: 'relation', schema: 'sales', name: 'orders' },
          },
        ],
      }),
      expect.anything(),
    )
    expect(
      await screen.findByText('Each row is one order.'),
    ).toBeInTheDocument()
    expect(useTabsStore.getState().tabs).toHaveLength(1)
  })

  test('Write a starter query opens the query in a new tab with the connection', async () => {
    const user = setup()
    answerWith(
      'A first query.\n\n```sql\nselect * from sales.orders limit 100\n```',
    )

    await user.click(
      screen.getByRole('button', { name: 'Write a starter query' }),
    )

    await waitFor(() => expect(useTabsStore.getState().tabs).toHaveLength(2))
    const { tabs, activeId } = useTabsStore.getState()
    const opened = tabs[1]
    expect(opened.title).toBe('orders: starter query')
    expect(opened.content).toBe('select * from sales.orders limit 100\n')
    expect(opened.connectionId).toBe('c1')
    expect(activeId).toBe(opened.id)
    expect(commands.queryRun).not.toHaveBeenCalled()
  })

  test('an answer without one code block opens no tab', async () => {
    const user = setup()
    answerWith('The table has no columns.')

    await user.click(
      screen.getByRole('button', { name: 'Write a starter query' }),
    )

    expect(
      await screen.findByText('The table has no columns.'),
    ).toBeInTheDocument()
    expect(useTabsStore.getState().tabs).toHaveLength(1)
  })
})

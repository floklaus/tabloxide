import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { getQueryStore, resetQueryStores } from '../query/queryStore'
import { QueryEditor } from '../query/QueryEditor'
import { resetShellStore } from '../shell/shellStore'
import { useTabsStore, type Tab } from '../tabs/tabsStore'
import { makeProfile, makeWorkspace } from '../test/fixtures'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { AssistantPanel } from './AssistantPanel'
import { useAssistantStore } from './assistantStore'
import { useInlineChange } from './inlineChange'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('../editor/CodeEditor', () => import('../test/FakeCodeEditor'))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))

const assistantAsk = vi.mocked(commands.assistantAsk)
const queryPreview = vi.mocked(commands.queryPreview)

type AskResult = Awaited<ReturnType<typeof commands.assistantAsk>>

const SQL = 'select 1;\nselect * from orders'
const SECOND = { from: 10, to: 30 }
const CHANGED = 'select * from orders\nwhere total > 100'

const tab: Tab = {
  id: 'tab-1',
  title: 'Query 1',
  path: null,
  content: SQL,
  savedContent: null,
  connectionId: 'c1',
}

/** Answers each request with `text`. */
function answerWith(...texts: string[]) {
  for (const text of texts) {
    assistantAsk.mockImplementationOnce((_request, channel) => {
      channel.onmessage({ type: 'sent', summary: 'Sent: your request.' })
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
}

const block = (code: string) => `Changed.\n\n\`\`\`sql\n${code}\n\`\`\``

function setup() {
  useWorkspaceStore.setState({
    workspace: makeWorkspace([makeProfile({ id: 'c1', name: 'Shop' })]),
  })
  useTabsStore.setState({
    tabs: [tab],
    activeId: tab.id,
    isLoaded: true,
    error: null,
  })
  getQueryStore(tab.id).setState({
    session: { id: 7, connectionId: 'c1', version: '17' },
  })
  render(
    <>
      <QueryEditor />
      <AssistantPanel />
    </>,
  )
  const editor = screen.getByRole<HTMLTextAreaElement>('textbox', {
    name: 'SQL',
  })
  return { user: userEvent.setup(), editor }
}

/** Puts the cursor into the second statement and presses Ctrl+I. */
async function openChange(
  user: ReturnType<typeof userEvent.setup>,
  editor: HTMLTextAreaElement,
) {
  editor.focus()
  editor.setSelectionRange(15, 15)
  await user.keyboard('{Control>}i{/Control}')
  return screen.findByRole('textbox', { name: 'Instruction for the change' })
}

describe('AI change of the selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetQueryStores()
    resetShellStore()
    useAssistantStore.getState().reset()
    useAssistantStore.setState({ hasKey: true })
    useInlineChange.getState().close()
    vi.mocked(commands.assistantStatus).mockResolvedValue({
      status: 'ok',
      data: { has_key: true },
    })
    queryPreview.mockResolvedValue([{ range: SECOND, risk: null }])
  })

  test('Ctrl+I sends the statement at the cursor and the instruction, and shows the proposal', async () => {
    const { user, editor } = setup()
    answerWith(block(CHANGED))

    const input = await openChange(user, editor)
    expect(editor.readOnly).toBe(true)
    await user.type(input, 'Only the large orders.{Enter}')

    expect(assistantAsk).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: 7,
        task: 'change-selection',
        messages: [
          {
            role: 'user',
            text: 'Only the large orders.',
            context: { type: 'selection', text: 'select * from orders' },
          },
        ],
      }),
      expect.anything(),
    )
    expect(
      await screen.findByRole('button', { name: 'Accept' }),
    ).toBeInTheDocument()
    expect(editor.dataset.proposal).toBe(CHANGED)
    expect(editor).toHaveValue(SQL)
    expect(screen.getByText(/Ctrl\+Enter accepts/)).toHaveTextContent(
      'Sent: your request.',
    )
    // The request does not go to the session list of the panel.
    expect(
      useAssistantStore.getState().sessions[0].store.getState().title,
    ).toBe(null)
  })

  test('Ctrl+Enter accepts: it replaces only the statement, and the editor is editable again', async () => {
    const { user, editor } = setup()
    answerWith(block(CHANGED))
    const input = await openChange(user, editor)
    await user.type(input, 'Only the large orders.{Enter}')

    await screen.findByRole('button', { name: 'Accept' })
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(editor).toHaveValue(`select 1;\n${CHANGED}`)
    expect(editor.readOnly).toBe(false)
    expect(
      screen.queryByRole('region', { name: 'Change the selection with AI' }),
    ).not.toBeInTheDocument()
  })

  test('Escape rejects the proposal and the text stays', async () => {
    const { user, editor } = setup()
    answerWith(block(CHANGED))
    const input = await openChange(user, editor)
    await user.type(input, 'Only the large orders.{Enter}')
    expect(await screen.findByRole('button', { name: 'Accept' })).toHaveFocus()

    await user.keyboard('{Escape}')

    expect(editor).toHaveValue(SQL)
    expect(editor.readOnly).toBe(false)
    expect(editor.dataset.proposal).toBeUndefined()
  })

  test('Change again sends a new instruction in the same conversation', async () => {
    const { user, editor } = setup()
    answerWith(block(CHANGED), block('select id from orders'))
    const input = await openChange(user, editor)
    await user.type(input, 'Only the large orders.{Enter}')
    await user.click(
      await screen.findByRole('button', { name: 'Change again' }),
    )

    await user.type(
      screen.getByRole('textbox', { name: 'Instruction for the change' }),
      'Only the id.{Enter}',
    )

    const second = assistantAsk.mock.calls[1][0]
    expect(second.messages).toHaveLength(3)
    expect(second.messages[2]).toEqual({
      role: 'user',
      text: 'Only the id.',
      context: null,
    })
    await screen.findByRole('button', { name: 'Accept' })
    expect(editor.dataset.proposal).toBe('select id from orders')
  })

  test('an answer without exactly one code block shows an error and no proposal', async () => {
    const { user, editor } = setup()
    answerWith(`Two options.\n\n${block('select 1')}\n\n${block('select 2')}`)
    const input = await openChange(user, editor)

    await user.type(input, 'Make it faster.{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The AI did not give exactly one changed text.',
    )
    expect(editor.dataset.proposal).toBeUndefined()
    expect(editor.readOnly).toBe(true)
    expect(
      screen.getByRole('textbox', { name: 'Instruction for the change' }),
    ).toBeInTheDocument()
  })

  test('the preview shows the risk of the proposed text', async () => {
    const { user, editor } = setup()
    queryPreview.mockResolvedValue([{ range: SECOND, risk: 'drop' }])
    answerWith(block('drop table orders'))
    const input = await openChange(user, editor)

    await user.type(input, 'Remove the table.{Enter}')

    expect(
      await screen.findByText('Before you run it: DROP removes an object.'),
    ).toBeInTheDocument()
  })

  test('Ctrl+Shift+I explains the selection in the assistant panel', async () => {
    const { user, editor } = setup()
    answerWith('It reads all orders.')
    editor.focus()
    editor.setSelectionRange(0, 8)

    await act(() => user.keyboard('{Control>}{Shift>}i{/Shift}{/Control}'))

    expect(queryPreview).not.toHaveBeenCalled()
    expect(assistantAsk).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'explain-selection',
        messages: [
          {
            role: 'user',
            text: 'Explain the selected text.',
            context: { type: 'selection', text: 'select 1' },
          },
        ],
      }),
      expect.anything(),
    )
    expect(await screen.findByText('It reads all orders.')).toBeInTheDocument()
  })
})

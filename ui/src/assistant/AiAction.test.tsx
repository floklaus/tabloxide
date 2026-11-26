import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands, type ActionContext, type AssistantEvent } from '../bindings'
import { getQueryStore, resetQueryStores } from '../query/queryStore'
import { resetShellStore, useShellStore } from '../shell/shellStore'
import { useTabsStore } from '../tabs/tabsStore'
import { makeProfile, makeWorkspace } from '../test/fixtures'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { AiAction } from './AiAction'
import { AssistantPanel } from './AssistantPanel'
import {
  activeSession,
  useAssistantStore,
  type ActionRequest,
} from './assistantStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)

const assistantAsk = vi.mocked(commands.assistantAsk)
const assistantStatus = vi.mocked(commands.assistantStatus)

type AskResult = Awaited<ReturnType<typeof commands.assistantAsk>>

const OUTCOME = {
  stop: 'complete' as const,
  model: 'claude-opus-5-5',
  input_tokens: 100,
  output_tokens: 20,
}

const ERROR: ActionContext = {
  type: 'query-error',
  statement: 'select o.totl from orders o',
  message: 'column o.totl does not exist',
  position: 8,
  hint: null,
  code: '42703',
}

const FIX: ActionRequest = {
  task: 'query-error',
  text: 'Explain the error and fix the statement.',
  context: ERROR,
}

/** Answers each request with `text`, after the events `before`. */
function answerWith(text: string, before: AssistantEvent[] = []) {
  assistantAsk.mockImplementation((_request, channel) => {
    for (const event of before) channel.onmessage(event)
    channel.onmessage({ type: 'text', text })
    return Promise.resolve({
      status: 'ok',
      data: { status: 'done', outcome: OUTCOME, text },
    } as AskResult)
  })
}

function setup() {
  useWorkspaceStore.setState({
    workspace: makeWorkspace([makeProfile({ id: 'c1', name: 'Live' })]),
  })
  const tabId = useTabsStore.getState().newTab('select 1')
  useTabsStore.getState().setConnection(tabId, 'c1')
  getQueryStore(tabId).setState({
    session: { id: 7, connectionId: 'c1', version: '17' },
  })
  return userEvent.setup()
}

describe('AiAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetQueryStores()
    resetShellStore()
    useTabsStore.getState().reset()
    useAssistantStore.getState().reset()
    useAssistantStore.setState({ hasKey: true })
    assistantStatus.mockResolvedValue({ status: 'ok', data: { has_key: true } })
  })

  test('shows the sparkle icon and sends the action with its data', async () => {
    const user = setup()
    answerWith('The column is total.', [
      { type: 'schema', relations: 12, detailed: 12 },
      {
        type: 'sent',
        summary:
          'Sent: your request, the statement, the error message, and the structure of 12 tables and views.',
      },
    ])
    useShellStore.setState({
      panels: { ...useShellStore.getState().panels, assistant: false },
    })
    render(
      <>
        <AiAction label="Explain and fix" request={() => FIX} />
        <AssistantPanel />
      </>,
    )

    const button = screen.getByRole('button', { name: 'Explain and fix' })
    expect(button.querySelector('svg.icon')).not.toBeNull()
    await user.click(button)

    expect(useShellStore.getState().panels.assistant).toBe(true)
    expect(assistantAsk).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: 7,
        task: 'query-error',
        messages: [{ role: 'user', text: FIX.text, context: ERROR }],
      }),
      expect.anything(),
    )
    expect(
      await screen.findByText(
        'Sent: your request, the statement, the error message, and the structure of 12 tables and views.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('The column is total.')).toBeInTheDocument()
  })

  test('a later request of the session sends the data of the earlier action again', async () => {
    setup()
    answerWith('Answer.')
    const session = activeSession()

    await act(() => session.getState().runAction(FIX))
    session.getState().setDraft('Why?')
    await act(() => session.getState().send())

    const request = assistantAsk.mock.calls[1][0]
    expect(request.task).toBe('sql')
    expect(request.messages).toEqual([
      { role: 'user', text: FIX.text, context: ERROR },
      { role: 'assistant', text: 'Answer.', context: null },
      { role: 'user', text: 'Why?', context: null },
    ])
  })

  test('a Git action does not connect and sends no session', async () => {
    useWorkspaceStore.setState({
      workspace: makeWorkspace([makeProfile({ id: 'c1', name: 'Live' })]),
    })
    const tabId = useTabsStore.getState().newTab('select 1')
    useTabsStore.getState().setConnection(tabId, 'c1')
    answerWith('Answer.')

    await act(() =>
      activeSession()
        .getState()
        .runAction({
          task: 'git-output',
          text: 'Explain the last output.',
          context: { type: 'git-output', command: 'status', output: 'clean' },
        }),
    )

    expect(commands.sessionOpen).not.toHaveBeenCalled()
    expect(assistantAsk).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: null, task: 'git-output' }),
      expect.anything(),
    )
    expect(activeSession().getState().context).toBeNull()
  })

  test('without an API key, the action opens the setup and sends nothing', async () => {
    const user = setup()
    useAssistantStore.setState({ hasKey: false })
    assistantStatus.mockResolvedValue({
      status: 'ok',
      data: { has_key: false },
    })
    render(
      <>
        <AiAction label="Explain and fix" request={() => FIX} />
        <AssistantPanel />
      </>,
    )

    await user.click(screen.getByRole('button', { name: 'Explain and fix' }))

    expect(assistantAsk).not.toHaveBeenCalled()
    expect(
      await screen.findByLabelText('API key of Anthropic'),
    ).toBeInTheDocument()
  })

  test('an action during a request of the panel starts a new session', async () => {
    const user = setup()
    let finish: (result: AskResult) => void = () => {}
    assistantAsk.mockImplementationOnce(
      () =>
        new Promise<AskResult>((resolve) => {
          finish = resolve
        }),
    )
    const first = activeSession()
    first.getState().setDraft('A long request')
    void first.getState().send()
    await waitFor(() => expect(first.getState().status).toBe('waiting'))
    answerWith('Fixed.')
    render(<AiAction label="Explain and fix" request={() => FIX} />)

    await user.click(screen.getByRole('button', { name: 'Explain and fix' }))

    expect(activeSession()).not.toBe(first)
    expect(useAssistantStore.getState().sessions).toHaveLength(2)
    expect(activeSession().getState().messages[0].text).toBe(FIX.text)
    finish({
      status: 'ok',
      data: { status: 'cancelled', text: 'x' },
    } as AskResult)
  })
})

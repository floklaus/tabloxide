import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  commands,
  type AssistantEvent,
  type ConfirmRule,
  type Environment,
} from '../bindings'
import {
  DEFAULT_PREFERENCES,
  usePreferencesStore,
} from '../preferences/preferencesStore'
import { QueryEditor } from '../query/QueryEditor'
import { getQueryStore, resetQueryStores } from '../query/queryStore'
import { useTabsStore } from '../tabs/tabsStore'
import { makeProfile, makeWorkspace } from '../test/fixtures'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { AssistantPanel } from './AssistantPanel'
import { planRequest, useAssistantStore } from './assistantStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('../editor/CodeEditor', () => import('../test/FakeCodeEditor'))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))

const assistantAsk = vi.mocked(commands.assistantAsk)
const assistantStatus = vi.mocked(commands.assistantStatus)
const assistantKeySet = vi.mocked(commands.assistantKeySet)
const assistantCancel = vi.mocked(commands.assistantCancel)
const assistantExplain = vi.mocked(commands.assistantExplain)
const queryPreview = vi.mocked(commands.queryPreview)
const sessionOpen = vi.mocked(commands.sessionOpen)

type AskResult = Awaited<ReturnType<typeof commands.assistantAsk>>

const SQL = 'select * from item where price > 10'
const OUTCOME = {
  stop: 'complete' as const,
  model: 'claude-opus-5-5',
  input_tokens: 100,
  output_tokens: 20,
}

function ok<T>(data: T) {
  return { status: 'ok' as const, data }
}

function done(
  text: string,
  stop: 'complete' | 'truncated' | 'refused' = 'complete',
) {
  return ok({ status: 'done' as const, outcome: { ...OUTCOME, stop }, text })
}

/**
 * Makes the request stay in progress. Returns a function that sends an event of
 * the backend to the UI and a function that ends the request.
 */
function pendingAsk() {
  let finish: (result: AskResult) => void = () => {}
  let send: (event: AssistantEvent) => void = () => {}
  assistantAsk.mockImplementation((_request, channel) => {
    send = (event) => channel.onmessage(event)
    return new Promise<AskResult>((resolve) => {
      finish = resolve
    })
  })
  return {
    send: (event: AssistantEvent) => act(() => send(event)),
    finish: (result: AskResult) => act(() => finish(result)),
  }
}

/** Makes the request answer with `text` immediately. */
function answerWith(text: string, result: AskResult = done(text)) {
  assistantAsk.mockImplementation((_request, channel) => {
    channel.onmessage({ type: 'schema', relations: 3, detailed: 3 })
    channel.onmessage({ type: 'text', text })
    return Promise.resolve(result)
  })
}

function setRule(environment: Environment, rule: ConfirmRule) {
  usePreferencesStore.setState({
    preferences: {
      ...DEFAULT_PREFERENCES,
      guardrails: { ...DEFAULT_PREFERENCES.guardrails, [environment]: rule },
    },
  })
}

function setup(options: { environment?: Environment; session?: boolean } = {}) {
  const { environment = 'development', session = true } = options
  useWorkspaceStore.setState({
    workspace: makeWorkspace([
      makeProfile({ id: 'c1', name: 'Live', environment }),
    ]),
  })
  const tabId = useTabsStore.getState().newTab(SQL)
  useTabsStore.getState().setConnection(tabId, 'c1')
  if (session) {
    getQueryStore(tabId).setState({
      session: { id: 7, connectionId: 'c1', version: '17' },
    })
  }
  render(
    <>
      <QueryEditor />
      <AssistantPanel />
    </>,
  )
  return userEvent.setup()
}

async function sendRequest(
  user: ReturnType<typeof userEvent.setup>,
  text: string,
) {
  await user.type(screen.getByRole('textbox', { name: 'Request' }), text)
  await user.click(screen.getByRole('button', { name: 'Send' }))
}

describe('AssistantPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetQueryStores()
    useTabsStore.getState().reset()
    useAssistantStore.getState().reset()
    useAssistantStore.setState({ hasKey: null })
    usePreferencesStore.setState({ preferences: DEFAULT_PREFERENCES })
    assistantStatus.mockResolvedValue(ok({ has_key: true }))
    queryPreview.mockResolvedValue([
      { range: { from: 0, to: SQL.length }, risk: null },
    ])
  })

  test('asks for the API key when no key is stored, and stores the key', async () => {
    assistantStatus.mockResolvedValue(ok({ has_key: false }))
    const user = setup()

    const input = await screen.findByLabelText('API key of Anthropic')
    expect(screen.queryByRole('textbox', { name: 'Request' })).toBeNull()
    await user.type(input, '  sk-test  ')
    await user.click(screen.getByRole('button', { name: 'Save the key' }))

    expect(assistantKeySet).toHaveBeenCalledWith('  sk-test  ')
    expect(
      await screen.findByRole('textbox', { name: 'Request' }),
    ).toBeInTheDocument()
    expect(input).not.toBeInTheDocument()
  })

  test('sends the request with the session of the tab and shows the answer', async () => {
    const user = setup()
    answerWith('Use this:\n```sql\nSELECT 1;\n```')

    await sendRequest(user, 'Count the items')

    expect(assistantAsk).toHaveBeenCalledWith(
      {
        id: expect.any(Number),
        session_id: 7,
        task: 'sql',
        messages: [{ role: 'user', text: 'Count the items' }],
        refresh_schema: false,
      },
      expect.anything(),
    )
    expect(await screen.findByText('Count the items')).toBeInTheDocument()
    expect(screen.getByText('SELECT 1;')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Request' })).toHaveValue('')
    expect(
      screen.getByText(/The request has the structure of 3 tables and views\./),
    ).toBeInTheDocument()
  })

  test('sends the earlier messages with the next request', async () => {
    const user = setup()
    answerWith('First answer')
    await sendRequest(user, 'First')
    await screen.findByText('First answer')
    answerWith('Second answer')

    await sendRequest(user, 'Second')

    expect(assistantAsk.mock.calls[1][0].messages).toEqual([
      { role: 'user', text: 'First' },
      { role: 'assistant', text: 'First answer' },
      { role: 'user', text: 'Second' },
    ])
  })

  test('shows the text while the answer comes, and the status', async () => {
    const user = setup()
    const ask = pendingAsk()

    await sendRequest(user, 'Count the items')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Waiting for the answer…',
    )
    ask.send({ type: 'reading-schema' })
    expect(screen.getByRole('status')).toHaveTextContent(
      'Reading the schema from the database…',
    )
    ask.send({ type: 'text', text: 'SELECT ' })
    ask.send({ type: 'text', text: 'count(*)' })

    expect(screen.getByText('SELECT count(*)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    await ask.finish(done('SELECT count(*)'))
    await waitFor(() =>
      expect(useAssistantStore.getState().status).toBe('idle'),
    )
  })

  test('inserts a code block of the answer into the editor', async () => {
    const user = setup()
    answerWith('```sql\nSELECT 1;\n```')
    await sendRequest(user, 'x')

    await user.click(await screen.findByRole('button', { name: 'Insert' }))

    const tab = useTabsStore.getState().tabs[0]
    expect(tab.content).toContain('SELECT 1;\n')
    expect(commands.queryRun).not.toHaveBeenCalled()
  })

  test('a failure removes the request and puts its text back into the field', async () => {
    const user = setup()
    assistantAsk.mockResolvedValue(
      ok({
        status: 'failed' as const,
        error: { kind: 'rate-limit' as const, message: 'Too many requests.' },
      }),
    )

    await sendRequest(user, 'Count the items')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many requests.',
    )
    expect(screen.getByRole('textbox', { name: 'Request' })).toHaveValue(
      'Count the items',
    )
    expect(useAssistantStore.getState().messages).toEqual([])
  })

  test('the stop button cancels the request and keeps the partial answer', async () => {
    const user = setup()
    const ask = pendingAsk()
    await sendRequest(user, 'Count the items')
    ask.send({ type: 'text', text: 'SELECT' })

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(assistantCancel).toHaveBeenCalledWith(expect.any(Number))
    await ask.finish(ok({ status: 'cancelled' as const, text: 'SELECT' }))

    expect(
      await screen.findByText('You stopped this answer. It is not complete.'),
    ).toBeInTheDocument()
    expect(screen.getByText('SELECT')).toBeInTheDocument()
  })

  test('shows a note for an answer that is not complete', async () => {
    const user = setup()
    answerWith('SELECT', done('SELECT', 'truncated'))

    await sendRequest(user, 'x')

    expect(
      await screen.findByText(
        'The answer got to the maximum length. It is not complete.',
      ),
    ).toBeInTheDocument()
  })

  test('connects the tab before the request when it has no session', async () => {
    const user = setup({ session: false })
    sessionOpen.mockResolvedValue(
      ok({
        status: 'connected' as const,
        session: {
          id: 9,
          connection_id: 'c1',
          database: 'app',
          server: { version: '17' },
        },
      }),
    )
    answerWith('ok')

    await sendRequest(user, 'x')

    await screen.findByText('ok')
    expect(sessionOpen).toHaveBeenCalledWith('c1')
    expect(assistantAsk.mock.calls[0][0].session_id).toBe(9)
  })

  test('reads the schema again with the next request on demand', async () => {
    const user = setup()
    answerWith('First answer')
    await sendRequest(user, 'First')
    await screen.findByText('First answer')

    await user.click(
      screen.getByRole('button', { name: 'Read the schema again' }),
    )
    await sendRequest(user, 'Second')

    expect(assistantAsk.mock.calls[1][0].refresh_schema).toBe(true)
    expect(useAssistantStore.getState().refreshesSchema).toBe(false)
  })

  test('reads the plan of the statement and asks for its analysis', async () => {
    const user = setup()
    assistantExplain.mockResolvedValue(
      ok({
        status: 'plan' as const,
        statement: `EXPLAIN ${SQL}`,
        plan: 'Seq Scan on item',
        is_truncated: false,
      }),
    )
    answerWith('Add an index.')

    await user.click(screen.getByRole('button', { name: 'Analyze plan' }))

    await screen.findByText('Add an index.')
    expect(assistantExplain).toHaveBeenCalledWith(7, SQL, false)
    expect(assistantAsk.mock.calls[0][0]).toMatchObject({
      task: 'plan',
      messages: [
        {
          role: 'user',
          text: planRequest(SQL, 'Seq Scan on item', false, false),
        },
      ],
    })
    expect(screen.getByText('Seq Scan on item')).toBeInTheDocument()
  })

  test('shows the reason when the application does not read the plan', async () => {
    const user = setup()
    assistantExplain.mockResolvedValue(
      ok({
        status: 'rejected' as const,
        reason: 'analyze-changes-data' as const,
        message: 'EXPLAIN ANALYZE runs the statement.',
      }),
    )

    await user.click(
      screen.getByRole('checkbox', { name: /Measure the times/ }),
    )
    await user.click(screen.getByRole('button', { name: 'Analyze plan' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'EXPLAIN ANALYZE runs the statement.',
    )
    expect(assistantExplain).toHaveBeenCalledWith(7, SQL, true)
    expect(assistantAsk).not.toHaveBeenCalled()
  })

  test('asks before EXPLAIN ANALYZE when the rule of the environment asks before each run', async () => {
    const user = setup({ environment: 'production' })
    setRule('production', 'always')
    assistantExplain.mockResolvedValue(
      ok({
        status: 'plan' as const,
        statement: `EXPLAIN ANALYZE ${SQL}`,
        plan: 'Seq Scan on item (actual time=1.0)',
        is_truncated: false,
      }),
    )
    answerWith('Add an index.')

    await user.click(
      screen.getByRole('checkbox', { name: /Measure the times/ }),
    )
    await user.click(screen.getByRole('button', { name: 'Analyze plan' }))

    const dialog = await screen.findByRole('dialog', {
      name: 'Run the statement?',
    })
    expect(dialog).toHaveTextContent('Live')
    expect(assistantExplain).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Run and analyze' }))

    await screen.findByText('Add an index.')
    expect(assistantExplain).toHaveBeenCalledWith(7, SQL, true)
  })

  test('does not ask before EXPLAIN without ANALYZE', async () => {
    const user = setup({ environment: 'production' })
    setRule('production', 'always')
    assistantExplain.mockResolvedValue(
      ok({
        status: 'failed' as const,
        error: {
          kind: 'database' as const,
          message: 'syntax error',
          detail: null,
          hint: null,
          code: null,
          position: null,
        },
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Analyze plan' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The database did not make the plan: syntax error',
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('a new conversation removes the messages', async () => {
    const user = setup()
    answerWith('First answer')
    await sendRequest(user, 'First')
    await screen.findByText('First answer')

    await user.click(screen.getByRole('button', { name: 'New conversation' }))

    expect(screen.queryByText('First answer')).toBeNull()
    expect(useAssistantStore.getState().messages).toEqual([])
  })

  test('uses the complete text of the result, also when text parts are late', async () => {
    const user = setup()
    assistantAsk.mockImplementation((_request, channel) => {
      channel.onmessage({ type: 'text', text: 'SELECT ' })
      return Promise.resolve(done('SELECT count(*) FROM item'))
    })

    await sendRequest(user, 'x')

    expect(
      await screen.findByText('SELECT count(*) FROM item'),
    ).toBeInTheDocument()
    expect(useAssistantStore.getState().messages[1].text).toBe(
      'SELECT count(*) FROM item',
    )
  })

  test('keeps the request on its tab when the user selects a different tab during the connect', async () => {
    const user = setup({ session: false })
    const firstTab = useTabsStore.getState().tabs[0].id
    let connected: (
      value: Awaited<ReturnType<typeof commands.sessionOpen>>,
    ) => void = () => {}
    sessionOpen.mockImplementation(
      () => new Promise((resolve) => (connected = resolve)),
    )
    answerWith('ok')
    await sendRequest(user, 'x')

    // The second tab has a session on a different connection.
    const otherTab = useTabsStore.getState().newTab('select 2')
    getQueryStore(otherTab).setState({
      session: { id: 99, connectionId: 'c2', version: '17' },
    })
    await act(async () => {
      connected(
        ok({
          status: 'connected' as const,
          session: {
            id: 9,
            connection_id: 'c1',
            database: 'app',
            server: { version: '17' },
          },
        }),
      )
    })

    await waitFor(() => expect(assistantAsk).toHaveBeenCalled())
    expect(assistantAsk.mock.calls[0][0].session_id).toBe(9)
    expect(getQueryStore(firstTab).getState().session?.id).toBe(9)
  })

  test('a stop during the connect does not send the request', async () => {
    const user = setup({ session: false })
    let connected: (
      value: Awaited<ReturnType<typeof commands.sessionOpen>>,
    ) => void = () => {}
    sessionOpen.mockImplementation(
      () => new Promise((resolve) => (connected = resolve)),
    )
    await sendRequest(user, 'Count the items')

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    await act(async () => {
      connected(
        ok({
          status: 'connected' as const,
          session: {
            id: 9,
            connection_id: 'c1',
            database: 'app',
            server: { version: '17' },
          },
        }),
      )
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You stopped the request.',
    )
    expect(assistantAsk).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Request' })).toHaveValue(
      'Count the items',
    )
  })

  test('a request that ends after a reset does not change the new state', async () => {
    const user = setup()
    const ask = pendingAsk()
    await sendRequest(user, 'Old question')

    act(() => useAssistantStore.getState().reset())
    expect(assistantCancel).toHaveBeenCalledWith(expect.any(Number))
    await ask.send({ type: 'text', text: 'late text' })
    await ask.finish(
      ok({
        status: 'failed' as const,
        error: { kind: 'network' as const, message: 'closed' },
      }),
    )

    const state = useAssistantStore.getState()
    expect(state.messages).toEqual([])
    expect(state.answer).toBe('')
    expect(state.error).toBeNull()
    expect(state.draft).toBe('')
  })

  test('the stop button cancels the statement of a plan read', async () => {
    const user = setup()
    let finish: (
      value: Awaited<ReturnType<typeof commands.assistantExplain>>,
    ) => void = () => {}
    assistantExplain.mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    )
    await user.click(screen.getByRole('button', { name: 'Analyze plan' }))
    await waitFor(() => expect(assistantExplain).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(commands.queryCancel).toHaveBeenCalledWith(7)
    await act(async () => {
      finish(
        ok({
          status: 'failed' as const,
          error: {
            kind: 'cancelled' as const,
            message: 'canceling statement due to user request',
            detail: null,
            hint: null,
            code: null,
            position: null,
          },
        }),
      )
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You stopped the plan read.',
    )
    expect(assistantAsk).not.toHaveBeenCalled()
  })

  test('tells the results pane that the assistant closed the open result', async () => {
    const user = setup()
    const tabId = useTabsStore.getState().tabs[0].id
    getQueryStore(tabId).setState({ open: { resultId: 3, index: 0 } })
    assistantAsk.mockImplementation((_request, channel) => {
      channel.onmessage({ type: 'reading-schema' })
      channel.onmessage({ type: 'text', text: 'ok' })
      return Promise.resolve(done('ok'))
    })

    await sendRequest(user, 'x')

    await screen.findByText('ok')
    expect(getQueryStore(tabId).getState()).toMatchObject({
      open: null,
      stopReason: 'assistant',
    })
  })

  test('tells a screen reader when the answer is complete, and not each text part', async () => {
    const user = setup()
    answerWith('First answer')

    await sendRequest(user, 'First')

    await screen.findByText('First answer')
    expect(screen.getByRole('status')).toHaveTextContent(
      'The answer is complete.',
    )
    const conversation = screen.getByRole('region', { name: 'Conversation' })
    expect(conversation).not.toHaveAttribute('aria-live')
    expect(conversation).not.toHaveAttribute('role', 'log')
  })

  test('the focus goes to the request field when the stop button goes away', async () => {
    const user = setup()
    const ask = pendingAsk()
    await sendRequest(user, 'Count the items')
    await ask.send({ type: 'text', text: 'SELECT' })

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    await ask.finish(ok({ status: 'cancelled' as const, text: 'SELECT' }))

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Request' })).toHaveFocus(),
    )
  })
})

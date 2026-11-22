import { act, render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands, type AssistantEvent } from '../bindings'
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
import { activeSession, useAssistantStore } from './assistantStore'
import { SessionsPanel } from './SessionsPanel'
import { useRunningSessions } from './useSessions'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('../editor/CodeEditor', () => import('../test/FakeCodeEditor'))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))

const assistantAsk = vi.mocked(commands.assistantAsk)
const assistantStatus = vi.mocked(commands.assistantStatus)

type AskResult = Awaited<ReturnType<typeof commands.assistantAsk>>

const ANSWER = 'Use this query.\n```sql\nSELECT count(*) FROM item;\n```'

function ok<T>(data: T) {
  return { status: 'ok' as const, data }
}

function done(text: string) {
  return ok({
    status: 'done' as const,
    outcome: {
      stop: 'complete' as const,
      model: 'claude-opus-5-5',
      input_tokens: 1,
      output_tokens: 1,
    },
    text,
  })
}

function answerWith(text: string) {
  assistantAsk.mockImplementation((_request, channel) => {
    channel.onmessage({ type: 'schema', relations: 12, detailed: 12 })
    channel.onmessage({ type: 'text', text })
    return Promise.resolve(done(text))
  })
}

/** Keeps each request in progress. Returns the functions that end them, in sequence. */
function pendingAsks() {
  const finishers: ((result: AskResult) => void)[] = []
  assistantAsk.mockImplementation(
    (_request, channel) =>
      new Promise<AskResult>((resolve) => {
        channel.onmessage({ type: 'text', text: 'Part' } as AssistantEvent)
        finishers.push(resolve)
      }),
  )
  return finishers
}

function setup() {
  useWorkspaceStore.setState({
    workspace: makeWorkspace([
      makeProfile({ id: 'c1', name: 'Local shop', environment: 'development' }),
    ]),
  })
  const tabId = useTabsStore.getState().newTab('select 1')
  useTabsStore.getState().setConnection(tabId, 'c1')
  getQueryStore(tabId).setState({
    session: { id: 7, connectionId: 'c1', version: '17' },
  })
  render(
    <>
      <SessionsPanel />
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
  const panel = screen.getByRole('region', { name: 'Assistant' })
  await user.type(within(panel).getByRole('textbox', { name: 'Request' }), text)
  await user.click(within(panel).getByRole('button', { name: 'Send' }))
}

describe('assistant sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetQueryStores()
    useTabsStore.getState().reset()
    useAssistantStore.getState().reset()
    useAssistantStore.setState({ hasKey: null })
    usePreferencesStore.setState({ preferences: DEFAULT_PREFERENCES })
    assistantStatus.mockResolvedValue(ok({ has_key: true }))
  })

  test('opens the session in its own tab, with its steps, SQL, and context', async () => {
    answerWith(ANSWER)
    const user = setup()
    await sendRequest(user, 'Count the items')
    await screen.findByText('Use this query.')

    await user.click(
      screen.getByRole('button', { name: 'Open the session in a tab' }),
    )

    expect(
      screen.getByRole('tab', { name: 'Assistant: Count the items' }),
    ).toHaveAttribute('aria-selected', 'true')
    const view = screen.getByRole('region', { name: 'Assistant session' })
    expect(
      within(view).getByRole('heading', { name: 'Count the items' }),
    ).toBeInTheDocument()
    expect(within(view).getByText('Done')).toBeInTheDocument()
    const steps = within(view).getByRole('list', {
      name: 'Steps of the last request',
    })
    expect(within(steps).getAllByRole('listitem')).toHaveLength(3)
    const details = within(view).getByRole('complementary', {
      name: 'Session details',
    })
    expect(within(details).getByText('SQL 1')).toBeInTheDocument()
    expect(within(details).getByText('Local shop')).toBeInTheDocument()
    expect(
      within(details).getByText(
        'The request has the structure of 12 tables and views.',
      ),
    ).toBeInTheDocument()
    // The SQL editor stays in the page, hidden, for its undo history.
    expect(screen.queryByRole('textbox', { name: 'SQL' })).toBeNull()
  })

  test('puts the proposed SQL into a new tab or into the last SQL tab', async () => {
    answerWith(ANSWER)
    const user = setup()
    await sendRequest(user, 'Count the items')
    await screen.findByText('Use this query.')
    await user.click(
      screen.getByRole('button', { name: 'Open the session in a tab' }),
    )
    const details = screen.getByRole('complementary', {
      name: 'Session details',
    })

    await user.click(
      within(details).getByRole('button', { name: 'Insert into Query 1' }),
    )
    expect(screen.getByRole('tab', { name: /^Query 1/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(useTabsStore.getState().tabs[0].content).toContain(
      'SELECT count(*) FROM item;',
    )

    await user.click(
      screen.getByRole('tab', { name: 'Assistant: Count the items' }),
    )
    await user.click(
      within(
        screen.getByRole('complementary', { name: 'Session details' }),
      ).getByRole('button', { name: 'Open in a new tab' }),
    )
    const added = useTabsStore.getState().tabs.at(-1)
    expect(added?.title).toBe('Query 2')
    expect(added?.content).toBe('SELECT count(*) FROM item;\n')
  })

  test('two sessions run at the same time', async () => {
    const finishers = pendingAsks()
    const user = setup()
    await sendRequest(user, 'First question')
    const first = activeSession()

    await user.click(screen.getByRole('button', { name: 'New conversation' }))
    await sendRequest(user, 'Second question')
    const second = activeSession()

    expect(second).not.toBe(first)
    expect(first.getState().status).not.toBe('idle')
    expect(second.getState().status).not.toBe('idle')
    const { result } = renderHook(() => useRunningSessions())
    expect(result.current).toBe(2)

    await act(async () => finishers[0](done('First answer')))

    expect(first.getState().messages.at(-1)?.text).toBe('First answer')
    expect(second.getState().status).not.toBe('idle')
    expect(result.current).toBe(1)
  })

  test('the sessions view lists the sessions and opens a session in a tab', async () => {
    answerWith(ANSWER)
    const user = setup()
    await sendRequest(user, 'Count the items')
    await screen.findByText('Use this query.')
    const list = screen.getByRole('region', { name: 'Assistant sessions' })

    const item = within(list).getByRole('button', { name: /Count the items/ })
    expect(item).toHaveTextContent('Done · just now')
    await user.click(item)

    expect(
      screen.getByRole('tab', { name: 'Assistant: Count the items' }),
    ).toHaveAttribute('aria-selected', 'true')

    await user.click(within(list).getByRole('button', { name: 'New session' }))
    expect(
      screen.getByRole('tab', { name: 'Assistant: New conversation' }),
    ).toHaveAttribute('aria-selected', 'true')
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
  })
})

import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { AssistantPanel } from '../assistant/AssistantPanel'
import { useAssistantStore } from '../assistant/assistantStore'
import { resetShellStore } from '../shell/shellStore'
import { useTabsStore } from '../tabs/tabsStore'
import { ActiveDetail } from '../test/ActiveDetail'
import { file, ok, repository } from '../test/gitFixtures'
import { showDiff } from './gitActions'
import { GitPanel } from './GitPanel'
import { useGitStore, type GitOverview } from './gitStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))

const assistantAsk = vi.mocked(commands.assistantAsk)

type AskResult = Awaited<ReturnType<typeof commands.assistantAsk>>

const MESSAGE =
  'Deduct the discount from the revenue\n\nThe revenue is now the total minus the discount.'

function answerWith(text: string) {
  assistantAsk.mockImplementation((_request, channel) => {
    channel.onmessage({
      type: 'sent',
      summary: 'Sent: your request and the staged diff.',
    })
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

async function renderPanel(overview: GitOverview) {
  vi.mocked(commands.gitOverview).mockResolvedValue(ok(overview))
  render(
    <>
      <GitPanel />
      <ActiveDetail />
      <AssistantPanel />
    </>,
  )
  await waitFor(() => expect(useGitStore.getState().overview).not.toBeNull())
  return userEvent.setup()
}

describe('AI actions of Git', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGitStore.getState().reset()
    useTabsStore.getState().reset()
    resetShellStore()
    useAssistantStore.getState().reset()
    useAssistantStore.setState({ hasKey: true })
    vi.mocked(commands.assistantStatus).mockResolvedValue(ok({ has_key: true }))
  })

  test('the AI writes the commit message into the field, not into the panel', async () => {
    const user = await renderPanel(
      repository([file({ path: 'revenue.sql', staged: 'modified' })]),
    )
    answerWith(MESSAGE)

    await user.click(
      screen.getByRole('button', { name: 'Write the message with AI' }),
    )

    expect(assistantAsk).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: null,
        task: 'commit-message',
        messages: [
          {
            role: 'user',
            text: 'Write a commit message for the staged changes.',
            context: { type: 'staged-changes' },
          },
        ],
      }),
      expect.anything(),
    )
    expect(
      await screen.findByRole('textbox', { name: 'Commit message' }),
    ).toHaveValue(MESSAGE)
    expect(screen.getByText(/The AI wrote this message/)).toHaveTextContent(
      'Sent: your request and the staged diff.',
    )
    const again = screen.getByRole('button', { name: 'Write again' })
    expect(again).toBeEnabled()
    // As in the design, the AI button and Commit are in one row.
    expect(again.parentElement).toContainElement(
      screen.getByRole('button', { name: /^Commit/ }),
    )
    expect(
      useAssistantStore.getState().sessions[0].store.getState().messages,
    ).toHaveLength(0)
  })

  test('asks before the AI replaces the message of the user', async () => {
    const user = await renderPanel(
      repository([file({ path: 'revenue.sql', staged: 'modified' })]),
    )
    answerWith(MESSAGE)
    const field = screen.getByRole('textbox', { name: 'Commit message' })
    await user.type(field, 'My message')

    await user.click(
      screen.getByRole('button', { name: 'Write the message with AI' }),
    )
    await user.click(screen.getByRole('button', { name: 'Keep my message' }))

    expect(assistantAsk).not.toHaveBeenCalled()
    expect(field).toHaveValue('My message')

    await user.click(
      screen.getByRole('button', { name: 'Write the message with AI' }),
    )
    await user.click(screen.getByRole('button', { name: 'Replace' }))

    await waitFor(() => expect(field).toHaveValue(MESSAGE))
  })

  test('without staged changes, the AI cannot write a message', async () => {
    await renderPanel(
      repository([file({ path: 'revenue.sql', unstaged: 'modified' })]),
    )

    expect(
      screen.getByRole('button', { name: 'Write the message with AI' }),
    ).toBeDisabled()
  })

  test('Explain the changes sends only the path of the file', async () => {
    const user = await renderPanel(
      repository([file({ path: 'revenue.sql', staged: 'modified' })]),
    )
    vi.mocked(commands.gitDiff).mockResolvedValue(
      ok({ original: 'select 1\n', modified: 'select 2\n' }),
    )
    answerWith('The report reads a different value.')
    act(() => showDiff('revenue.sql', true, false))

    await user.click(
      await screen.findByRole('button', { name: 'Explain the changes' }),
    )

    expect(assistantAsk).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'explain-diff',
        messages: [
          {
            role: 'user',
            text: 'Explain the changes in revenue.sql.',
            context: { type: 'file-diff', path: 'revenue.sql', staged: true },
          },
        ],
      }),
      expect.anything(),
    )
    expect(
      await screen.findByText('The report reads a different value.'),
    ).toBeInTheDocument()
  })

  test('a proposed resolution goes into the result only after Accept', async () => {
    const conflicted = [file({ path: 'a.sql', is_conflicted: true })]
    const user = await renderPanel(repository(conflicted, {}, 'Merge branch'))
    vi.mocked(commands.gitConflict).mockResolvedValue(
      ok({
        base: 'select 1\n',
        ours: 'select mine\n',
        theirs: 'select incoming\n',
        working: '<<<<<<< HEAD\n',
      }),
    )
    answerWith('Both changes.\n\n```sql\nselect mine, incoming\n```')
    await user.click(screen.getByRole('option', { name: 'a.sql, conflict' }))

    await user.click(
      await screen.findByRole('button', { name: 'Propose a resolution' }),
    )

    expect(assistantAsk).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'conflict',
        messages: [
          expect.objectContaining({
            context: { type: 'conflict', path: 'a.sql' },
          }),
        ],
      }),
      expect.anything(),
    )
    const proposal = await screen.findByRole('region', {
      name: 'Proposed resolution',
    })
    expect(proposal).toHaveTextContent('select mine, incoming')
    expect(proposal).toHaveTextContent('Both changes.')
    await user.click(screen.getByRole('button', { name: 'Accept' }))
    await user.click(screen.getByRole('button', { name: 'Mark as resolved' }))

    expect(commands.gitResolveText).toHaveBeenCalledWith(
      'a.sql',
      'select mine, incoming',
    )
  })

  test('a rejected proposal does not change the result', async () => {
    const conflicted = [file({ path: 'a.sql', is_conflicted: true })]
    const user = await renderPanel(repository(conflicted, {}, 'Merge branch'))
    vi.mocked(commands.gitConflict).mockResolvedValue(
      ok({
        base: null,
        ours: 'select mine\n',
        theirs: 'select incoming\n',
        working: '',
      }),
    )
    answerWith('```sql\nselect both\n```')
    await user.click(screen.getByRole('option', { name: 'a.sql, conflict' }))
    await user.click(
      await screen.findByRole('button', { name: 'Propose a resolution' }),
    )

    await user.click(await screen.findByRole('button', { name: 'Reject' }))
    await user.click(screen.getByRole('button', { name: 'Mark as resolved' }))

    expect(commands.gitResolveText).toHaveBeenCalledWith(
      'a.sql',
      'select mine\n',
    )
  })
})

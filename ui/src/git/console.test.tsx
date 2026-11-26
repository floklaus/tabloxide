import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  commands,
  type ConsoleOutput_Serialize,
  type ConsoleResult_Serialize,
} from '../bindings'
import { AssistantPanel } from '../assistant/AssistantPanel'
import { useAssistantStore } from '../assistant/assistantStore'
import { useResultsViewStore } from '../results/resultsViewStore'
import { buildCommands } from '../shell/commands'
import { resetShellStore } from '../shell/shellStore'
import { makeWorkspace } from '../test/fixtures'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { GitConsole } from './GitConsole'
import { useConsoleStore } from './consoleStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))

const run = vi.mocked(commands.gitConsoleRun)

type RunResult = Awaited<ReturnType<typeof commands.gitConsoleRun>>

function output(
  change: Partial<ConsoleOutput_Serialize> = {},
): ConsoleOutput_Serialize {
  return {
    stdout: '',
    stderr: '',
    is_success: true,
    is_cut: false,
    is_cancelled: false,
    note: null,
    ...change,
  }
}

function answer(data: ConsoleResult_Serialize): RunResult {
  return { status: 'ok', data }
}

function setup() {
  useWorkspaceStore.setState({
    workspace: { ...makeWorkspace([]), name: 'sql-project' },
  })
  render(
    <>
      <GitConsole />
      <AssistantPanel />
    </>,
  )
  return userEvent.setup()
}

const input = () => screen.getByRole('textbox', { name: 'Git command' })

describe('Git console', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetShellStore()
    useConsoleStore.getState().reset()
    useAssistantStore.getState().reset()
    useAssistantStore.setState({ hasKey: true })
    vi.mocked(commands.assistantStatus).mockResolvedValue({
      status: 'ok',
      data: { has_key: true },
    })
    vi.mocked(commands.gitConsoleHistory).mockResolvedValue({
      status: 'ok',
      data: ['log --oneline', 'status'],
    })
    vi.mocked(commands.gitConsoleNames).mockResolvedValue({
      status: 'ok',
      data: {
        branches: ['main', 'feature'],
        remotes: ['origin'],
        tags: [],
        files: ['reports/revenue.sql'],
      },
    })
  })

  test('runs a command and shows its output, then reads the Git state again', async () => {
    const user = setup()
    run.mockResolvedValue(
      answer({ status: 'done', output: output({ stdout: '## main\n' }) }),
    )

    await user.type(input(), 'status -sb{Enter}')

    expect(run).toHaveBeenCalledWith(
      expect.any(Number),
      'status -sb',
      false,
      expect.anything(),
    )
    const log = screen.getByRole('log', { name: 'Git console output' })
    await waitFor(() => expect(log).toHaveTextContent('git status -sb'))
    expect(log).toHaveTextContent('## main')
    expect(commands.gitOverview).toHaveBeenCalled()
    expect(input()).toHaveValue('')
    expect(
      screen.getByText(/Runs in the workspace folder sql-project/),
    ).toBeVisible()
  })

  test('shows the reason of a refused command', async () => {
    const user = setup()
    run.mockResolvedValue(
      answer({ status: 'refused', reason: 'This command opens an editor.' }),
    )

    await user.type(input(), 'rebase -i HEAD~3{Enter}')

    expect(
      await screen.findByText('Not run. This command opens an editor.'),
    ).toBeInTheDocument()
  })

  test('a command that removes work runs only after Run', async () => {
    const user = setup()
    run
      .mockResolvedValueOnce(
        answer({ status: 'confirm', effect: 'This command removes 2 files.' }),
      )
      .mockResolvedValueOnce(
        answer({
          status: 'done',
          output: output({ stdout: 'HEAD is now at 4c1a9e2\n' }),
        }),
      )

    await user.type(input(), 'reset --hard origin/main{Enter}')
    const confirm = await screen.findByRole('alertdialog', {
      name: 'Run a command that removes work?',
    })
    expect(confirm).toHaveTextContent('This command removes 2 files.')
    await user.click(screen.getByRole('button', { name: 'Run' }))

    // The second run has the same identifier as the first, and the confirmation.
    const [[firstId], [secondId, line, confirmed]] = run.mock.calls
    expect([secondId, line, confirmed]).toEqual([
      firstId,
      'reset --hard origin/main',
      true,
    ])
    expect(await screen.findByText(/HEAD is now at/)).toBeInTheDocument()
  })

  test('Cancel of a confirmation does not run the command', async () => {
    const user = setup()
    run.mockResolvedValue(
      answer({ status: 'confirm', effect: 'This command deletes a branch.' }),
    )

    await user.type(input(), 'branch -D old{Enter}')
    await screen.findByRole('alertdialog')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(run).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Not run.')).toBeInTheDocument()
  })

  test('Up and Down select the earlier commands', async () => {
    const user = setup()
    await waitFor(() =>
      expect(useConsoleStore.getState().history).toHaveLength(2),
    )

    await user.click(input())
    await user.keyboard('{ArrowUp}')
    expect(input()).toHaveValue('status')
    await user.keyboard('{ArrowUp}')
    expect(input()).toHaveValue('log --oneline')
    await user.keyboard('{ArrowDown}')
    expect(input()).toHaveValue('status')
    await user.keyboard('{ArrowDown}')
    expect(input()).toHaveValue('')
  })

  test('Tab completes the command, the branch, and the file names', async () => {
    const user = setup()
    await waitFor(() => expect(useConsoleStore.getState().names).not.toBeNull())

    await user.type(input(), 'chec{Tab}')
    expect(input()).toHaveValue('checkout ')
    await user.type(input(), 'fea{Tab}')
    expect(input()).toHaveValue('checkout feature ')
    await user.clear(input())
    await user.type(input(), 'st{Tab}')

    expect(input()).toHaveValue('sta')
    expect(screen.getByText(/^stash\s+status$/)).toBeInTheDocument()
  })

  test('Explain the last output sends the command and its output to the panel', async () => {
    const user = setup()
    run.mockResolvedValue(
      answer({
        status: 'done',
        output: output({ stdout: '4c1a9e2 Fix the report\n' }),
      }),
    )
    vi.mocked(commands.assistantAsk).mockResolvedValue({
      status: 'ok',
      data: {
        status: 'done',
        outcome: {
          stop: 'complete',
          model: 'claude-opus-5-5',
          input_tokens: 1,
          output_tokens: 1,
        },
        text: 'One commit.',
      },
    })
    expect(
      screen.getByRole('button', { name: 'Explain the last output' }),
    ).toBeDisabled()

    await user.type(input(), 'log --oneline -1{Enter}')
    await screen.findByText(/Fix the report/)
    await user.click(
      screen.getByRole('button', { name: 'Explain the last output' }),
    )

    expect(commands.assistantAsk).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: null,
        task: 'git-output',
        messages: [
          {
            role: 'user',
            text: 'Explain the output of this Git command.',
            context: {
              type: 'git-output',
              command: 'log --oneline -1',
              output: '4c1a9e2 Fix the report\n',
            },
          },
        ],
      }),
      expect.anything(),
    )
  })

  test('the View command opens the console with Ctrl+`', () => {
    useWorkspaceStore.setState({ workspace: makeWorkspace([]) })
    const command = buildCommands().find(
      (item) => item.id === 'view.git-console',
    )

    command?.run()

    expect(command?.shortcut).toBe('Ctrl+`')
    expect(useResultsViewStore.getState().view).toBe('console')
  })
})

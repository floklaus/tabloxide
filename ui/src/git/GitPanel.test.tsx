import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands, type FileStatus_Serialize as FileStatus } from '../bindings'
import { useResultsViewStore } from '../results/resultsViewStore'
import { useTabsStore } from '../tabs/tabsStore'
import { DiffView } from './DiffView'
import { GitPanel } from './GitPanel'
import { useGitStore, type GitOverview } from './gitStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))

const gitOverview = vi.mocked(commands.gitOverview)
const gitCommit = vi.mocked(commands.gitCommit)
const gitPull = vi.mocked(commands.gitPull)
const gitDiff = vi.mocked(commands.gitDiff)
const fileRead = vi.mocked(commands.fileRead)

function ok<T>(data: T) {
  return { status: 'ok' as const, data }
}

function failed(message: string) {
  return {
    status: 'error' as const,
    error: { kind: 'git' as const, message, issues: [] },
  }
}

function file(overrides: Partial<FileStatus>): FileStatus {
  return {
    path: 'a.sql',
    original_path: null,
    staged: null,
    unstaged: null,
    is_untracked: false,
    is_conflicted: false,
    ...overrides,
  }
}

function repository(
  files: FileStatus[] = [],
  overrides: object = {},
): GitOverview {
  return {
    state: 'repository',
    version: '2.43.0',
    root: '/work/sql-project',
    branches: [
      { name: 'feature', is_current: false },
      { name: 'main', is_current: true },
    ],
    status: {
      branch: 'main',
      has_commits: true,
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
      files,
      ...overrides,
    },
  }
}

const changes = [
  file({ path: 'staged.sql', staged: 'modified' }),
  file({ path: 'changed.sql', unstaged: 'modified' }),
  file({ path: 'new.sql', is_untracked: true }),
]

async function renderPanel(overview: GitOverview) {
  gitOverview.mockResolvedValue(ok(overview))
  render(
    <>
      <GitPanel />
      <DiffView />
    </>,
  )
  await waitFor(() => expect(useGitStore.getState().overview).not.toBeNull())
  return userEvent.setup()
}

describe('GitPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGitStore.getState().reset()
    useTabsStore.getState().reset()
    useResultsViewStore.getState().setView('results')
  })

  test('gives the install instructions when Git is not available', async () => {
    await renderPanel({
      state: 'not-installed',
      message: 'Git is not installed.',
    })

    expect(screen.getByRole('alert')).toHaveTextContent('Git is not installed.')
  })

  test('initialises a repository when the folder has none', async () => {
    const user = await renderPanel({
      state: 'no-repository',
      version: '2.43.0',
    })
    gitOverview.mockResolvedValue(ok(repository()))

    await user.click(
      screen.getByRole('button', { name: 'Initialise a repository' }),
    )

    expect(commands.gitInit).toHaveBeenCalled()
    expect(
      await screen.findByText('No changes in the working tree.'),
    ).toBeInTheDocument()
  })

  test('disables and enables Git for the workspace', async () => {
    const user = await renderPanel(repository())
    gitOverview.mockResolvedValue(ok({ state: 'disabled' }))

    await user.click(
      screen.getByRole('button', { name: 'Disable Git for this workspace' }),
    )
    expect(commands.gitSetEnabled).toHaveBeenCalledWith(false)
    expect(
      await screen.findByText('Git is disabled for this workspace.'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Enable Git' }))
    expect(commands.gitSetEnabled).toHaveBeenLastCalledWith(true)
  })

  test('shows the branch, the upstream counts, and the changed files', async () => {
    await renderPanel(repository(changes))

    expect(screen.getByRole('combobox')).toHaveValue('main')
    expect(
      screen.getByText('origin/main: 2 to push, 1 to pull'),
    ).toBeInTheDocument()
    const staged = screen.getByRole('region', { name: 'Staged' })
    expect(within(staged).getByText('staged.sql')).toBeInTheDocument()
    const changed = screen.getByRole('region', { name: 'Changes' })
    expect(
      within(changed).getByRole('button', { name: /^changed.sql/ }),
    ).toHaveTextContent('modified')
    expect(
      within(changed).getByRole('button', { name: /^new.sql/ }),
    ).toHaveTextContent('new')
  })

  test('stages and unstages a file', async () => {
    const user = await renderPanel(repository(changes))

    await user.click(screen.getByRole('button', { name: 'Stage changed.sql' }))
    expect(commands.gitStage).toHaveBeenCalledWith(['changed.sql'])

    await user.click(screen.getByRole('button', { name: 'Unstage staged.sql' }))
    expect(commands.gitUnstage).toHaveBeenCalledWith(['staged.sql'])

    await user.click(screen.getByRole('button', { name: 'Stage all' }))
    expect(commands.gitStage).toHaveBeenLastCalledWith([
      'changed.sql',
      'new.sql',
    ])
  })

  test('asks before it discards the changes of a file', async () => {
    const user = await renderPanel(repository(changes))

    await user.click(screen.getByRole('button', { name: 'Discard new.sql' }))
    const dialog = screen.getByRole('dialog', { name: 'Discard the changes?' })
    expect(dialog).toHaveTextContent('This deletes the file "new.sql"')
    expect(commands.gitDiscard).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Discard' }))
    expect(commands.gitDiscard).toHaveBeenCalledWith('new.sql', true)
  })

  test('commits the staged files and clears the message', async () => {
    const user = await renderPanel(repository(changes))
    const message = screen.getByRole('textbox', { name: 'Commit message' })
    const commit = screen.getByRole('button', { name: /^Commit/ })
    expect(commit).toBeDisabled()

    await user.type(message, 'Add the report query')
    await user.click(commit)

    expect(gitCommit).toHaveBeenCalledWith('Add the report query')
    await waitFor(() => expect(message).toHaveValue(''))
  })

  test('keeps the message and explains a missing identity', async () => {
    const user = await renderPanel(repository(changes))
    gitCommit.mockResolvedValue(
      failed('Git does not know your name and e-mail address.'),
    )

    await user.type(
      screen.getByRole('textbox', { name: 'Commit message' }),
      'x',
    )
    await user.click(screen.getByRole('button', { name: /^Commit/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Git does not know your name',
    )
    expect(screen.getByRole('textbox', { name: 'Commit message' })).toHaveValue(
      'x',
    )
  })

  test('does not permit a commit without staged files', async () => {
    const user = await renderPanel(repository([changes[1]]))

    await user.type(
      screen.getByRole('textbox', { name: 'Commit message' }),
      'x',
    )

    expect(screen.getByRole('button', { name: /^Commit/ })).toBeDisabled()
  })

  test('switches the branch and reloads the open files', async () => {
    useTabsStore.setState({
      tabs: [
        {
          id: 't1',
          title: 'a.sql',
          path: 'a.sql',
          content: 'old',
          savedContent: 'old',
          connectionId: null,
        },
        {
          id: 't2',
          title: 'b.sql',
          path: 'b.sql',
          content: 'my edit',
          savedContent: 'old',
          connectionId: null,
        },
      ],
      activeId: 't1',
    })
    fileRead.mockResolvedValue(ok('from the other branch'))
    const user = await renderPanel(repository())

    await user.selectOptions(screen.getByRole('combobox'), 'feature')

    expect(commands.gitBranchSwitch).toHaveBeenCalledWith('feature')
    await waitFor(() =>
      expect(useTabsStore.getState().tabs[0].content).toBe(
        'from the other branch',
      ),
    )
    // A tab with unsaved changes keeps its text.
    expect(useTabsStore.getState().tabs[1].content).toBe('my edit')
  })

  test('creates a branch', async () => {
    const user = await renderPanel(repository())

    await user.click(screen.getByRole('button', { name: 'New branch' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Name of the new branch' }),
      'feature/report',
    )
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(commands.gitBranchCreate).toHaveBeenCalledWith('feature/report')
    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: 'Name of the new branch' }),
      ).not.toBeInTheDocument(),
    )
  })

  test('shows the text of Git after a push', async () => {
    const user = await renderPanel(repository())
    vi.mocked(commands.gitPush).mockResolvedValue(
      ok('To origin\n   1a2b..3c4d  main -> main'),
    )

    await user.click(screen.getByRole('button', { name: 'Push' }))

    expect(await screen.findByText(/main -> main/)).toBeInTheDocument()
  })

  test('reports a merge conflict after a pull', async () => {
    const user = await renderPanel(repository())
    gitPull.mockResolvedValue(
      failed('CONFLICT (content): Merge conflict in a.sql'),
    )
    gitOverview.mockResolvedValue(
      ok(repository([file({ path: 'a.sql', is_conflicted: true })])),
    )

    await user.click(screen.getByRole('button', { name: 'Pull' }))

    expect(await screen.findByText('Merge conflict')).toBeInTheDocument()
    expect(
      screen.getByText(/Resolve the conflict in these files/),
    ).toHaveTextContent('a.sql')
    expect(
      screen.queryByRole('button', { name: 'Discard a.sql' }),
    ).not.toBeInTheDocument()
  })

  test('explains a branch without an upstream', async () => {
    await renderPanel(repository([], { upstream: null, ahead: 0, behind: 0 }))

    expect(screen.getByText(/The branch has no upstream/)).toBeInTheDocument()
  })

  test('shows the diff of a file in the results pane', async () => {
    const user = await renderPanel(repository(changes))
    gitDiff.mockResolvedValue(
      ok({ original: 'select 1\n', modified: 'select 2\n' }),
    )

    await user.click(screen.getByRole('button', { name: /^changed.sql/ }))

    expect(gitDiff).toHaveBeenCalledWith('changed.sql', false)
    expect(
      await screen.findByRole('heading', { name: 'changed.sql' }),
    ).toBeInTheDocument()
    expect(useResultsViewStore.getState().view).toBe('diff')
    await waitFor(() => {
      const text = document.querySelector('.cm-mergeView')?.textContent ?? ''
      expect(text).toContain('select 1')
      expect(text).toContain('select 2')
    })
  })

  test('shows the error when a diff is not available', async () => {
    const user = await renderPanel(repository(changes))
    gitDiff.mockResolvedValue(
      failed('The file is binary or too large to show: new.sql'),
    )

    await user.click(screen.getByRole('button', { name: /^new.sql/ }))

    expect(await screen.findByText(/binary or too large/)).toBeInTheDocument()
  })
})

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { useTabsStore } from '../tabs/tabsStore'
import { ActiveDetail } from '../test/ActiveDetail'
import { failed, file, ok, repository } from '../test/gitFixtures'
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

const changes = [
  file({ path: 'queries/staged.sql', staged: 'modified' }),
  file({ path: 'changed.sql', unstaged: 'modified' }),
  file({ path: 'new.sql', is_untracked: true }),
]

async function renderPanel(overview: GitOverview) {
  gitOverview.mockResolvedValue(ok(overview))
  render(
    <>
      <GitPanel />
      <ActiveDetail />
    </>,
  )
  await waitFor(() => expect(useGitStore.getState().overview).not.toBeNull())
  return userEvent.setup()
}

const detailTabs = () =>
  useTabsStore
    .getState()
    .tabs.flatMap((tab) => (tab.detail ? [tab.detail] : []))

const option = (name: RegExp) => screen.getByRole('option', { name })

async function overflow(
  user: ReturnType<typeof userEvent.setup>,
  item: RegExp,
) {
  await user.click(screen.getByRole('button', { name: 'More git actions' }))
  await user.click(screen.getByRole('menuitem', { name: item }))
}

beforeEach(() => {
  vi.clearAllMocks()
  useGitStore.getState().reset()
  useTabsStore.getState().reset()
})

describe('the states of the Git view', () => {
  test('gives the install instructions when Git is not available', async () => {
    await renderPanel({
      state: 'not-installed',
      message: 'Git is not installed.',
    })

    expect(screen.getByRole('alert')).toHaveTextContent('Git is not installed.')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
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

    await overflow(user, /^Disable Git for this workspace/)
    expect(commands.gitSetEnabled).toHaveBeenCalledWith(false)
    expect(
      await screen.findByText('Git is disabled for this workspace.'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Enable Git' }))
    expect(commands.gitSetEnabled).toHaveBeenLastCalledWith(true)
  })
})

describe('the header of the Git view', () => {
  test('shows the branch, the primary action, and the modes', async () => {
    await renderPanel(repository(changes))

    expect(
      screen.getByRole('button', { name: /^Branch: main ↑2 ↓1/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Push 2 commits' }),
    ).toBeInTheDocument()
    const tabs = within(screen.getByRole('tablist', { name: 'Git modes' }))
    expect(tabs.getByRole('tab', { name: 'Changes 3' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(tabs.getByRole('tab', { name: 'History' })).toBeInTheDocument()
    expect(tabs.getByRole('tab', { name: 'Branches' })).toBeInTheDocument()
  })

  test('the primary action is Pull when the branch is only behind', async () => {
    await renderPanel(repository([], { ahead: 0, behind: 1 }))

    expect(
      screen.getByRole('button', { name: 'Pull 1 commit' }),
    ).toBeInTheDocument()
  })

  test('explains a branch without an upstream', async () => {
    await renderPanel(repository([], { upstream: null, ahead: 0, behind: 0 }))

    expect(
      screen.getByRole('button', { name: 'Push and set the upstream' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/no upstream/)).toBeInTheDocument()
  })

  test('switches the branch from the scope menu and reloads the open files', async () => {
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

    await user.click(screen.getByRole('button', { name: /^Branch: main/ }))
    await user.click(screen.getByRole('menuitemradio', { name: /^feature/ }))

    expect(commands.gitBranchSwitch).toHaveBeenCalledWith('feature')
    await waitFor(() =>
      expect(useTabsStore.getState().tabs[0].content).toBe(
        'from the other branch',
      ),
    )
    // A tab with unsaved changes keeps its text.
    expect(useTabsStore.getState().tabs[1].content).toBe('my edit')
  })

  test('shows the text of Git after a push', async () => {
    const user = await renderPanel(repository())
    vi.mocked(commands.gitPush).mockResolvedValue(
      ok('To origin\n   1a2b..3c4d  main -> main'),
    )

    await user.click(screen.getByRole('button', { name: 'Push 2 commits' }))

    expect(await screen.findByText(/main -> main/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(/main -> main/)).not.toBeInTheDocument()
  })
})

describe('the Changes mode', () => {
  test('shows the changed files in the groups Staged and Changes', async () => {
    await renderPanel(repository(changes))

    const staged = screen.getByRole('group', { name: 'Staged' })
    expect(
      within(staged).getByRole('option', {
        name: 'queries/staged.sql, modified, staged',
      }),
    ).toHaveTextContent('staged.sqlqueries')
    const changed = screen.getByRole('group', { name: 'Changes' })
    expect(
      within(changed).getByRole('option', {
        name: 'changed.sql, modified, not staged',
      }),
    ).toBeInTheDocument()
    expect(
      within(changed).getByRole('option', { name: 'new.sql, new, not staged' }),
    ).toBeInTheDocument()
    expect(screen.getByText('3 files changed')).toBeInTheDocument()
  })

  test('Space stages a file and unstages a staged file', async () => {
    const user = await renderPanel(repository(changes))

    option(/^changed.sql/).focus()
    await user.keyboard(' ')
    expect(commands.gitStage).toHaveBeenCalledWith(['changed.sql'])

    option(/^queries\/staged.sql/).focus()
    await user.keyboard(' ')
    expect(commands.gitUnstage).toHaveBeenCalledWith(['queries/staged.sql'])
    // Space does not open a tab in this view.
    expect(useTabsStore.getState().tabs).toHaveLength(0)
  })

  test('a click on the check box stages the file', async () => {
    const user = await renderPanel(repository(changes))
    const box = option(/^new.sql/).querySelector('.git-check')

    await user.click(box as Element)

    expect(commands.gitStage).toHaveBeenCalledWith(['new.sql'])
    expect(useTabsStore.getState().tabs).toHaveLength(0)
  })

  test('stages all and unstages all from the overflow menu', async () => {
    const user = await renderPanel(repository(changes))

    await overflow(user, /^Stage all/)
    expect(commands.gitStage).toHaveBeenCalledWith(['changed.sql', 'new.sql'])

    await overflow(user, /^Unstage all/)
    expect(commands.gitUnstage).toHaveBeenCalledWith(['queries/staged.sql'])
  })

  test('a click shows the diff in a preview tab and keeps the focus', async () => {
    const user = await renderPanel(repository(changes))
    gitDiff.mockResolvedValue(
      ok({ original: 'select 1\n', modified: 'select 2\n' }),
    )

    await user.click(option(/^changed.sql/))

    expect(gitDiff).toHaveBeenCalledWith('changed.sql', false)
    expect(
      await screen.findByRole('heading', { name: 'changed.sql' }),
    ).toBeInTheDocument()
    expect(useTabsStore.getState().tabs[0]).toMatchObject({
      title: 'changed.sql',
      isPreview: true,
    })
    expect(option(/^changed.sql/)).toHaveFocus()
    expect(option(/^changed.sql/)).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => {
      const text = document.querySelector('.cm-mergeView')?.textContent ?? ''
      expect(text).toContain('select 1')
      expect(text).toContain('select 2')
    })
  })

  test('Enter opens the diff and keeps the tab, and Esc closes a preview', async () => {
    const user = await renderPanel(repository(changes))
    gitDiff.mockResolvedValue(ok({ original: 'a\n', modified: 'b\n' }))

    option(/^queries\/staged.sql/).focus()
    await user.keyboard('{Enter}')

    expect(gitDiff).toHaveBeenCalledWith('queries/staged.sql', true)
    expect(useTabsStore.getState().tabs[0]).toMatchObject({
      title: 'staged.sql (staged)',
      isPreview: false,
    })

    await user.click(option(/^new.sql/))
    expect(detailTabs()).toHaveLength(2)
    await user.keyboard('{Escape}')
    expect(detailTabs()).toEqual([
      { kind: 'diff', path: 'queries/staged.sql', staged: true },
    ])
  })

  test('shows the error when a diff is not available', async () => {
    const user = await renderPanel(repository(changes))
    gitDiff.mockResolvedValue(
      failed('The file is binary or too large to show: new.sql'),
    )

    await user.click(option(/^new.sql/))

    expect(await screen.findByText(/binary or too large/)).toBeInTheDocument()
  })

  test('Delete asks before it discards the changes of a file', async () => {
    const user = await renderPanel(repository(changes))

    option(/^new.sql/).focus()
    await user.keyboard('{Delete}')
    const dialog = screen.getByRole('dialog', { name: 'Discard the changes?' })
    expect(dialog).toHaveTextContent('This deletes the file "new.sql"')
    expect(commands.gitDiscard).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Discard' }))
    expect(commands.gitDiscard).toHaveBeenCalledWith('new.sql', true)
  })

  test('the filter shows only the matching files and can clear', async () => {
    const user = await renderPanel(repository(changes))

    await user.type(
      screen.getByRole('searchbox', { name: 'Filter the changed files' }),
      'new',
    )
    expect(screen.getAllByRole('option')).toHaveLength(1)

    await user.type(screen.getByRole('searchbox'), 'xyz')
    expect(
      screen.getByText('No changed files contain “newxyz”.'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear the filter' }))
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  test('reports a merge conflict after a pull', async () => {
    const user = await renderPanel(repository())
    gitPull.mockResolvedValue(
      failed('CONFLICT (content): Merge conflict in a.sql'),
    )
    gitOverview.mockResolvedValue(
      ok(
        repository([file({ path: 'a.sql', is_conflicted: true })], {}, 'Merge'),
      ),
    )

    await overflow(user, /^Pull/)

    expect(await screen.findByText('Merge conflict')).toBeInTheDocument()
    const row = within(screen.getByRole('group', { name: 'Conflicts' }))
    expect(row.getByRole('option', { name: 'a.sql, conflict' })).toBeVisible()
    // Space and Delete do nothing to a file with a conflict.
    option(/^a.sql/).focus()
    await user.keyboard(' {Delete}')
    expect(commands.gitStage).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('the commit box', () => {
  test('commits the staged files and clears the message', async () => {
    const user = await renderPanel(repository(changes))
    const message = screen.getByRole('textbox', { name: 'Commit message' })
    const commit = screen.getByRole('button', { name: 'Commit 1 file' })
    expect(commit).toBeDisabled()

    await user.type(message, 'Add the report query')
    await user.click(commit)

    expect(gitCommit).toHaveBeenCalledWith('Add the report query')
    await waitFor(() => expect(message).toHaveValue(''))
  })

  test('Ctrl+Enter in the message field commits', async () => {
    const user = await renderPanel(repository(changes))

    await user.type(
      screen.getByRole('textbox', { name: 'Commit message' }),
      'Fix the join{Control>}{Enter}{/Control}',
    )

    expect(gitCommit).toHaveBeenCalledWith('Fix the join')
  })

  test('Ctrl+Enter in the list commits', async () => {
    const user = await renderPanel(repository(changes))
    await user.type(
      screen.getByRole('textbox', { name: 'Commit message' }),
      'From the list',
    )

    option(/^changed.sql/).focus()
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(gitCommit).toHaveBeenCalledWith('From the list')
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

  test('the commit box shows only in the Changes mode', async () => {
    const user = await renderPanel(repository(changes))
    vi.mocked(commands.gitLog).mockResolvedValue(ok([]))
    await user.type(
      screen.getByRole('textbox', { name: 'Commit message' }),
      'kept',
    )

    await user.click(screen.getByRole('tab', { name: 'Branches' }))
    expect(
      screen.queryByRole('textbox', { name: 'Commit message' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /^Changes/ }))
    expect(screen.getByRole('textbox', { name: 'Commit message' })).toHaveValue(
      'kept',
    )
  })
})

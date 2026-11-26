import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { useTabsStore } from '../tabs/tabsStore'
import { ActiveDetail } from '../test/ActiveDetail'
import {
  commit,
  commitAt,
  failed,
  file,
  ok,
  repository,
} from '../test/gitFixtures'
import { GitPanel } from './GitPanel'
import { groupCommits } from './gitModel'
import { HISTORY_PAGE, useGitStore, type GitOverview } from './gitStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))

const gitOverview = vi.mocked(commands.gitOverview)
const gitLog = vi.mocked(commands.gitLog)
const gitCommitFiles = vi.mocked(commands.gitCommitFiles)
const gitCommitDiff = vi.mocked(commands.gitCommitDiff)
const gitBranchDelete = vi.mocked(commands.gitBranchDelete)
const gitBranchRename = vi.mocked(commands.gitBranchRename)
const gitConflict = vi.mocked(commands.gitConflict)
const gitResolveText = vi.mocked(commands.gitResolveText)

const conflicted = [file({ path: 'a.sql', is_conflicted: true })]
const SIDES = {
  base: 'select 1\n',
  ours: 'select mine\n',
  theirs: 'select incoming\n',
  working: '<<<<<<< HEAD\n',
}

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

async function openMode(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  await user.click(screen.getByRole('tab', { name }))
}

beforeEach(() => {
  vi.clearAllMocks()
  useGitStore.getState().reset()
  useTabsStore.getState().reset()
})

describe('the History mode', () => {
  test('does not read the history until the user opens the mode', async () => {
    const user = await renderPanel(repository())
    expect(gitLog).not.toHaveBeenCalled()
    const today = new Date()
    const yesterday = new Date(today.getTime() - 86_400_000)
    gitLog.mockResolvedValue(
      ok([commitAt(3, today), commitAt(2, today), commitAt(1, yesterday)]),
    )

    await openMode(user, 'History')

    expect(gitLog).toHaveBeenCalledWith(HISTORY_PAGE, 0)
    const todayGroup = await screen.findByRole('group', { name: 'Today' })
    expect(within(todayGroup).getAllByRole('option')).toHaveLength(2)
    expect(screen.getByRole('group', { name: 'Yesterday' })).toBeInTheDocument()
    // The branch is 2 commits ahead, thus the first 2 commits are not pushed.
    expect(
      screen.getByRole('option', { name: 'commit 3, aaaaaa3, not pushed' }),
    ).toHaveTextContent('Ada')
    expect(
      screen.getByRole('option', { name: 'commit 1, aaaaaa1' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('3 commits · 2 commits not pushed to origin/main'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Load more commits' }),
    ).not.toBeInTheDocument()
  })

  test('says when the branch has no commits', async () => {
    const user = await renderPanel(repository())
    gitLog.mockResolvedValue(ok([]))

    await openMode(user, 'History')

    expect(
      await screen.findByText('The branch has no commits.'),
    ).toBeInTheDocument()
  })

  test('gets the next page of commits', async () => {
    const user = await renderPanel(repository())
    const page = Array.from({ length: HISTORY_PAGE }, (_, i) => commit(i))
    gitLog.mockResolvedValueOnce(ok(page))
    gitLog.mockResolvedValueOnce(ok([commit(900)]))

    await openMode(user, 'History')
    await user.click(
      await screen.findByRole('button', { name: 'Load more commits' }),
    )

    expect(gitLog).toHaveBeenLastCalledWith(HISTORY_PAGE, HISTORY_PAGE)
    expect(
      await screen.findByRole('option', { name: /^commit 900/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Load more commits' }),
    ).not.toBeInTheDocument()
  })

  test('the filter applies to the commits', async () => {
    const user = await renderPanel(repository())
    gitLog.mockResolvedValue(ok([commit(1), commit(2)]))
    await openMode(user, 'History')
    await screen.findByRole('option', { name: /^commit 2/ })

    await user.type(
      screen.getByRole('searchbox', { name: 'Filter the commits' }),
      'commit 2',
    )

    expect(screen.getAllByRole('option')).toHaveLength(1)
  })

  test('Space shows a commit in a preview tab with its files and diffs', async () => {
    // The branch has 1 commit to push. The second commit is on the remote.
    const user = await renderPanel(repository([], { ahead: 1 }))
    gitLog.mockResolvedValue(ok([commit(2), commit(1)]))
    gitCommitFiles.mockResolvedValue(
      ok([
        { path: 'reports/new.sql', original_path: 'old.sql', kind: 'renamed' },
        { path: 'README.md', original_path: null, kind: 'modified' },
      ]),
    )
    gitCommitDiff.mockResolvedValue(
      ok({ original: 'select 1\n', modified: 'select 2\n' }),
    )
    await openMode(user, 'History')

    ;(await screen.findByRole('option', { name: /^commit 1/ })).focus()
    await user.keyboard(' ')

    expect(useTabsStore.getState().tabs[0]).toMatchObject({
      title: 'Commit aaaaaa1',
      isPreview: true,
    })
    expect(
      screen.getByRole('heading', { name: 'commit 1' }),
    ).toBeInTheDocument()
    expect(screen.getByText('aaaaaa1', { selector: 'code' })).toBeVisible()
    expect(screen.getByRole('img', { name: 'Pushed' })).toBeInTheDocument()
    const files = await screen.findByRole('list', { name: 'Files of aaaaaa1' })
    expect(within(files).getAllByRole('button')).toHaveLength(2)
    expect(screen.getByText('2 files')).toBeInTheDocument()
    expect(gitCommitFiles).toHaveBeenCalledWith(commit(1).id)
    // The first file shows first.
    await waitFor(() =>
      expect(gitCommitDiff).toHaveBeenCalledWith(
        commit(1).id,
        'reports/new.sql',
        'old.sql',
      ),
    )

    await user.click(within(files).getByRole('button', { name: /README.md/ }))
    await waitFor(() =>
      expect(gitCommitDiff).toHaveBeenLastCalledWith(
        commit(1).id,
        'README.md',
        null,
      ),
    )
    expect(
      screen.getByRole('region', { name: 'Diff of README.md' }),
    ).toHaveTextContent('Left: before the commit')
  })

  test('Enter keeps the commit tab, and a commit that is not pushed says so', async () => {
    const user = await renderPanel(repository())
    gitLog.mockResolvedValue(ok([commit(2)]))
    gitCommitFiles.mockResolvedValue(ok([]))
    await openMode(user, 'History')

    ;(await screen.findByRole('option', { name: /^commit 2/ })).focus()
    await user.keyboard('{Enter}')

    expect(useTabsStore.getState().tabs[0].isPreview).toBe(false)
    expect(screen.getByRole('img', { name: 'Not pushed' })).toBeInTheDocument()
    expect(
      await screen.findByText('The commit changed no file.'),
    ).toBeInTheDocument()
  })

  test('reads the history again after a commit', async () => {
    const user = await renderPanel(
      repository([file({ path: 'a.sql', staged: 'modified' })]),
    )
    gitLog.mockResolvedValue(ok([commit(1)]))
    await openMode(user, 'History')
    await screen.findByRole('option', { name: /^commit 1/ })
    gitLog.mockResolvedValue(ok([commit(2), commit(1)]))

    await openMode(user, 'Changes 1')
    await user.type(screen.getByLabelText('Commit message'), 'next')
    await user.click(screen.getByRole('button', { name: /^Commit/ }))
    await waitFor(() => expect(gitLog).toHaveBeenCalledTimes(2))
    await openMode(user, 'History')

    expect(
      await screen.findByRole('option', { name: /^commit 2/ }),
    ).toBeInTheDocument()
  })

  test('groups the commits by day', () => {
    const now = new Date(2026, 10, 26, 12)
    const groups = groupCommits(
      [
        commitAt(3, new Date(2026, 10, 26, 9)),
        commitAt(2, new Date(2026, 10, 25, 9)),
        commitAt(1, new Date(2026, 10, 20, 9)),
      ],
      now,
    )

    expect(groups.map((group) => group.day).slice(0, 2)).toEqual([
      'Today',
      'Yesterday',
    ])
    expect(groups).toHaveLength(3)
  })
})

describe('the Branches mode', () => {
  test('lists the local and the remote branches', async () => {
    const overview = repository()
    if (overview.state !== 'repository') throw new Error('fixture')
    const user = await renderPanel({
      ...overview,
      remote_branches: [
        { name: 'origin/release', local_name: 'release', last_commit: null },
      ],
    })

    await openMode(user, 'Branches')

    const local = within(screen.getByRole('group', { name: 'Local' }))
    expect(
      local.getByRole('option', { name: 'main, current branch' }),
    ).toHaveTextContent('↑2 ↓1')
    expect(local.getByRole('option', { name: 'feature' })).toBeInTheDocument()
    const remote = within(screen.getByRole('group', { name: 'Remote' }))
    remote.getByRole('option', { name: 'origin/release' }).focus()
    await user.keyboard('{Enter}')

    expect(commands.gitBranchSwitch).toHaveBeenCalledWith('release')
  })

  test('Enter switches to a branch', async () => {
    const user = await renderPanel(repository())
    await openMode(user, 'Branches')

    screen.getByRole('option', { name: 'feature' }).focus()
    await user.keyboard('{Enter}')

    expect(commands.gitBranchSwitch).toHaveBeenCalledWith('feature')
  })

  test('F2 renames a branch', async () => {
    const user = await renderPanel(repository())
    await openMode(user, 'Branches')

    screen.getByRole('option', { name: /^main/ }).focus()
    await user.keyboard('{F2}')
    const field = screen.getByLabelText('New name of the branch')
    expect(field).toHaveValue('main')
    await user.clear(field)
    await user.type(field, 'trunk{Enter}')

    expect(gitBranchRename).toHaveBeenCalledWith('main', 'trunk')
    await waitFor(() =>
      expect(
        screen.queryByLabelText('New name of the branch'),
      ).not.toBeInTheDocument(),
    )
  })

  test('Esc in the name field cancels the rename', async () => {
    const user = await renderPanel(repository())
    await openMode(user, 'Branches')

    screen.getByRole('option', { name: 'feature' }).focus()
    await user.keyboard('{F2}{Escape}')

    expect(
      screen.queryByLabelText('New name of the branch'),
    ).not.toBeInTheDocument()
    expect(gitBranchRename).not.toHaveBeenCalled()
  })

  test('creates a branch from the overflow menu', async () => {
    const user = await renderPanel(repository())

    await user.click(screen.getByRole('button', { name: 'More git actions' }))
    await user.click(screen.getByRole('menuitem', { name: /^New branch/ }))
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

  test('Delete asks before it deletes a branch', async () => {
    const user = await renderPanel(repository())
    await openMode(user, 'Branches')

    screen.getByRole('option', { name: 'feature' }).focus()
    await user.keyboard('{Delete}')
    expect(gitBranchDelete).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: 'Delete the branch?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(gitBranchDelete).toHaveBeenCalledWith('feature', false)
  })

  test('asks a second time for a branch that is not merged', async () => {
    const user = await renderPanel(repository())
    gitBranchDelete.mockResolvedValueOnce(ok('not-merged'))
    await openMode(user, 'Branches')

    screen.getByRole('option', { name: 'feature' }).focus()
    await user.keyboard('{Delete}')
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete',
      }),
    )
    const second = await screen.findByRole('dialog', {
      name: 'Delete the branch and lose its commits?',
    })
    expect(gitBranchDelete).toHaveBeenCalledTimes(1)
    await user.click(
      within(second).getByRole('button', { name: 'Delete anyway' }),
    )

    expect(gitBranchDelete).toHaveBeenLastCalledWith('feature', true)
  })

  test('cannot delete the current branch', async () => {
    const user = await renderPanel(repository())
    await openMode(user, 'Branches')

    screen.getByRole('option', { name: /^main/ }).focus()
    await user.keyboard('{Delete}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('conflict resolution', () => {
  async function openConflict(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('option', { name: 'a.sql, conflict' }))
  }

  test('shows the two sides in a tab and resolves with the incoming version', async () => {
    const user = await renderPanel(repository(conflicted, {}, 'Merge branch'))
    gitConflict.mockResolvedValue(ok(SIDES))

    await openConflict(user)
    expect(
      await screen.findByRole('heading', { name: 'Conflict in a.sql' }),
    ).toBeInTheDocument()
    expect(useTabsStore.getState().tabs[0].title).toBe('Conflict: a.sql')
    await waitFor(() => {
      const text = document.querySelector('.cm-mergeView')?.textContent ?? ''
      expect(text).toContain('select mine')
      expect(text).toContain('select incoming')
    })
    await user.click(
      screen.getByRole('button', { name: 'Use the incoming version' }),
    )
    await user.click(screen.getByRole('button', { name: 'Mark as resolved' }))

    expect(gitResolveText).toHaveBeenCalledWith('a.sql', 'select incoming\n')
    // The tab of the resolved file closes.
    await waitFor(() =>
      expect(
        useTabsStore.getState().tabs.some((tab) => tab.detail !== undefined),
      ).toBe(false),
    )
  })

  test('the result starts as the version of the user', async () => {
    const user = await renderPanel(repository(conflicted, {}, 'Merge branch'))
    gitConflict.mockResolvedValue(ok(SIDES))

    await openConflict(user)
    await user.click(
      await screen.findByRole('button', { name: 'Mark as resolved' }),
    )

    expect(gitResolveText).toHaveBeenCalledWith('a.sql', 'select mine\n')
  })

  test('keeps the conflict open when the resolution fails', async () => {
    const user = await renderPanel(repository(conflicted, {}, 'Merge branch'))
    gitConflict.mockResolvedValue(ok(SIDES))
    gitResolveText.mockResolvedValueOnce(failed('The name is not valid: a.sql'))

    await openConflict(user)
    await user.click(
      await screen.findByRole('button', { name: 'Mark as resolved' }),
    )

    expect(await screen.findByText(/name is not valid/)).toBeInTheDocument()
    expect(useTabsStore.getState().tabs[0].detail).toEqual({
      kind: 'conflict',
      path: 'a.sql',
    })
  })

  test('offers to keep or delete a file that one branch deleted', async () => {
    const user = await renderPanel(repository(conflicted, {}, 'Merge branch'))
    gitConflict.mockResolvedValue(ok({ ...SIDES, theirs: null }))

    await openConflict(user)
    expect(
      await screen.findByText(/The incoming branch deleted this file/),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete the file' }))

    expect(commands.gitResolveDelete).toHaveBeenCalledWith('a.sql')
  })

  test('keeps the changed file of a delete conflict', async () => {
    const user = await renderPanel(repository(conflicted, {}, 'Merge branch'))
    gitConflict.mockResolvedValue(ok({ ...SIDES, ours: null }))

    await openConflict(user)
    await user.click(
      await screen.findByRole('button', { name: 'Keep the changed file' }),
    )

    expect(gitResolveText).toHaveBeenCalledWith('a.sql', 'select incoming\n')
  })

  test('commits a merge with the prepared message', async () => {
    const user = await renderPanel(repository([], {}, 'Merge branch main'))

    expect(screen.getByText('Merge in progress')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Commit the merge/ }))

    expect(commands.gitCommit).toHaveBeenCalledWith('Merge branch main')
  })

  test('does not permit the merge commit while a conflict is open', async () => {
    await renderPanel(repository(conflicted, {}, 'Merge branch main'))

    expect(
      screen.getByRole('button', { name: /Commit the merge/ }),
    ).toBeDisabled()
  })

  test('asks before it aborts the merge', async () => {
    const user = await renderPanel(repository(conflicted, {}, 'Merge branch'))

    await user.click(screen.getByRole('button', { name: 'Abort the merge' }))
    expect(commands.gitMergeAbort).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: 'Abort the merge?' })
    await user.click(
      within(dialog).getByRole('button', { name: 'Abort the merge' }),
    )

    expect(commands.gitMergeAbort).toHaveBeenCalled()
  })
})

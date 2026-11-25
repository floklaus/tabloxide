import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { useResultsViewStore } from '../results/resultsViewStore'
import { useTabsStore } from '../tabs/tabsStore'
import { commit, failed, file, ok, repository } from '../test/gitFixtures'
import { DiffView } from './DiffView'
import { GitPanel } from './GitPanel'
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
      <DiffView />
    </>,
  )
  await waitFor(() => expect(useGitStore.getState().overview).not.toBeNull())
  return userEvent.setup()
}

beforeEach(() => {
  vi.clearAllMocks()
  useGitStore.getState().reset()
  useTabsStore.getState().reset()
  useResultsViewStore.getState().setView('results')
})

describe('commit history', () => {
  test('does not read the history until the user opens it', async () => {
    const user = await renderPanel(repository())
    expect(gitLog).not.toHaveBeenCalled()
    gitLog.mockResolvedValue(ok([commit(2), commit(1)]))

    await user.click(screen.getByRole('button', { name: 'Show the history' }))

    expect(gitLog).toHaveBeenCalledWith(HISTORY_PAGE, 0)
    const row = await screen.findByRole('button', { name: /^commit 2/ })
    expect(row).toHaveTextContent('aaaaaa2 · Ada · 2026-11-14')
    expect(
      screen.queryByRole('button', { name: 'Load more commits' }),
    ).not.toBeInTheDocument()
  })

  test('gets the next page of commits', async () => {
    const user = await renderPanel(repository())
    const page = Array.from({ length: HISTORY_PAGE }, (_, i) => commit(i))
    gitLog.mockResolvedValueOnce(ok(page))
    gitLog.mockResolvedValueOnce(ok([commit(900)]))

    await user.click(screen.getByRole('button', { name: 'Show the history' }))
    await user.click(
      await screen.findByRole('button', { name: 'Load more commits' }),
    )

    expect(gitLog).toHaveBeenLastCalledWith(HISTORY_PAGE, HISTORY_PAGE)
    expect(
      await screen.findByRole('button', { name: /^commit 900/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Load more commits' }),
    ).not.toBeInTheDocument()
  })

  test('shows the files of a commit and the diff of one file', async () => {
    const user = await renderPanel(repository())
    gitLog.mockResolvedValue(ok([commit(1)]))
    gitCommitFiles.mockResolvedValue(
      ok([{ path: 'new.sql', original_path: 'old.sql', kind: 'renamed' }]),
    )
    gitCommitDiff.mockResolvedValue(
      ok({ original: 'select 1\n', modified: 'select 2\n' }),
    )

    await user.click(screen.getByRole('button', { name: 'Show the history' }))
    await user.click(await screen.findByRole('button', { name: /^commit 1/ }))
    const files = await screen.findByRole('list', { name: 'Files of aaaaaa1' })
    await user.click(within(files).getByRole('button', { name: /^new.sql/ }))

    expect(gitCommitFiles).toHaveBeenCalledWith(commit(1).id)
    expect(gitCommitDiff).toHaveBeenCalledWith(
      commit(1).id,
      'new.sql',
      'old.sql',
    )
    expect(
      await screen.findByRole('heading', { name: 'new.sql in aaaaaa1' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Left: before the commit/)).toBeInTheDocument()
    expect(useResultsViewStore.getState().view).toBe('diff')
  })

  test('reads the history again after a commit', async () => {
    const user = await renderPanel(
      repository([file({ path: 'a.sql', staged: 'modified' })]),
    )
    gitLog.mockResolvedValue(ok([commit(1)]))
    await user.click(screen.getByRole('button', { name: 'Show the history' }))
    await screen.findByRole('button', { name: /^commit 1/ })
    gitLog.mockResolvedValue(ok([commit(2), commit(1)]))

    await user.type(screen.getByLabelText('Commit message'), 'next')
    await user.click(screen.getByRole('button', { name: /^Commit/ }))

    expect(
      await screen.findByRole('button', { name: /^commit 2/ }),
    ).toBeInTheDocument()
  })
})

describe('branch operations', () => {
  test('renames the current branch', async () => {
    const user = await renderPanel(repository())

    await user.click(screen.getByRole('button', { name: 'Rename the branch' }))
    const field = screen.getByLabelText('New name of the branch')
    expect(field).toHaveValue('main')
    await user.clear(field)
    await user.type(field, 'trunk')
    await user.click(screen.getByRole('button', { name: 'Rename' }))

    expect(gitBranchRename).toHaveBeenCalledWith('main', 'trunk')
    await waitFor(() =>
      expect(
        screen.queryByLabelText('New name of the branch'),
      ).not.toBeInTheDocument(),
    )
  })

  test('asks before it deletes a branch', async () => {
    const user = await renderPanel(repository())

    await user.click(screen.getByRole('button', { name: 'Delete a branch' }))
    expect(screen.getByLabelText('Branch to delete')).toHaveValue('feature')
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(gitBranchDelete).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: 'Delete the branch?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(gitBranchDelete).toHaveBeenCalledWith('feature', false)
  })

  test('asks a second time for a branch that is not merged', async () => {
    const user = await renderPanel(repository())
    gitBranchDelete.mockResolvedValueOnce(ok('not-merged'))

    await user.click(screen.getByRole('button', { name: 'Delete a branch' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
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

  test('cannot delete a branch when the current branch is the only branch', async () => {
    const overview = repository()
    if (overview.state !== 'repository') throw new Error('fixture')
    await renderPanel({
      ...overview,
      branches: [{ name: 'main', is_current: true, last_commit: null }],
    })

    expect(
      screen.getByRole('button', { name: 'Delete a branch' }),
    ).toBeDisabled()
  })
})

describe('conflict resolution', () => {
  test('shows the two sides and resolves with the incoming version', async () => {
    const user = await renderPanel(repository(conflicted, {}, 'Merge branch'))
    gitConflict.mockResolvedValue(ok(SIDES))

    await user.click(screen.getByRole('button', { name: 'Resolve a.sql' }))
    expect(
      await screen.findByRole('heading', { name: 'Conflict in a.sql' }),
    ).toBeInTheDocument()
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
    await waitFor(() => expect(useGitStore.getState().conflict).toBeNull())
  })

  test('the result starts as the version of the user', async () => {
    const user = await renderPanel(repository(conflicted, {}, 'Merge branch'))
    gitConflict.mockResolvedValue(ok(SIDES))

    await user.click(screen.getByRole('button', { name: 'Resolve a.sql' }))
    await user.click(
      await screen.findByRole('button', { name: 'Mark as resolved' }),
    )

    expect(gitResolveText).toHaveBeenCalledWith('a.sql', 'select mine\n')
  })

  test('keeps the conflict open when the resolution fails', async () => {
    const user = await renderPanel(repository(conflicted, {}, 'Merge branch'))
    gitConflict.mockResolvedValue(ok(SIDES))
    gitResolveText.mockResolvedValueOnce(failed('The name is not valid: a.sql'))

    await user.click(screen.getByRole('button', { name: 'Resolve a.sql' }))
    await user.click(
      await screen.findByRole('button', { name: 'Mark as resolved' }),
    )

    expect(await screen.findByText(/name is not valid/)).toBeInTheDocument()
    expect(useGitStore.getState().conflict?.path).toBe('a.sql')
  })

  test('offers to keep or delete a file that one branch deleted', async () => {
    const user = await renderPanel(repository(conflicted, {}, 'Merge branch'))
    gitConflict.mockResolvedValue(ok({ ...SIDES, theirs: null }))

    await user.click(screen.getByRole('button', { name: 'Resolve a.sql' }))
    expect(
      await screen.findByText(/The incoming branch deleted this file/),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete the file' }))

    expect(commands.gitResolveDelete).toHaveBeenCalledWith('a.sql')
  })

  test('keeps the changed file of a delete conflict', async () => {
    const user = await renderPanel(repository(conflicted, {}, 'Merge branch'))
    gitConflict.mockResolvedValue(ok({ ...SIDES, ours: null }))

    await user.click(screen.getByRole('button', { name: 'Resolve a.sql' }))
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

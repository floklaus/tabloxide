import { create } from 'zustand'
import {
  commands,
  type CommandError,
  type CommitFile_Serialize as CommitFile,
  type CommitInfo,
  type ConflictSides_Serialize as ConflictSides,
  type FileDiff,
  type FileStatus_Serialize as FileStatus,
  type GitOverview_Serialize,
} from '../bindings'
import { toMessage } from '../lib/errors'
import { useResultsViewStore } from '../results/resultsViewStore'
import { remoteChannel, useRemoteStore } from './remoteStore'
import { useTabsStore } from '../tabs/tabsStore'

export type GitOverview = GitOverview_Serialize

type CommandResult<T> =
  { status: 'ok'; data: T } | { status: 'error'; error: CommandError }

type Load<T> =
  | { status: 'loading' }
  | { status: 'loaded'; data: T }
  | { status: 'failed'; message: string }

export type DiffState = {
  /** Identifies the request. A late answer of an older request has a different key. */
  key: string
  title: string
  /** Tells the user what the two sides are. */
  sides: string
  /** A changed file of the working tree. A file of a commit has no value. */
  file?: { path: string; staged: boolean }
  load: Load<FileDiff>
}

export type ConflictState = { path: string; load: Load<ConflictSides> }

export type HistoryState = {
  commits: CommitInfo[]
  hasMore: boolean
  isLoading: boolean
}

export type CommitFilesState = { id: string; load: Load<CommitFile[]> }

/** Number of commits that one request for the history gets. */
export const HISTORY_PAGE = 50

type GitState = {
  overview: GitOverview | null
  /** The name of the operation that is in progress, for the user. */
  busy: string | null
  /** The text that Git wrote for the last operation. */
  output: string | null
  error: string | null
  diff: DiffState | null
  /** The file with a conflict that the diff view shows. */
  conflict: ConflictState | null
  /** The commit history. `null` until the user opens it. */
  history: HistoryState | null
  /** The files of the commit that the user selected in the history. */
  commitFiles: CommitFilesState | null

  refresh: () => Promise<void>
  /** Reads the status again after a different program changed the repository. */
  refreshAfterExternalChange: () => Promise<void>
  setEnabled: (isEnabled: boolean) => Promise<void>
  init: () => Promise<void>
  stage: (paths: string[]) => Promise<void>
  unstage: (paths: string[]) => Promise<void>
  discard: (file: FileStatus) => Promise<void>
  /** Commits the index. Returns `true` if the commit is complete. */
  commit: (message: string) => Promise<boolean>
  createBranch: (name: string) => Promise<boolean>
  switchBranch: (name: string) => Promise<void>
  renameBranch: (oldName: string, newName: string) => Promise<boolean>
  /** Deletes a branch. Returns `undefined` if the operation failed. */
  deleteBranch: (
    name: string,
    force: boolean,
  ) => Promise<'deleted' | 'not-merged' | undefined>
  loadHistory: () => Promise<void>
  loadMoreHistory: () => Promise<void>
  closeHistory: () => void
  /** Shows or hides the files of a commit. */
  toggleCommit: (id: string) => Promise<void>
  showCommitDiff: (commit: CommitInfo, file: CommitFile) => Promise<void>
  showConflict: (path: string) => Promise<void>
  /** Resolves a conflict with `text`. Returns `true` if the file is resolved. */
  resolveWithText: (path: string, text: string) => Promise<boolean>
  resolveByDelete: (path: string) => Promise<boolean>
  abortMerge: () => Promise<void>
  fetch: () => Promise<void>
  pull: () => Promise<void>
  push: () => Promise<void>
  showDiff: (path: string, isStaged: boolean) => Promise<void>
  clearMessages: () => void
  reset: () => void
}

const INITIAL = {
  overview: null,
  busy: null,
  output: null,
  error: null,
  diff: null,
  conflict: null,
  history: null,
  commitFiles: null,
}

/** Converts the answer of a command to a load state. */
async function toLoad<T>(
  command: () => Promise<CommandResult<T>>,
): Promise<Load<T>> {
  try {
    const result = await command()
    return result.status === 'ok'
      ? { status: 'loaded', data: result.data }
      : { status: 'failed', message: result.error.message }
  } catch (error) {
    return { status: 'failed', message: toMessage(error) }
  }
}

export const useGitStore = create<GitState>((set, get) => {
  const refresh = async () => {
    try {
      const result = await commands.gitOverview()
      if (result.status === 'ok') set({ overview: result.data })
      else set({ error: result.error.message })
    } catch (error) {
      set({ error: toMessage(error) })
    }
  }

  const loadHistory = async () => {
    set({
      history: {
        commits: [],
        hasMore: false,
        ...get().history,
        isLoading: true,
      },
    })
    const load = await toLoad(() => commands.gitLog(HISTORY_PAGE, 0))
    if (!get().history) return
    if (load.status === 'failed') {
      set({
        history: { commits: [], hasMore: false, isLoading: false },
        error: load.message,
      })
      return
    }
    const commits = load.status === 'loaded' ? load.data : []
    const shown = get().commitFiles?.id
    set({
      history: {
        commits,
        hasMore: commits.length === HISTORY_PAGE,
        isLoading: false,
      },
      // A commit that is not in the list any more cannot stay open.
      commitFiles: commits.some((commit) => commit.id === shown)
        ? get().commitFiles
        : null,
    })
  }

  const showDiff = async (
    request: Omit<DiffState, 'load'>,
    command: () => Promise<CommandResult<FileDiff>>,
  ) => {
    set({ diff: { ...request, load: { status: 'loading' } }, conflict: null })
    useResultsViewStore.getState().setView('diff')
    const load = await toLoad(command)
    if (get().diff?.key === request.key) set({ diff: { ...request, load } })
  }

  /**
   * Runs one Git operation, then reads the status again. Only one operation runs at a time.
   * `changesFiles` is for an operation that can change files of the working tree.
   */
  const operate = async <T>(
    label: string,
    command: () => Promise<CommandResult<T>>,
    changesFiles = false,
  ): Promise<T | undefined> => {
    if (get().busy) return undefined
    set({ busy: label, error: null, output: null })
    let data: T | undefined
    try {
      const result = await command()
      if (result.status === 'ok') {
        data = result.data
        if (typeof data === 'string' && data.trim())
          set({ output: data.trim() })
      } else {
        set({ error: result.error.message })
      }
    } catch (error) {
      set({ error: toMessage(error) })
    }
    // A failed operation can also change files, for example a pull with a conflict.
    if (changesFiles) await useTabsStore.getState().reloadFromDisk()
    await refresh()
    // An operation can add commits or change the branch.
    if (get().history) await loadHistory()
    set({ busy: null })
    return data
  }

  return {
    ...INITIAL,
    refresh,

    setEnabled: async (isEnabled) => {
      await operate('Changing the setting', () =>
        commands.gitSetEnabled(isEnabled),
      )
    },
    init: async () => {
      await operate('Initialising', () => commands.gitInit())
    },
    stage: async (paths) => {
      await operate('Staging', () => commands.gitStage(paths))
    },
    unstage: async (paths) => {
      await operate('Unstaging', () => commands.gitUnstage(paths))
    },
    discard: async (file) => {
      await operate(
        'Discarding',
        () => commands.gitDiscard(file.path, file.is_untracked),
        true,
      )
    },
    commit: async (message) => {
      const result = await operate('Committing', () =>
        commands.gitCommit(message),
      )
      return result !== undefined
    },
    createBranch: async (name) => {
      const result = await operate('Creating the branch', () =>
        commands.gitBranchCreate(name),
      )
      return result !== undefined
    },
    switchBranch: async (name) => {
      await operate(
        'Switching the branch',
        () => commands.gitBranchSwitch(name),
        true,
      )
    },
    refreshAfterExternalChange: async () => {
      // The panel was not open, or an operation reads the status at its end.
      if (!get().overview || get().busy) return
      await refresh()
      if (get().history) await loadHistory()
    },

    fetch: async () => {
      await operate('Fetching', () => commands.gitFetch(remoteChannel()))
      useRemoteStore.getState().end()
    },
    pull: async () => {
      await operate('Pulling', () => commands.gitPull(remoteChannel()), true)
      useRemoteStore.getState().end()
    },
    push: async () => {
      await operate('Pushing', () => commands.gitPush(remoteChannel()))
      useRemoteStore.getState().end()
    },

    renameBranch: async (oldName, newName) => {
      const result = await operate('Renaming the branch', () =>
        commands.gitBranchRename(oldName, newName),
      )
      return result !== undefined
    },
    deleteBranch: (name, force) =>
      operate('Deleting the branch', () =>
        commands.gitBranchDelete(name, force),
      ),

    loadHistory,
    loadMoreHistory: async () => {
      const history = get().history
      if (!history || history.isLoading || !history.hasMore) return
      set({ history: { ...history, isLoading: true } })
      const load = await toLoad(() =>
        commands.gitLog(HISTORY_PAGE, history.commits.length),
      )
      if (!get().history) return
      const more = load.status === 'loaded' ? load.data : []
      set({
        history: {
          commits: [...history.commits, ...more],
          hasMore: more.length === HISTORY_PAGE,
          isLoading: false,
        },
        error: load.status === 'failed' ? load.message : get().error,
      })
    },
    closeHistory: () => set({ history: null, commitFiles: null }),
    toggleCommit: async (id) => {
      if (get().commitFiles?.id === id) {
        set({ commitFiles: null })
        return
      }
      set({ commitFiles: { id, load: { status: 'loading' } } })
      const load = await toLoad(() => commands.gitCommitFiles(id))
      if (get().commitFiles?.id === id) set({ commitFiles: { id, load } })
    },
    showCommitDiff: (commit, file) =>
      showDiff(
        {
          key: `commit:${commit.id}:${file.path}`,
          title: `${file.path} in ${commit.short_id}`,
          sides: 'Left: before the commit. Right: the commit.',
        },
        () => commands.gitCommitDiff(commit.id, file.path, file.original_path),
      ),

    showDiff: (path, isStaged) =>
      showDiff(
        {
          key: `file:${isStaged}:${path}`,
          title: path,
          file: { path, staged: isStaged },
          sides: isStaged
            ? 'Left: last commit. Right: staged.'
            : 'Left: staged or last commit. Right: file on disk.',
        },
        () => commands.gitDiff(path, isStaged),
      ),

    showConflict: async (path) => {
      set({ conflict: { path, load: { status: 'loading' } }, diff: null })
      useResultsViewStore.getState().setView('diff')
      const load = await toLoad(() => commands.gitConflict(path))
      if (get().conflict?.path === path) set({ conflict: { path, load } })
    },
    resolveWithText: async (path, text) => {
      const result = await operate(
        'Resolving the conflict',
        () => commands.gitResolveText(path, text),
        true,
      )
      if (result !== undefined) set({ conflict: null })
      return result !== undefined
    },
    resolveByDelete: async (path) => {
      const result = await operate(
        'Resolving the conflict',
        () => commands.gitResolveDelete(path),
        true,
      )
      if (result !== undefined) set({ conflict: null })
      return result !== undefined
    },
    abortMerge: async () => {
      const result = await operate(
        'Aborting the merge',
        () => commands.gitMergeAbort(),
        true,
      )
      if (result !== undefined) set({ conflict: null })
    },

    clearMessages: () => set({ error: null, output: null }),
    reset: () => set(INITIAL),
  }
})

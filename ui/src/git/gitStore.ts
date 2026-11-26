import { create } from 'zustand'
import {
  commands,
  type CommitInfo,
  type FileStatus_Serialize as FileStatus,
  type GitOverview_Serialize,
} from '../bindings'
import { toMessage } from '../lib/errors'
import { useTabsStore } from '../tabs/tabsStore'
import { toLoad, type CommandResult } from './gitLoad'
import { remoteChannel, useRemoteStore } from './remoteStore'

export type GitOverview = GitOverview_Serialize

export type HistoryState = {
  commits: CommitInfo[]
  hasMore: boolean
  isLoading: boolean
}

/** Number of commits that one request for the history gets. */
export const HISTORY_PAGE = 50

type GitState = {
  overview: GitOverview | null
  /** Goes up after each read of the status. A diff tab reads its diff again. */
  revision: number
  /** The name of the operation that is in progress, for the user. */
  busy: string | null
  /** The text that Git wrote for the last operation. */
  output: string | null
  error: string | null
  /** The commit history. `null` until the user opens the History mode. */
  history: HistoryState | null
  /** The text of the commit message field. It stays when the mode changes. */
  message: string

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
  setMessage: (message: string) => void
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
  /** Resolves a conflict with `text`. Returns `true` if the file is resolved. */
  resolveWithText: (path: string, text: string) => Promise<boolean>
  resolveByDelete: (path: string) => Promise<boolean>
  abortMerge: () => Promise<void>
  fetch: () => Promise<void>
  pull: () => Promise<void>
  push: () => Promise<void>
  clearMessages: () => void
  reset: () => void
}

const INITIAL = {
  overview: null,
  revision: 0,
  busy: null,
  output: null,
  error: null,
  history: null,
  message: '',
}

/** Closes the conflict tabs: of one file, or of all files without `path`. */
function closeConflicts(path?: string) {
  const tabs = useTabsStore.getState()
  for (const tab of tabs.tabs) {
    const detail = tab.detail
    if (
      detail?.kind === 'conflict' &&
      (path === undefined || detail.path === path)
    )
      tabs.close(tab.id)
  }
}

export const useGitStore = create<GitState>((set, get) => {
  const refresh = async () => {
    try {
      const result = await commands.gitOverview()
      if (result.status === 'ok')
        set({ overview: result.data, revision: get().revision + 1 })
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
    set({
      history: {
        commits,
        hasMore: commits.length === HISTORY_PAGE,
        isLoading: false,
      },
    })
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
    setMessage: (message) => set({ message }),
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
    resolveWithText: async (path, text) => {
      const result = await operate(
        'Resolving the conflict',
        () => commands.gitResolveText(path, text),
        true,
      )
      if (result !== undefined) closeConflicts(path)
      return result !== undefined
    },
    resolveByDelete: async (path) => {
      const result = await operate(
        'Resolving the conflict',
        () => commands.gitResolveDelete(path),
        true,
      )
      if (result !== undefined) closeConflicts(path)
      return result !== undefined
    },
    abortMerge: async () => {
      const result = await operate(
        'Aborting the merge',
        () => commands.gitMergeAbort(),
        true,
      )
      if (result !== undefined) closeConflicts()
    },

    clearMessages: () => set({ error: null, output: null }),
    reset: () => set(INITIAL),
  }
})

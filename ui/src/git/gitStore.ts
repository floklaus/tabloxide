import { create } from 'zustand'
import {
  commands,
  type CommandError,
  type FileDiff,
  type FileStatus_Serialize as FileStatus,
  type GitOverview_Serialize,
} from '../bindings'
import { toMessage } from '../lib/errors'
import { useResultsViewStore } from '../results/resultsViewStore'
import { useTabsStore } from '../tabs/tabsStore'

export type GitOverview = GitOverview_Serialize

type CommandResult<T> =
  { status: 'ok'; data: T } | { status: 'error'; error: CommandError }

export type DiffState = {
  path: string
  isStaged: boolean
  load:
    | { status: 'loading' }
    | { status: 'loaded'; diff: FileDiff }
    | { status: 'failed'; message: string }
}

type GitState = {
  overview: GitOverview | null
  /** The name of the operation that is in progress, for the user. */
  busy: string | null
  /** The text that Git wrote for the last operation. */
  output: string | null
  error: string | null
  diff: DiffState | null

  refresh: () => Promise<void>
  setEnabled: (isEnabled: boolean) => Promise<void>
  init: () => Promise<void>
  stage: (paths: string[]) => Promise<void>
  unstage: (paths: string[]) => Promise<void>
  discard: (file: FileStatus) => Promise<void>
  /** Commits the index. Returns `true` if the commit is complete. */
  commit: (message: string) => Promise<boolean>
  createBranch: (name: string) => Promise<boolean>
  switchBranch: (name: string) => Promise<void>
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
    fetch: async () => {
      await operate('Fetching', () => commands.gitFetch())
    },
    pull: async () => {
      await operate('Pulling', () => commands.gitPull(), true)
    },
    push: async () => {
      await operate('Pushing', () => commands.gitPush())
    },

    showDiff: async (path, isStaged) => {
      set({ diff: { path, isStaged, load: { status: 'loading' } } })
      useResultsViewStore.getState().setView('diff')
      let load: DiffState['load']
      try {
        const result = await commands.gitDiff(path, isStaged)
        load =
          result.status === 'ok'
            ? { status: 'loaded', diff: result.data }
            : { status: 'failed', message: result.error.message }
      } catch (error) {
        load = { status: 'failed', message: toMessage(error) }
      }
      const current = get().diff
      if (current?.path === path && current.isStaged === isStaged) {
        set({ diff: { path, isStaged, load } })
      }
    },

    clearMessages: () => set({ error: null, output: null }),
    reset: () => set(INITIAL),
  }
})

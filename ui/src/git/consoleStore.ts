import { create } from 'zustand'
import {
  commands,
  type ConsoleNames,
  type ConsoleOutput_Serialize as ConsoleOutput,
} from '../bindings'
import { toMessage } from '../lib/errors'
import { useGitStore } from './gitStore'
import { remoteChannel } from './remoteStore'

/** One command of the console and its result. */
export type ConsoleEntry = {
  id: number
  line: string
  state:
    | { type: 'running' }
    | { type: 'done'; output: ConsoleOutput }
    | { type: 'refused'; reason: string }
    | { type: 'confirm'; effect: string }
    | { type: 'not-run' }
    | { type: 'failed'; message: string }
}

/** The subcommands that the Tab key completes in the first position. */
export const SUBCOMMANDS = [
  'add',
  'blame',
  'branch',
  'checkout',
  'cherry-pick',
  'clean',
  'clone',
  'commit',
  'config',
  'describe',
  'diff',
  'fetch',
  'grep',
  'init',
  'log',
  'ls-files',
  'merge',
  'mv',
  'pull',
  'push',
  'rebase',
  'reflog',
  'remote',
  'reset',
  'restore',
  'revert',
  'rm',
  'shortlog',
  'show',
  'stash',
  'status',
  'switch',
  'tag',
  'worktree',
]

/** The number of completion options that the console shows at most. */
const MAX_OPTIONS = 20

type ConsoleState = {
  entries: ConsoleEntry[]
  input: string
  /** The earlier lines. The oldest is first. */
  history: string[]
  /** The position in `history` that Up and Down selected, or `null`. */
  historyIndex: number | null
  names: ConsoleNames | null
  /** The completion options of the last Tab key, if more than one fits. */
  options: string[]
  /** The identifier of the command that runs, or `null`. */
  runningId: number | null

  /** Reads the history and the names of the workspace. */
  load: () => Promise<void>
  setInput: (input: string) => void
  /** Runs the line of the input field. */
  submit: () => Promise<void>
  /** Runs a command after the user confirmed its effect. */
  confirm: (id: number) => Promise<void>
  /** Does not run a command that needs a confirmation. */
  decline: (id: number) => void
  /** Stops the command that runs. */
  stop: () => Promise<void>
  /** Up (-1) and Down (+1) select an earlier line. */
  moveInHistory: (step: -1 | 1) => void
  /** Completes the last word of the input. */
  complete: () => void
  clear: () => void
  reset: () => void
}

const INITIAL = {
  entries: [] as ConsoleEntry[],
  input: '',
  history: [] as string[],
  historyIndex: null,
  names: null,
  options: [] as string[],
  runningId: null,
}

let nextId = 1

/** The longest start that all `words` have. */
function commonStart(words: string[]): string {
  return words.reduce((prefix, word) => {
    let length = 0
    while (length < prefix.length && prefix[length] === word[length]) length++
    return prefix.slice(0, length)
  })
}

export const useConsoleStore = create<ConsoleState>((set, get) => {
  const update = (id: number, state: ConsoleEntry['state']) =>
    set((current) => ({
      entries: current.entries.map((entry) =>
        entry.id === id ? { ...entry, state } : entry,
      ),
    }))

  const readNames = async () => {
    try {
      const result = await commands.gitConsoleNames()
      if (result.status === 'ok') set({ names: result.data })
    } catch {
      // The completion is only a convenience. Without names, Tab completes less.
    }
  }

  const run = async (id: number, line: string, confirmed: boolean) => {
    update(id, { type: 'running' })
    set({ runningId: id })
    try {
      const result = await commands.gitConsoleRun(
        id,
        line,
        confirmed,
        remoteChannel(),
      )
      if (result.status === 'error') {
        update(id, { type: 'failed', message: result.error.message })
      } else if (result.data.status === 'refused') {
        update(id, { type: 'refused', reason: result.data.reason })
      } else if (result.data.status === 'confirm') {
        update(id, { type: 'confirm', effect: result.data.effect })
      } else {
        update(id, { type: 'done', output: result.data.output })
        // A command can change the files, the branches, and the index.
        void useGitStore.getState().refresh()
        void readNames()
      }
    } catch (error) {
      update(id, { type: 'failed', message: toMessage(error) })
    } finally {
      if (get().runningId === id) set({ runningId: null })
    }
  }

  return {
    ...INITIAL,

    load: async () => {
      try {
        const result = await commands.gitConsoleHistory()
        if (result.status === 'ok') set({ history: result.data })
      } catch {
        // Without a history, Up and Down have no lines.
      }
      await readNames()
    },

    setInput: (input) => set({ input, historyIndex: null, options: [] }),

    submit: async () => {
      const line = get().input.trim()
      if (!line || get().runningId !== null) return
      const id = nextId++
      set((state) => ({
        input: '',
        historyIndex: null,
        options: [],
        history:
          state.history[state.history.length - 1] === line
            ? state.history
            : [...state.history, line],
        entries: [...state.entries, { id, line, state: { type: 'running' } }],
      }))
      await run(id, line, false)
    },

    confirm: async (id) => {
      const entry = get().entries.find((item) => item.id === id)
      if (!entry || entry.state.type !== 'confirm' || get().runningId !== null)
        return
      await run(id, entry.line, true)
    },

    decline: (id) => update(id, { type: 'not-run' }),

    stop: async () => {
      const id = get().runningId
      if (id !== null) await commands.gitConsoleCancel(id)
    },

    moveInHistory: (step) => {
      const { history, historyIndex } = get()
      if (history.length === 0) return
      const start = historyIndex ?? history.length
      const index = Math.min(Math.max(start + step, 0), history.length)
      set({
        historyIndex: index === history.length ? null : index,
        input: index === history.length ? '' : history[index],
        options: [],
      })
    },

    complete: () => {
      const { input, names } = get()
      const words = input.split(' ')
      const last = words[words.length - 1]
      const isFirst = words.filter(Boolean).length <= 1 && words.length === 1
      const pool = isFirst
        ? SUBCOMMANDS
        : names
          ? [...names.branches, ...names.remotes, ...names.tags, ...names.files]
          : []
      const matches = [...new Set(pool.filter((name) => name.startsWith(last)))]
      if (matches.length === 0) {
        set({ options: [] })
        return
      }
      const prefix =
        matches.length === 1 ? `${matches[0]} ` : commonStart(matches)
      set({
        input: [...words.slice(0, -1), prefix].join(' '),
        options: matches.length === 1 ? [] : matches.slice(0, MAX_OPTIONS),
      })
    },

    clear: () => set({ entries: [] }),

    reset: () => set(INITIAL),
  }
})

/** The text of the last output of the console, for "Explain the last output". */
export function lastOutput(
  entries: ConsoleEntry[],
): { command: string; output: string } | null {
  for (let index = entries.length - 1; index >= 0; index--) {
    const { line, state } = entries[index]
    if (state.type === 'done') {
      const text = [state.output.stdout, state.output.stderr]
        .filter((part) => part.trim())
        .join('\n')
      return { command: line, output: text || '(no output)' }
    }
  }
  return null
}

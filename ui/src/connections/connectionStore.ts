import { create } from 'zustand'
import { commands, type CommandError, type ConnectError } from '../bindings'
import { toMessage } from '../lib/errors'
import { useWorkspaceStore, type Workspace } from '../workspace/workspaceStore'
import type { ConnectionProfile } from './formModel'

export type TestState =
  | { status: 'testing' }
  | { status: 'connected'; version: string }
  | { status: 'failed'; error: ConnectError }

type CommandResult =
  { status: 'ok'; data: Workspace } | { status: 'error'; error: CommandError }

type ConnectionState = {
  /** The last test result of each connection. The key is the connection identifier. */
  tests: Record<string, TestState>
  save: (
    profile: ConnectionProfile,
    password: string | null,
  ) => Promise<CommandError | null>
  remove: (id: string) => Promise<void>
  duplicate: (id: string) => Promise<void>
  test: (profile: ConnectionProfile) => Promise<void>
}

function internalError(error: unknown): CommandError {
  return { kind: 'internal', message: toMessage(error), issues: [] }
}

function failed(kind: ConnectError['kind'], detail: string): TestState {
  return { status: 'failed', error: { kind, advice: '', detail } }
}

/** Tests a connection. `password` is `null` when the backend must get the stored password. */
export async function runConnectionTest(
  profile: ConnectionProfile,
  password: string | null,
): Promise<TestState> {
  try {
    const result = await commands.connectionTest(profile, password)
    if (result.status === 'error') {
      const issues = result.error.issues.map((issue) => issue.message).join(' ')
      return failed(
        'invalid-configuration',
        [result.error.message, issues].join(' ').trim(),
      )
    }
    return result.data.status === 'connected'
      ? { status: 'connected', version: result.data.server.version }
      : { status: 'failed', error: result.data.error }
  } catch (error) {
    return failed('other', toMessage(error))
  }
}

/** Runs a command that returns the changed workspace, and stores the workspace. */
async function applyChange(
  command: () => Promise<CommandResult>,
): Promise<CommandError | null> {
  try {
    const result = await command()
    if (result.status === 'error') return result.error
    useWorkspaceStore.getState().setWorkspace(result.data)
    return null
  } catch (error) {
    return internalError(error)
  }
}

function withoutKey<T>(
  record: Record<string, T>,
  key: string,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).filter(([name]) => name !== key),
  )
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  tests: {},

  save: async (profile, password) => {
    const error = await applyChange(() =>
      commands.connectionSave(profile, password),
    )
    // The settings changed, so the last test result is not valid.
    if (!error) set((state) => ({ tests: withoutKey(state.tests, profile.id) }))
    return error
  },

  remove: async (id) => {
    const error = await applyChange(() => commands.connectionDelete(id))
    if (error) {
      useWorkspaceStore.getState().setError(error.message)
      return
    }
    set((state) => ({ tests: withoutKey(state.tests, id) }))
  },

  duplicate: async (id) => {
    const error = await applyChange(() => commands.connectionDuplicate(id))
    if (error) useWorkspaceStore.getState().setError(error.message)
  },

  test: async (profile) => {
    set((state) => ({
      tests: { ...state.tests, [profile.id]: { status: 'testing' } },
    }))
    const result = await runConnectionTest(profile, null)
    set((state) => ({ tests: { ...state.tests, [profile.id]: result } }))
  },
}))

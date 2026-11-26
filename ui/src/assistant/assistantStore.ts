import { create } from 'zustand'
import { commands } from '../bindings'
import { toMessage } from '../lib/errors'
import { useShellStore } from '../shell/shellStore'
import { useTabsStore } from '../tabs/tabsStore'
import {
  createSession,
  type ActionRequest,
  type SessionState,
  type SessionStore,
} from './assistantSession'

export type {
  ActionRequest,
  ReplaceTarget,
  AssistantMessage,
  AssistantStatus,
  PendingAnalyze,
  RequestOutcome,
  SchemaInfo,
  SessionContext,
  SessionState,
  SessionStore,
} from './assistantSession'
export { planRequest, PHASES, usesSchema } from './assistantSession'

export type SessionEntry = { id: string; store: SessionStore }

type AssistantState = {
  /** `null` until the backend answers. */
  hasKey: boolean | null
  /** The conversations. The newest is last. */
  sessions: SessionEntry[]
  /** The session that the side panel shows. */
  activeId: string

  loadStatus: () => Promise<void>
  /** Stores the API key. Returns an error message, or `null`. */
  saveKey: (key: string) => Promise<string | null>
  /** Removes the API key. Returns an error message, or `null`. */
  deleteKey: () => Promise<string | null>
  /** Starts a new session and shows it in the side panel. Returns its identifier. */
  newSession: () => string
  /** Shows the session in the side panel. */
  select: (id: string) => void
  /** Opens the session in an editor tab, or shows its tab. */
  openInTab: (id: string) => void
  /** Stops all requests and starts again with one empty session. */
  reset: () => void
}

let nextSessionId = 1

function makeEntry(): SessionEntry {
  return { id: `session-${nextSessionId++}`, store: createSession() }
}

const FIRST = makeEntry()

export const useAssistantStore = create<AssistantState>((set, get) => ({
  hasKey: null,
  sessions: [FIRST],
  activeId: FIRST.id,

  loadStatus: async () => {
    try {
      const result = await commands.assistantStatus()
      if (result.status === 'ok') set({ hasKey: result.data.has_key })
      else activeSession().setState({ error: result.error.message })
    } catch (error) {
      activeSession().setState({ error: toMessage(error) })
    }
  },

  saveKey: async (key) => {
    try {
      const result = await commands.assistantKeySet(key)
      if (result.status === 'error') return result.error.message
      set({ hasKey: true })
      activeSession().setState({ error: null })
      return null
    } catch (error) {
      return toMessage(error)
    }
  },

  deleteKey: async () => {
    try {
      const result = await commands.assistantKeyDelete()
      if (result.status === 'error') return result.error.message
      set({ hasKey: false })
      return null
    } catch (error) {
      return toMessage(error)
    }
  },

  newSession: () => {
    // An empty session is enough. A second empty session does not help.
    const empty = get().sessions.find(
      (entry) =>
        entry.store.getState().title === null &&
        entry.store.getState().status === 'idle',
    )
    if (empty) {
      set({ activeId: empty.id })
      return empty.id
    }
    const entry = makeEntry()
    set({ sessions: [...get().sessions, entry], activeId: entry.id })
    return entry.id
  },

  select: (id) => {
    if (get().sessions.some((entry) => entry.id === id)) set({ activeId: id })
  },

  openInTab: (id) => {
    if (!get().sessions.some((entry) => entry.id === id)) return
    useTabsStore.getState().openAssistantTab(id)
  },

  reset: () => {
    for (const entry of get().sessions) entry.store.getState().reset()
    const entry = makeEntry()
    set({ sessions: [entry], activeId: entry.id })
  },
}))

/** Returns the store of a session, or `undefined`. */
export function sessionStore(id: string): SessionStore | undefined {
  return useAssistantStore.getState().sessions.find((entry) => entry.id === id)
    ?.store
}

/** Returns the store of the session of the side panel. */
export function activeSession(): SessionStore {
  const { sessions, activeId } = useAssistantStore.getState()
  return (sessions.find((entry) => entry.id === activeId) ?? sessions[0]).store
}

/** The state of a session for the user: Running, Waiting for you, Done, or New. */
export type SessionLabel =
  'running' | 'waiting' | 'done' | 'stopped' | 'failed' | 'new'

export function labelOf(state: SessionState): SessionLabel {
  if (state.status !== 'idle') return 'running'
  if (state.pendingAnalyze) return 'waiting'
  if (state.outcome === 'running') return 'running'
  return state.outcome ?? 'new'
}

/**
 * Shows the assistant panel and sends the request of an AI action. Without an API
 * key, the panel shows the setup and the request does not go. If the session of the
 * panel has a request in progress, the action starts a new session.
 */
export async function runAiAction(action: ActionRequest): Promise<void> {
  const shell = useShellStore.getState()
  if (!shell.panels.assistant) shell.togglePanel('assistant')
  const assistant = useAssistantStore.getState()
  if (assistant.hasKey === false) return
  if (activeSession().getState().status !== 'idle') assistant.newSession()
  await activeSession().getState().runAction(action)
}

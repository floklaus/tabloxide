import { Channel } from '@tauri-apps/api/core'
import { create } from 'zustand'
import {
  commands,
  type AssistantEvent,
  type Environment,
  type Role,
  type Task,
} from '../bindings'
import { activeEditor } from '../editor/editorBridge'
import { toMessage } from '../lib/errors'
import { usePreferencesStore } from '../preferences/preferencesStore'
import { getQueryStore } from '../query/queryStore'
import { useTabsStore, type Tab } from '../tabs/tabsStore'
import { useWorkspaceStore } from '../workspace/workspaceStore'

export type AssistantMessage = {
  role: Role
  text: string
  /** A remark of the application about the message, for example that it is not complete. */
  note?: string
}

export type AssistantStatus =
  'idle' | 'reading-plan' | 'reading-schema' | 'waiting' | 'answering'

/** The schema of the last request: all tables and views, and those with columns. */
export type SchemaInfo = { relations: number; detailed: number }

/** A plan read with EXPLAIN ANALYZE that waits for the confirmation of the user. */
export type PendingAnalyze = {
  /** The tab of the statement. The plan read uses this tab also after a tab change. */
  tabId: string
  connectionName: string
  environment: Environment
}

type AssistantState = {
  /** `null` until the backend answers. */
  hasKey: boolean | null
  /** The complete messages of the conversation. */
  messages: AssistantMessage[]
  /** The text of the answer that is in progress. */
  answer: string
  /** The text in the request field. */
  draft: string
  status: AssistantStatus
  schema: SchemaInfo | null
  /** `true` if the next request reads the schema from the database again. */
  refreshesSchema: boolean
  error: string | null
  pendingAnalyze: PendingAnalyze | null

  loadStatus: () => Promise<void>
  /** Stores the API key. Returns an error message, or `null`. */
  saveKey: (key: string) => Promise<string | null>
  /** Removes the API key. Returns an error message, or `null`. */
  deleteKey: () => Promise<string | null>
  setDraft: (draft: string) => void
  /** Sends the text of the request field. */
  send: () => Promise<void>
  /**
   * Reads the plan of the statement at the cursor and asks for its analysis.
   * `analyze` runs the statement to measure the times.
   */
  analyzePlan: (analyze: boolean) => Promise<void>
  confirmAnalyze: () => Promise<void>
  cancelAnalyze: () => void
  /** Stops the request that is in progress. */
  stop: () => Promise<void>
  requestSchemaRefresh: () => void
  /** Starts a new conversation. */
  clear: () => void
  reset: () => void
}

const INITIAL = {
  messages: [] as AssistantMessage[],
  answer: '',
  draft: '',
  status: 'idle' as AssistantStatus,
  schema: null,
  refreshesSchema: false,
  error: null,
  pendingAnalyze: null,
}

const NOTES = {
  truncated: 'The answer got to the maximum length. It is not complete.',
  refused: 'The AI service declined this request.',
  stopped: 'You stopped this answer. It is not complete.',
}

let nextAskId = 1
/** The identifier of the request that is in progress. */
let activeAskId: number | null = null
/** `true` after the user stopped the request that is in progress. */
let isStopRequested = false
/** The session that reads a plan now. A stop cancels its statement. */
let planSessionId: number | null = null

function activeTab(): Tab | undefined {
  const tabs = useTabsStore.getState()
  return tabs.tabs.find((tab) => tab.id === tabs.activeId)
}

function connectionOf(tab: Tab | undefined) {
  const connections = useWorkspaceStore.getState().workspace?.connections ?? []
  return connections.find((connection) => connection.id === tab?.connectionId)
}

/**
 * Returns the session of `tab`. A tab with a connection and without a session
 * connects first. Returns `null` if the tab has no session after that.
 *
 * The function uses the tab of the request, not the active tab. The user can
 * select a different tab while the connect is in progress.
 */
async function openSession(tab: Tab | undefined): Promise<number | null> {
  if (!tab) return null
  const query = getQueryStore(tab.id)
  if (!query.getState().session && tab.connectionId) {
    await query.getState().connect(tab.connectionId)
  }
  return query.getState().session?.id ?? null
}

/**
 * The assistant reads the schema or a plan on the session of the tab. The backend
 * then closes the open result. This tells the results pane why the result ended.
 */
function markResultClosed(tab: Tab | undefined): void {
  if (!tab) return
  const query = getQueryStore(tab.id)
  if (query.getState().open) {
    query.setState({ open: null, stopReason: 'assistant' })
  }
}

/** Makes the request text for the analysis of a plan. */
export function planRequest(
  statement: string,
  plan: string,
  isAnalyzed: boolean,
  isTruncated: boolean,
): string {
  const source = isAnalyzed
    ? 'Plan from EXPLAIN ANALYZE (measured times):'
    : 'Plan from EXPLAIN (estimates only):'
  const lines = [
    'Analyze the execution plan of this statement. Suggest improvements.',
    '',
    'Statement:',
    '```sql',
    statement,
    '```',
    '',
    source,
    '```',
    plan,
    '```',
  ]
  if (isTruncated) {
    lines.push('', 'The plan is longer. This request has only its first part.')
  }
  return lines.join('\n')
}

export const useAssistantStore = create<AssistantState>((set, get) => {
  /** Removes the last request from the conversation and shows `error`. */
  const fail = (error: string, text: string, task: Task) => {
    set((state) => ({
      messages: state.messages.slice(0, -1),
      answer: '',
      status: 'idle',
      error,
      // A plan request is not text of the user. It does not go back into the field.
      draft: task === 'sql' && !state.draft ? text : state.draft,
    }))
  }

  /** Adds the answer `text` to the conversation. */
  const complete = (text: string, note?: string) => {
    set((state) => ({
      messages: [
        ...state.messages,
        { role: 'assistant', text, ...(note ? { note } : {}) },
      ],
      answer: '',
      status: 'idle',
    }))
  }

  const receive = (id: number, tab: Tab | undefined, event: AssistantEvent) => {
    if (activeAskId !== id) return
    if (event.type === 'reading-schema') {
      markResultClosed(tab)
      set({ status: 'reading-schema' })
    } else if (event.type === 'schema') {
      const { relations, detailed } = event
      set({ status: 'waiting', schema: { relations, detailed } })
    } else {
      set((state) => ({
        status: 'answering',
        answer: state.answer + event.text,
      }))
    }
  }

  const ask = async (text: string, task: Task, tab: Tab | undefined) => {
    const id = nextAskId++
    activeAskId = id
    isStopRequested = false
    // A reset or a newer request makes this request old. An old request must not
    // change the state.
    const isCurrent = () => activeAskId === id
    const history = get().messages.map(({ role, text }) => ({ role, text }))
    const messages = [...history, { role: 'user' as const, text }]
    set((state) => ({
      messages: [...state.messages, { role: 'user', text }],
      answer: '',
      status: 'waiting',
      error: null,
    }))
    try {
      const sessionId = await openSession(tab)
      if (!isCurrent()) return
      if (isStopRequested) {
        fail('You stopped the request.', text, task)
        return
      }
      if (sessionId === null && tab?.connectionId) {
        fail(
          'The connection failed. The request needs the connection to read the schema.',
          text,
          task,
        )
        return
      }
      if (sessionId === null) set({ schema: null })
      const refreshSchema = get().refreshesSchema
      set({ refreshesSchema: false })
      const result = await commands.assistantAsk(
        {
          id,
          session_id: sessionId,
          task,
          messages,
          refresh_schema: refreshSchema,
        },
        new Channel<AssistantEvent>((event) => receive(id, tab, event)),
      )
      if (!isCurrent()) return
      if (result.status === 'error') {
        fail(result.error.message, text, task)
      } else if (result.data.status === 'failed') {
        fail(result.data.error.message, text, task)
      } else if (!result.data.text.trim()) {
        // Without answer text, the conversation cannot continue from this request.
        const isRefused =
          result.data.status === 'done' &&
          result.data.outcome.stop === 'refused'
        fail(isRefused ? NOTES.refused : 'You stopped the request.', text, task)
      } else if (result.data.status === 'cancelled') {
        // The result has the complete text. The text parts can arrive after it.
        complete(result.data.text, NOTES.stopped)
      } else {
        const { stop } = result.data.outcome
        complete(
          result.data.text,
          stop === 'complete' ? undefined : NOTES[stop],
        )
      }
    } catch (error) {
      if (isCurrent()) fail(toMessage(error), text, task)
    } finally {
      if (isCurrent()) activeAskId = null
    }
  }

  const readPlan = async (analyze: boolean, tab: Tab) => {
    set({ status: 'reading-plan', error: null })
    isStopRequested = false
    const stop = (error: string) => set({ status: 'idle', error })
    try {
      const target = activeEditor()?.getTarget() ?? { type: 'all' }
      const previews = await commands.queryPreview(tab.content, target)
      const first = previews[0]
      const last = previews[previews.length - 1]
      const statement = first
        ? tab.content.slice(first.range.from, last.range.to)
        : ''
      const sessionId = await openSession(tab)
      if (get().status !== 'reading-plan') return
      if (sessionId === null) {
        stop('The connection failed. The plan comes from the database.')
        return
      }
      if (isStopRequested) {
        stop('You stopped the plan read.')
        return
      }
      markResultClosed(tab)
      planSessionId = sessionId
      const result = await commands
        .assistantExplain(sessionId, statement, analyze)
        .finally(() => {
          planSessionId = null
        })
      if (get().status !== 'reading-plan') return
      if (result.status === 'error') {
        stop(result.error.message)
      } else if (result.data.status === 'rejected') {
        stop(result.data.message)
      } else if (result.data.status === 'failed') {
        const { kind, message } = result.data.error
        stop(
          kind === 'cancelled'
            ? 'You stopped the plan read.'
            : `The database did not make the plan: ${message}`,
        )
      } else {
        const { plan, is_truncated } = result.data
        await ask(
          planRequest(statement.trim(), plan, analyze, is_truncated),
          'plan',
          tab,
        )
      }
    } catch (error) {
      stop(toMessage(error))
    }
  }

  return {
    ...INITIAL,
    hasKey: null,

    loadStatus: async () => {
      try {
        const result = await commands.assistantStatus()
        if (result.status === 'ok') set({ hasKey: result.data.has_key })
        else set({ error: result.error.message })
      } catch (error) {
        set({ error: toMessage(error) })
      }
    },

    saveKey: async (key) => {
      try {
        const result = await commands.assistantKeySet(key)
        if (result.status === 'error') return result.error.message
        set({ hasKey: true, error: null })
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

    setDraft: (draft) => set({ draft }),

    send: async () => {
      const text = get().draft.trim()
      if (!text || get().status !== 'idle') return
      set({ draft: '' })
      await ask(text, 'sql', activeTab())
    },

    analyzePlan: async (analyze) => {
      if (get().status !== 'idle') return
      const tab = activeTab()
      const connection = connectionOf(tab)
      if (!tab || !connection) {
        set({
          error:
            'Select a connection for the tab. The plan comes from the database.',
        })
        return
      }
      if (getQueryStore(tab.id).getState().runState !== 'idle') {
        set({
          error: 'A statement of the tab is in progress. Wait for its end.',
        })
        return
      }
      const { guardrails } = usePreferencesStore.getState().preferences
      if (analyze && guardrails[connection.environment] === 'always') {
        set({
          error: null,
          pendingAnalyze: {
            tabId: tab.id,
            connectionName: connection.name,
            environment: connection.environment,
          },
        })
        return
      }
      await readPlan(analyze, tab)
    },

    confirmAnalyze: async () => {
      const { pendingAnalyze } = get()
      if (!pendingAnalyze) return
      set({ pendingAnalyze: null })
      // The confirmation is for the connection of this tab. A different tab can
      // be active now.
      const tab = useTabsStore
        .getState()
        .tabs.find((item) => item.id === pendingAnalyze.tabId)
      if (tab) await readPlan(true, tab)
    },

    cancelAnalyze: () => set({ pendingAnalyze: null }),

    stop: async () => {
      isStopRequested = true
      try {
        if (get().status === 'reading-plan') {
          if (planSessionId !== null) {
            await commands.queryCancel(planSessionId)
          }
        } else if (activeAskId !== null) {
          await commands.assistantCancel(activeAskId)
        }
      } catch (error) {
        set({ error: toMessage(error) })
      }
    },

    requestSchemaRefresh: () => set({ refreshesSchema: true }),

    clear: () => {
      if (get().status !== 'idle') return
      set((state) => ({ ...INITIAL, schema: state.schema }))
    },

    reset: () => {
      // The conversation is gone. The request must not continue in the backend.
      if (activeAskId !== null) {
        commands.assistantCancel(activeAskId).catch(() => {})
      }
      activeAskId = null
      planSessionId = null
      set(INITIAL)
    },
  }
})

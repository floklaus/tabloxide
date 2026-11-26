import { connectionLanguage } from '../engines/engineStore'
import { Channel } from '@tauri-apps/api/core'
import { createStore, type StoreApi } from 'zustand/vanilla'
import {
  commands,
  type ActionContext,
  type AssistantEvent,
  type Environment,
  type QueryLanguage_Serialize as QueryLanguage,
  type Role,
  type Task,
} from '../bindings'
import { activeEditor } from '../editor/editorBridge'
import { toMessage } from '../lib/errors'
import { usePreferencesStore } from '../preferences/preferencesStore'
import { getQueryStore } from '../query/queryStore'
import { sqlTabForTools, useTabsStore, type Tab } from '../tabs/tabsStore'
import { useWorkspaceStore } from '../workspace/workspaceStore'

export type AssistantMessage = {
  role: Role
  text: string
  /** The data of an AI action, for a message of the user. */
  context?: ActionContext
  /** What the request of this message sent, for example "Sent: your request." */
  sent?: string
  /** The text in the editor that a code block of the answer can replace. */
  replace?: ReplaceTarget
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

/** The task of the last request. A plan request reads the plan first. */
export type RequestTask = Task

/** Where the last request came from. The session view shows it as its context. */
export type SessionContext = {
  tabTitle: string
  connectionName: string | null
  environment: Environment | null
}

/** The end of the last request. */
export type RequestOutcome = 'running' | 'done' | 'failed' | 'stopped'

export type SessionState = {
  /** The title of the session. `null` until the first request. */
  title: string | null
  /** The time of the last change, in milliseconds since 1970. */
  updatedAt: number
  /** The task of the last request, or `null` before the first request. */
  lastTask: RequestTask | null
  /** The phases that the last request got to, in sequence. */
  phases: AssistantStatus[]
  outcome: RequestOutcome | null
  context: SessionContext | null
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

  setDraft: (draft: string) => void
  /** Sends the text of the request field. */
  send: () => Promise<void>
  /**
   * Sends the request of an AI action. Returns `false` if a request of the
   * session is in progress.
   */
  runAction: (action: ActionRequest) => Promise<boolean>
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
  title: null,
  updatedAt: Date.now(),
  lastTask: null,
  phases: [] as AssistantStatus[],
  outcome: null,
  context: null,
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

/** The request identifiers are unique for all sessions, because the backend cancels by identifier. */
let nextAskId = 1

/** The SQL tab of a request. An assistant tab uses the last SQL tab. */
function activeTab(): Tab | undefined {
  return sqlTabForTools()
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
  language: QueryLanguage = 'sql',
): string {
  const isMongo = language === 'mongodb-shell'
  const source = isMongo
    ? isAnalyzed
      ? 'Plan from explain("executionStats") (measured times):'
      : 'Plan from explain("queryPlanner") (estimates only):'
    : isAnalyzed
      ? 'Plan from EXPLAIN ANALYZE (measured times):'
      : 'Plan from EXPLAIN (estimates only):'
  const lines = [
    'Analyze the execution plan of this statement. Suggest improvements.',
    '',
    'Statement:',
    isMongo ? '```mongodb' : language === 'sql' ? '```sql' : '```text',
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

const WITH_SCHEMA: AssistantStatus[] = [
  'reading-schema',
  'waiting',
  'answering',
]
const WITHOUT_SCHEMA: AssistantStatus[] = ['waiting', 'answering']

/** The phases of a request of each task, in sequence. A Git task reads no schema. */
export const PHASES: Record<RequestTask, AssistantStatus[]> = {
  plan: ['reading-plan', ...WITH_SCHEMA],
  sql: WITH_SCHEMA,
  'query-error': WITH_SCHEMA,
  'change-selection': WITH_SCHEMA,
  'explain-selection': WITH_SCHEMA,
  'explain-table': WITH_SCHEMA,
  'starter-query': WITH_SCHEMA,
  rows: WITH_SCHEMA,
  'commit-message': WITHOUT_SCHEMA,
  'explain-diff': WITHOUT_SCHEMA,
  conflict: WITHOUT_SCHEMA,
  'git-output': WITHOUT_SCHEMA,
}

/** `true` if a request of the task sends the structure of the database. */
export function usesSchema(task: RequestTask): boolean {
  return PHASES[task].includes('reading-schema')
}

/**
 * A text of a tab that a code block of the answer can replace, for example the
 * statement that failed. The replace is possible only while all text of the tab
 * is the same as `document`. A change at a different place can move the range.
 */
export type ReplaceTarget = {
  tabId: string
  tabTitle: string
  from: number
  to: number
  /** All text of the tab, for which `from` and `to` are correct. */
  document: string
}

/** A request of an AI action, for example "Explain and fix" of a query error. */
export type ActionRequest = {
  task: RequestTask
  /** The request text. The panel shows it as the message of the user. */
  text: string
  context?: ActionContext
  /** The text that the answer can replace. It does not go to the AI service. */
  replace?: ReplaceTarget
}

const MAX_TITLE = 48

function titleOf(
  text: string,
  task: RequestTask,
  tab: Tab | undefined,
): string {
  if (task === 'plan') return `Plan analysis of ${tab?.title ?? 'a statement'}`
  const line = text.trim().split('\n')[0]
  return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1)}…` : line
}

function contextOf(tab: Tab | undefined): SessionContext | null {
  if (!tab) return null
  const connection = connectionOf(tab)
  return {
    tabTitle: tab.title,
    connectionName: connection?.name ?? null,
    environment: connection?.environment ?? null,
  }
}

export type SessionStore = StoreApi<SessionState>

/** Makes the store of one conversation with the AI assistant. */
export function createSession(): SessionStore {
  /** The identifier of the request that is in progress. */
  let activeAskId: number | null = null
  /** `true` after the user stopped the request that is in progress. */
  let isStopRequested = false
  /** The database session that reads a plan now. A stop cancels its statement. */
  let planSessionId: number | null = null

  return createStore<SessionState>((rawSet, get) => {
    /** Changes the state. A change of the status adds the phase of the request. */
    type Patch = Partial<SessionState>
    const set = (partial: Patch | ((state: SessionState) => Patch)) => {
      rawSet((state) => {
        const patch = typeof partial === 'function' ? partial(state) : partial
        const status = patch.status
        const before = patch.phases ?? state.phases
        const phases =
          status && status !== 'idle' && !before.includes(status)
            ? [...before, status]
            : before
        return { ...patch, phases, updatedAt: Date.now() }
      })
    }
    /** Removes the last request from the conversation and shows `error`. */
    const fail = (error: string, text: string, task: Task) => {
      set((state) => ({
        messages: state.messages.slice(0, -1),
        answer: '',
        status: 'idle',
        error,
        outcome: isStopRequested ? 'stopped' : 'failed',
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
        outcome: note === NOTES.stopped ? 'stopped' : 'done',
      }))
    }

    const receive = (
      id: number,
      tab: Tab | undefined,
      event: AssistantEvent,
    ) => {
      if (activeAskId !== id) return
      if (event.type === 'reading-schema') {
        markResultClosed(tab)
        set({ status: 'reading-schema' })
      } else if (event.type === 'schema') {
        const { relations, detailed } = event
        set({ status: 'waiting', schema: { relations, detailed } })
      } else if (event.type === 'sent') {
        // The line belongs to the request: the last message of the user.
        set((state) => ({
          messages: state.messages.map((message, index) =>
            index === state.messages.length - 1 && message.role === 'user'
              ? { ...message, sent: event.summary }
              : message,
          ),
        }))
      } else {
        set((state) => ({
          status: 'answering',
          answer: state.answer + event.text,
        }))
      }
    }

    const ask = async (
      text: string,
      task: Task,
      tab: Tab | undefined,
      context?: ActionContext,
      replace?: ReplaceTarget,
    ) => {
      const id = nextAskId++
      activeAskId = id
      isStopRequested = false
      // A reset or a newer request makes this request old. An old request must not
      // change the state.
      const isCurrent = () => activeAskId === id
      // Each message keeps the data of its action, so that a later request of the
      // session still has it.
      const history = get().messages.map(({ role, text, context }) => ({
        role,
        text,
        context: context ?? null,
      }))
      const messages = [
        ...history,
        { role: 'user' as const, text, context: context ?? null },
      ]
      set((state) => ({
        messages: [
          ...state.messages,
          {
            role: 'user',
            text,
            ...(context ? { context } : {}),
            ...(replace ? { replace } : {}),
          },
        ],
        answer: '',
        status: 'waiting',
        error: null,
        title: state.title ?? titleOf(text, task, tab),
        context: contextOf(tab),
        // A plan request started its phases with the plan read.
        ...(task === 'plan'
          ? {}
          : { phases: [], lastTask: task, outcome: 'running' }),
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
          fail(
            isRefused ? NOTES.refused : 'You stopped the request.',
            text,
            task,
          )
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
      rawSet((state) => ({
        phases: [],
        lastTask: 'plan',
        outcome: 'running',
        title: state.title ?? titleOf('', 'plan', tab),
        context: contextOf(tab),
      }))
      set({ status: 'reading-plan', error: null })
      isStopRequested = false
      const stop = (error: string) =>
        set({
          status: 'idle',
          error,
          outcome: isStopRequested ? 'stopped' : 'failed',
        })
      try {
        const target = activeEditor()?.getTarget() ?? { type: 'all' }
        const previews = await commands.queryPreview(
          tab.content,
          target,
          connectionLanguage(tab.connectionId),
        )
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
            planRequest(
              statement.trim(),
              plan,
              analyze,
              is_truncated,
              connectionLanguage(tab.connectionId),
            ),
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

      setDraft: (draft) => set({ draft }),

      send: async () => {
        const text = get().draft.trim()
        if (!text || get().status !== 'idle') return
        set({ draft: '' })
        await ask(text, 'sql', activeTab())
      },

      runAction: async ({ task, text, context, replace }) => {
        if (get().status !== 'idle') return false
        // A Git task needs no database. Thus it does not connect the tab.
        const tab = usesSchema(task) ? activeTab() : undefined
        await ask(text, task, tab, context, replace)
        return true
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
        rawSet((state) => ({
          ...INITIAL,
          updatedAt: Date.now(),
          schema: state.schema,
        }))
      },

      reset: () => {
        // The conversation is gone. The request must not continue in the backend.
        if (activeAskId !== null) {
          commands.assistantCancel(activeAskId).catch(() => {})
        }
        activeAskId = null
        planSessionId = null
        rawSet({ ...INITIAL, updatedAt: Date.now() })
      },
    }
  })
}

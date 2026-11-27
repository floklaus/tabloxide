import { create } from 'zustand'
import {
  commands,
  type Engine,
  type Environment,
  type Plan_Serialize,
} from '../bindings'
import { toMessage } from '../lib/errors'
import { getQueryStore } from '../query/queryStore'
import { useResultsViewStore } from '../results/resultsViewStore'
import { sqlTabForTools } from '../tabs/tabsStore'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { fromCommon, parsePlan, type Plan } from './planModel'
import { targetStatement } from './planTarget'

/** A plan read with a measure, before the confirmation of the user. */
export type PendingMeasure = {
  statement: string
  connectionId: string
  connectionName: string
  environment: Environment
}

export type PlanState = {
  status: 'idle' | 'reading' | 'done' | 'failed'
  /**
   * The steps of the plan, or `null` if the engine gives only the original text.
   */
  plan: Plan | null
  /** The plan as the engine gives it, for example a JSON document. */
  text: string | null
  /** `true` if the database ran the statement and measured it. */
  isMeasured: boolean
  /** The statement that the database explained. */
  statement: string | null
  error: string | null
  /** The measured plan read that waits for the confirmation of the user. */
  pending: PendingMeasure | null
  /**
   * The connections for which the user said "Do not ask again". The list is for
   * the time that the application is open.
   */
  skipsConfirm: string[]
  /**
   * Reads the plan of the statement at the cursor, or of the selection. With
   * `measure`, the user must confirm first, because the database runs the statement.
   */
  request: (measure: boolean) => Promise<void>
  /** Reads the plan of `statement` again, with the same mode. */
  again: () => Promise<void>
  confirm: (skipsNextTime: boolean) => void
  cancel: () => void
  reset: () => void
}

const INITIAL = {
  status: 'idle' as const,
  plan: null,
  text: null,
  isMeasured: false,
  statement: null,
  error: null,
}

function activeConnection() {
  const tab = sqlTabForTools()
  const connection = useWorkspaceStore
    .getState()
    .workspace?.connections.find((item) => item.id === tab?.connectionId)
  return { tab, connection }
}

/** The engines whose JSON plan the view reads, until their adapters give the steps. */
const JSON_ENGINES: Engine[] = ['postgres', 'duckdb']

/**
 * The steps of a plan. The common form of the engine comes first. Without it, the
 * view reads the JSON of PostgreSQL and DuckDB. For other engines, or for JSON that
 * the view cannot read, the result is `null`, and the view shows the original text.
 */
function stepsOf(
  engine: Engine,
  plan: Plan_Serialize | null,
  text: string,
): Plan | null {
  if (plan) return fromCommon(engine, plan)
  if (!JSON_ENGINES.includes(engine)) return null
  try {
    return parsePlan(engine, text)
  } catch {
    return null
  }
}

export const usePlanStore = create<PlanState>((set, get) => {
  /** Reads the plan of `statement`. The caller did the confirmation. */
  const read = async (statement: string, measure: boolean) => {
    if (get().status === 'reading') return
    const { tab, connection } = activeConnection()
    useResultsViewStore.getState().setView('plan')
    if (!tab || !connection) {
      set({ ...INITIAL, status: 'failed', error: 'Select a connection first.' })
      return
    }
    const engine: Engine = connection.engine ?? 'postgres'
    set({ ...INITIAL, status: 'reading', statement })
    try {
      const query = getQueryStore(tab.id)
      if (!query.getState().session)
        await query.getState().connect(connection.id)
      const session = query.getState().session
      if (!session) {
        set({ status: 'failed', error: 'The connection failed.' })
        return
      }
      // The plan read uses the session of the tab and closes its open result.
      if (query.getState().open)
        query.setState({ open: null, stopReason: 'plan' })
      const result = await commands.planRead(session.id, statement, measure)
      if (result.status === 'error') {
        set({ status: 'failed', error: result.error.message })
      } else if (result.data.status === 'rejected') {
        set({ status: 'failed', error: result.data.message })
      } else if (result.data.status === 'failed') {
        set({ status: 'failed', error: result.data.error.message })
      } else {
        const { plan, text, is_analyzed } = result.data
        set({
          status: 'done',
          plan: stepsOf(engine, plan, text),
          text,
          isMeasured: is_analyzed,
          statement,
        })
      }
    } catch (error) {
      set({ status: 'failed', error: toMessage(error) })
    }
  }

  /** Asks first if the plan read runs the statement. */
  const start = (statement: string, measure: boolean) => {
    const { connection } = activeConnection()
    const asks =
      measure &&
      connection !== undefined &&
      (connection.environment === 'production' ||
        !get().skipsConfirm.includes(connection.id))
    if (!asks || !connection) return read(statement, measure)
    set({
      pending: {
        statement,
        connectionId: connection.id,
        connectionName: connection.name,
        environment: connection.environment,
      },
    })
    return Promise.resolve()
  }

  return {
    ...INITIAL,
    pending: null,
    skipsConfirm: [],

    request: async (measure) => {
      if (get().status === 'reading') return
      const { tab } = activeConnection()
      let statement = ''
      try {
        statement = tab ? await targetStatement(tab.content) : ''
      } catch (error) {
        useResultsViewStore.getState().setView('plan')
        set({ ...INITIAL, status: 'failed', error: toMessage(error) })
        return
      }
      await start(statement, measure)
    },

    again: async () => {
      const { statement } = get()
      if (statement === null) return
      await start(statement, get().isMeasured)
    },

    confirm: (skipsNextTime) => {
      const { pending, skipsConfirm } = get()
      if (!pending) return
      const skips =
        skipsNextTime &&
        pending.environment !== 'production' &&
        !skipsConfirm.includes(pending.connectionId)
      set({
        pending: null,
        skipsConfirm: skips
          ? [...skipsConfirm, pending.connectionId]
          : skipsConfirm,
      })
      void read(pending.statement, true)
    },

    cancel: () => set({ pending: null }),

    reset: () => set({ ...INITIAL, pending: null }),
  }
})

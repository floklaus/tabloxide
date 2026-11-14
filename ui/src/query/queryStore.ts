import { save } from '@tauri-apps/plugin-dialog'
import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import {
  commands,
  type CommandError,
  type ConnectError,
  type QueryError_Serialize,
  type RunTarget,
  type StatementReport_Serialize,
} from '../bindings'
import { toMessage } from '../lib/errors'
import { useTabsStore } from '../tabs/tabsStore'

export type StatementReport = StatementReport_Serialize
export type QueryError = QueryError_Serialize

/** The grid stops the fetch at this number of rows. The rows are in the memory of the UI. */
export const MAX_LOADED_ROWS = 100_000

export type Session = { id: number; connectionId: string; version: string }

export type ConnectState =
  | { status: 'idle' }
  | { status: 'connecting' }
  | { status: 'failed'; error: ConnectError }

export type RunState = 'idle' | 'running' | 'cancelling'

/** Why the application stopped the fetch of a result before its end. */
export type StopReason = 'user' | 'row-limit' | 'export'

type OpenResult = { resultId: number; index: number }

type QueryState = {
  session: Session | null
  connectState: ConnectState
  /** The script text of the last run. The statement ranges refer to this text. */
  ranSql: string
  runState: RunState
  statements: StatementReport[]
  /** Index of the statement that the results pane shows. */
  selected: number
  /** The result that has more rows on the server. */
  open: OpenResult | null
  isFetching: boolean
  fetchError: QueryError | null
  stopReason: StopReason | null
  isExporting: boolean
  /** A message for the user about a command or an export. */
  notice: string | null
  /** A request to move the cursor of the SQL input to this offset. */
  jumpTo: number | null

  connect: (connectionId: string) => Promise<void>
  disconnect: () => Promise<void>
  /**
   * Runs `sql`. Without a session, the run first connects to `connectionId`.
   */
  run: (
    sql: string,
    target: RunTarget,
    connectionId?: string | null,
  ) => Promise<void>
  cancel: () => Promise<void>
  select: (index: number) => void
  fetchMore: () => Promise<void>
  stopFetch: (reason?: StopReason) => Promise<void>
  exportCsv: (index: number) => Promise<void>
  setNotice: (notice: string | null) => void
  setJumpTo: (offset: number | null) => void
  reset: () => void
}

const NO_RESULTS = {
  ranSql: '',
  runState: 'idle' as RunState,
  statements: [] as StatementReport[],
  selected: 0,
  open: null,
  isFetching: false,
  fetchError: null,
  stopReason: null,
}

const INITIAL = {
  ...NO_RESULTS,
  session: null,
  connectState: { status: 'idle' } as ConnectState,
  isExporting: false,
  notice: null,
  jumpTo: null,
}

function connectFailure(detail: string): ConnectState {
  return { status: 'failed', error: { kind: 'other', advice: '', detail } }
}

/** Returns a copy of the statements with more rows in the statement `index`. */
function withMoreRows(
  statements: StatementReport[],
  index: number,
  rows: (string | null)[][],
  isComplete: boolean,
  totalRows: number | null,
): StatementReport[] {
  return statements.map((statement, i) => {
    if (i !== index || statement.outcome.type !== 'rows') return statement
    const outcome = {
      ...statement.outcome,
      rows: [...statement.outcome.rows, ...rows],
      is_complete: isComplete,
      total_rows: totalRows,
    }
    return { ...statement, outcome }
  })
}

function loadedRows(statements: StatementReport[], index: number): number {
  const outcome = statements[index]?.outcome
  return outcome?.type === 'rows' ? outcome.rows.length : 0
}

export type QueryStore = StoreApi<QueryState>

/** Makes the query state of one editor tab. Each tab has its own database session. */
export const createQueryStore = (): QueryStore =>
  createStore<QueryState>((set, get) => {
    /** Shows a command error. A session that the backend does not know is closed. */
    const showCommandError = (error: CommandError) => {
      const lost = error.kind === 'no-session'
      set({
        notice: error.message,
        ...(lost ? { session: null, ...NO_RESULTS } : {}),
      })
    }

    return {
      ...INITIAL,

      connect: async (connectionId) => {
        if (get().connectState.status === 'connecting') return
        await get().disconnect()
        set({ connectState: { status: 'connecting' } })
        try {
          const result = await commands.sessionOpen(connectionId)
          if (result.status === 'error') {
            set({ connectState: connectFailure(result.error.message) })
          } else if (result.data.status === 'failed') {
            set({
              connectState: { status: 'failed', error: result.data.error },
            })
          } else {
            const { id, server } = result.data.session
            set({
              session: { id, connectionId, version: server.version },
              connectState: { status: 'idle' },
            })
          }
        } catch (error) {
          set({ connectState: connectFailure(toMessage(error)) })
        }
      },

      disconnect: async () => {
        const { session } = get()
        if (!session) return
        set({ session: null, ...NO_RESULTS })
        try {
          await commands.sessionClose(session.id)
        } catch (error) {
          set({ notice: toMessage(error) })
        }
      },

      run: async (sql, target, connectionId = null) => {
        if (get().runState !== 'idle') return
        if (!get().session && connectionId) await get().connect(connectionId)
        const { session } = get()
        if (!session) return
        set({ ...NO_RESULTS, ranSql: sql, runState: 'running', notice: null })
        try {
          const result = await commands.queryRun(session.id, sql, target)
          if (result.status === 'error') {
            set({ runState: 'idle' })
            showCommandError(result.error)
            return
          }
          const { statements, open_result } = result.data
          const last = Math.max(statements.length - 1, 0)
          set({
            runState: 'idle',
            statements,
            selected: last,
            open:
              open_result === null
                ? null
                : { resultId: open_result, index: last },
            notice:
              statements.length === 0 ? 'There is no statement to run.' : null,
          })
        } catch (error) {
          set({ runState: 'idle', notice: toMessage(error) })
        }
      },

      cancel: async () => {
        const { session, runState } = get()
        if (!session || runState !== 'running') return
        set({ runState: 'cancelling' })
        try {
          const result = await commands.queryCancel(session.id)
          if (result.status === 'error') showCommandError(result.error)
        } catch (error) {
          set({ notice: toMessage(error) })
        }
      },

      select: (index) => set({ selected: index }),

      fetchMore: async () => {
        const { session, open, isFetching, statements } = get()
        if (!session || !open || isFetching) return
        if (loadedRows(statements, open.index) >= MAX_LOADED_ROWS) {
          await get().stopFetch('row-limit')
          return
        }
        set({ isFetching: true })
        try {
          const result = await commands.resultFetch(session.id, open.resultId)
          // A new run or a stop can replace the result while the fetch is in progress.
          if (get().open?.resultId !== open.resultId) return
          if (result.status === 'error') {
            set({ open: null })
            showCommandError(result.error)
          } else if (result.data === null) {
            set({ open: null, stopReason: get().stopReason ?? 'user' })
          } else {
            const page = result.data
            set({
              statements: withMoreRows(
                get().statements,
                open.index,
                page.rows,
                page.is_complete,
                page.total_rows,
              ),
              open: page.is_complete || page.error ? null : open,
              fetchError: page.error,
            })
          }
        } catch (error) {
          set({ open: null, notice: toMessage(error) })
        } finally {
          set({ isFetching: false })
        }
      },

      stopFetch: async (reason = 'user') => {
        const { session, open } = get()
        if (!session || !open) return
        set({ open: null, stopReason: reason })
        try {
          const result = await commands.resultClose(session.id, open.resultId)
          if (result.status === 'error') showCommandError(result.error)
        } catch (error) {
          set({ notice: toMessage(error) })
        }
      },

      exportCsv: async (index) => {
        const { session, statements, ranSql, isExporting } = get()
        const statement = statements[index]
        if (!session || !statement || isExporting) return
        try {
          const path = await save({
            defaultPath: 'result.csv',
            filters: [{ name: 'CSV', extensions: ['csv'] }],
          })
          if (!path) return
          // The export runs the statement again. The backend closes the open result first.
          set({
            isExporting: true,
            notice: null,
            ...(get().open
              ? { open: null, stopReason: 'export' as const }
              : {}),
          })
          const text = ranSql.slice(statement.range.from, statement.range.to)
          const result = await commands.resultExportCsv(session.id, text, path)
          if (result.status === 'error') {
            showCommandError(result.error)
          } else if (result.data.status === 'failed') {
            set({ notice: `The export failed: ${result.data.error.message}` })
          } else {
            set({ notice: `Exported ${result.data.rows} rows to ${path}.` })
          }
        } catch (error) {
          set({ notice: toMessage(error) })
        } finally {
          set({ isExporting: false })
        }
      },

      setNotice: (notice) => set({ notice }),
      setJumpTo: (jumpTo) => set({ jumpTo }),
      reset: () => set(INITIAL),
    }
  })

const stores = new Map<string, QueryStore>()

/** Returns the query state of the tab `tabId`. The first call makes it. */
export function getQueryStore(tabId: string): QueryStore {
  let store = stores.get(tabId)
  if (!store) {
    store = createQueryStore()
    stores.set(tabId, store)
  }
  return store
}

/** Closes the database session of a tab and removes its query state. */
export function disposeQueryStore(tabId: string): void {
  const store = stores.get(tabId)
  stores.delete(tabId)
  void store?.getState().disconnect()
}

/** Removes the query state of all tabs. The backend closes the sessions with the workspace. */
export function resetQueryStores(): void {
  stores.clear()
}

const NO_TAB = ''

/** Returns the query state of the active tab. */
export function activeQueryStore(): QueryStore {
  return getQueryStore(useTabsStore.getState().activeId ?? NO_TAB)
}

/** Reads the query state of the active tab. */
export function useQuery<T>(selector: (state: QueryState) => T): T {
  const tabId = useTabsStore((state) => state.activeId) ?? NO_TAB
  return useStore(getQueryStore(tabId), selector)
}

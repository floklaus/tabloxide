import { save } from '@tauri-apps/plugin-dialog'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import {
  createQueryStore,
  MAX_LOADED_ROWS,
  type StatementReport,
} from './queryStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }))

const sessionOpen = vi.mocked(commands.sessionOpen)
const queryRun = vi.mocked(commands.queryRun)
const resultFetch = vi.mocked(commands.resultFetch)
const resultClose = vi.mocked(commands.resultClose)
const resultExportCsv = vi.mocked(commands.resultExportCsv)
let store = createQueryStore()

function rowsStatement(rows: string[][], isComplete: boolean): StatementReport {
  return {
    range: { from: 0, to: 8 },
    elapsed_ms: 3,
    outcome: {
      type: 'rows',
      columns: [{ name: 'n', type_name: 'int4', kind: 'number' }],
      rows,
      is_complete: isComplete,
      total_rows: isComplete ? rows.length : null,
    },
  }
}

function ok<T>(data: T) {
  return { status: 'ok' as const, data }
}

async function connectAndRun(openResult: number | null) {
  store.setState({
    session: { id: 7, connectionId: 'id-1', version: '17.0' },
  })
  queryRun.mockResolvedValue(
    ok({
      statements: [rowsStatement([['1']], openResult === null)],
      open_result: openResult,
    }),
  )
  await store.getState().run('select 1', { type: 'all' })
}

function loadedRows(): number {
  const { outcome } = store.getState().statements[0]
  return outcome.type === 'rows' ? outcome.rows.length : -1
}

describe('queryStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store = createQueryStore()
  })

  test('stores the session after a successful connect', async () => {
    sessionOpen.mockResolvedValue(
      ok({
        status: 'connected',
        session: {
          id: 7,
          connection_id: 'id-1',
          database: 'app',
          server: { version: '17.0' },
        },
      }),
    )

    await store.getState().connect('id-1')

    expect(store.getState().session).toEqual({
      id: 7,
      connectionId: 'id-1',
      version: '17.0',
    })
  })

  test('keeps the failure when the connect fails', async () => {
    const error = { kind: 'authentication', advice: 'Check.', detail: 'no' }
    sessionOpen.mockResolvedValue(ok({ status: 'failed', error } as never))

    await store.getState().connect('id-1')

    expect(store.getState().session).toBeNull()
    expect(store.getState().connectState).toEqual({ status: 'failed', error })
  })

  test('does not run without a session', async () => {
    await store.getState().run('select 1', { type: 'all' })

    expect(queryRun).not.toHaveBeenCalled()
  })

  test('connects before the run when the tab has a connection', async () => {
    sessionOpen.mockResolvedValue(
      ok({
        status: 'connected',
        session: {
          id: 9,
          connection_id: 'id-1',
          database: 'app',
          server: { version: '17.0' },
        },
      }),
    )
    queryRun.mockResolvedValue(ok({ statements: [], open_result: null }))

    await store.getState().run('select 1', { type: 'all' }, 'id-1')

    expect(sessionOpen).toHaveBeenCalledWith('id-1')
    expect(queryRun).toHaveBeenCalledWith(9, 'select 1', { type: 'all' })
  })

  test('does not run when the connect before the run fails', async () => {
    const error = { kind: 'unreachable', advice: 'Check.', detail: 'no' }
    sessionOpen.mockResolvedValue(ok({ status: 'failed', error } as never))

    await store.getState().run('select 1', { type: 'all' }, 'id-1')

    expect(queryRun).not.toHaveBeenCalled()
    expect(store.getState().connectState.status).toBe('failed')
  })

  test('stores the report and the open result of a run', async () => {
    await connectAndRun(4)

    expect(queryRun).toHaveBeenCalledWith(7, 'select 1', { type: 'all' })
    expect(store.getState().open).toEqual({ resultId: 4, index: 0 })
    expect(store.getState().runState).toBe('idle')
    expect(store.getState().ranSql).toBe('select 1')
  })

  test('closes the session in the UI when the backend does not know it', async () => {
    store.setState({ session: { id: 7, connectionId: 'id-1', version: '17' } })
    queryRun.mockResolvedValue({
      status: 'error',
      error: { kind: 'no-session', message: 'Connect again.', issues: [] },
    })

    await store.getState().run('select 1', { type: 'all' })

    expect(store.getState().session).toBeNull()
    expect(store.getState().notice).toBe('Connect again.')
  })

  test('adds the fetched rows and closes a complete result', async () => {
    await connectAndRun(4)
    resultFetch.mockResolvedValue(
      ok({
        rows: [['2'], ['3']],
        is_complete: true,
        total_rows: 3,
        error: null,
        elapsed_ms: 40,
      }),
    )

    await store.getState().fetchMore()

    expect(resultFetch).toHaveBeenCalledWith(7, 4)
    expect(loadedRows()).toBe(3)
    // The time of the statement is the time of the run and of the fetch.
    expect(store.getState().statements[0].elapsed_ms).toBe(43)
    expect(store.getState().open).toBeNull()
    expect(store.getState().statements[0].outcome).toMatchObject({
      is_complete: true,
      total_rows: 3,
    })
  })

  test('keeps the fetch error and closes the result', async () => {
    await connectAndRun(4)
    const error = {
      kind: 'cancelled' as const,
      message: 'cancelled',
      detail: null,
      hint: null,
      code: '57014',
      position: null,
    }
    resultFetch.mockResolvedValue(
      ok({
        rows: [],
        is_complete: false,
        total_rows: null,
        error,
        elapsed_ms: 1,
      }),
    )

    await store.getState().fetchMore()

    expect(store.getState().fetchError).toEqual(error)
    expect(store.getState().open).toBeNull()
  })

  test('drops the session after a lost connection, so that the next run connects again', async () => {
    store.setState({ session: { id: 7, connectionId: 'id-1', version: '17' } })
    const lost = {
      range: { from: 0, to: 8 },
      elapsed_ms: 1,
      outcome: {
        type: 'failed' as const,
        error: {
          kind: 'connection-lost' as const,
          message: 'The connection to the server closed.',
          detail: null,
          hint: null,
          code: null,
          position: null,
        },
        location: null,
      },
    }
    queryRun.mockResolvedValue(ok({ statements: [lost], open_result: null }))

    await store.getState().run('select 1', { type: 'all' }, 'id-1')

    expect(store.getState().session).toBeNull()
    expect(store.getState().notice).toContain('The next run connects again')
    expect(commands.sessionClose).toHaveBeenCalledWith(7)
    expect(store.getState().statements).toHaveLength(1)

    sessionOpen.mockResolvedValue(
      ok({
        status: 'connected',
        session: {
          id: 8,
          connection_id: 'id-1',
          database: 'app',
          server: { version: '17' },
        },
      }),
    )
    queryRun.mockResolvedValue(ok({ statements: [], open_result: null }))
    await store.getState().run('select 1', { type: 'all' }, 'id-1')

    expect(queryRun).toHaveBeenLastCalledWith(8, 'select 1', { type: 'all' })
  })

  test('does not fetch when no result is open', async () => {
    await connectAndRun(null)

    await store.getState().fetchMore()

    expect(resultFetch).not.toHaveBeenCalled()
  })

  test('stops the fetch at the row limit', async () => {
    await connectAndRun(4)
    const many = Array.from({ length: MAX_LOADED_ROWS }, () => ['1'])
    store.setState({ statements: [rowsStatement(many, false)] })

    await store.getState().fetchMore()

    expect(resultFetch).not.toHaveBeenCalled()
    expect(resultClose).toHaveBeenCalledWith(7, 4)
    expect(store.getState().stopReason).toBe('row-limit')
    expect(store.getState().open).toBeNull()
  })

  test('ignores a fetch result that arrives after a stop', async () => {
    await connectAndRun(4)
    let resolve: (value: never) => void = () => {}
    resultFetch.mockReturnValue(new Promise((r) => (resolve = r)))

    const fetch = store.getState().fetchMore()
    await store.getState().stopFetch()
    resolve(
      ok({
        rows: [['2']],
        is_complete: false,
        total_rows: null,
        error: null,
      }) as never,
    )
    await fetch

    expect(loadedRows()).toBe(1)
    expect(store.getState().isFetching).toBe(false)
  })

  test('exports the statement text of the last run', async () => {
    await connectAndRun(4)
    vi.mocked(save).mockResolvedValue('/tmp/out.csv')
    resultExportCsv.mockResolvedValue(ok({ status: 'exported', rows: 12 }))

    await store.getState().exportCsv(0)

    expect(resultExportCsv).toHaveBeenCalledWith(7, 'select 1', '/tmp/out.csv')
    expect(store.getState().notice).toBe('Exported 12 rows to /tmp/out.csv.')
    expect(store.getState().stopReason).toBe('export')
    expect(store.getState().open).toBeNull()
  })

  test('does not export when the user closes the file dialog', async () => {
    await connectAndRun(4)
    vi.mocked(save).mockResolvedValue(null)

    await store.getState().exportCsv(0)

    expect(resultExportCsv).not.toHaveBeenCalled()
    expect(store.getState().open).not.toBeNull()
  })
})

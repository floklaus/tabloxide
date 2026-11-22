import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import {
  getCatalog,
  getColumns,
  invalidateCatalog,
  MAX_SCHEMAS,
  resetCatalogs,
  RETRY_AFTER_MS,
} from './catalogCache'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)

const sessionOpen = vi.mocked(commands.sessionOpen)
const sessionClose = vi.mocked(commands.sessionClose)
const schemaList = vi.mocked(commands.schemaList)
const schemaRelations = vi.mocked(commands.schemaRelations)
const schemaRelationDetail = vi.mocked(commands.schemaRelationDetail)

function connected(id: number) {
  return {
    status: 'ok' as const,
    data: {
      status: 'connected' as const,
      session: {
        id,
        connection_id: 'c1',
        database: 'app',
        server: { version: '17' },
      },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionOpen.mockResolvedValue(connected(7))
  schemaList.mockResolvedValue({
    status: 'ok',
    data: [
      { name: 'public', is_system: false },
      { name: 'pg_catalog', is_system: true },
    ],
  })
  schemaRelations.mockResolvedValue({
    status: 'ok',
    data: [{ name: 'item', kind: 'table' }],
  })
  schemaRelationDetail.mockResolvedValue({
    status: 'ok',
    data: {
      columns: [
        {
          name: 'id',
          data_type: 'integer',
          is_nullable: false,
          default: null,
          is_primary_key: true,
        },
      ],
      indexes: [],
      constraints: [],
    },
  })
})

afterEach(() => {
  resetCatalogs()
  vi.useRealTimers()
})

describe('catalogCache', () => {
  test('reads the tables of the user schemas one time with its own session', async () => {
    const [first, second] = await Promise.all([
      getCatalog('c1'),
      getCatalog('c1'),
    ])

    expect(first).toEqual({
      schemas: [
        { name: 'public', is_system: false },
        { name: 'pg_catalog', is_system: true },
      ],
      relations: { public: [{ name: 'item', kind: 'table' }] },
    })
    expect(second).toBe(first)
    expect(sessionOpen).toHaveBeenCalledOnce()
    expect(sessionOpen).toHaveBeenCalledWith('c1')
    // The cache does not read the tables of a system schema.
    expect(schemaRelations).toHaveBeenCalledExactlyOnceWith(7, 'public')
  })

  test('reads the columns of a table only one time', async () => {
    const first = await getColumns('c1', 'public', 'item')
    await getColumns('c1', 'public', 'item')

    expect(first.map((column) => column.name)).toEqual(['id'])
    expect(schemaRelationDetail).toHaveBeenCalledExactlyOnceWith(
      7,
      'public',
      'item',
    )
  })

  test('reads the tables of a limited number of schemas', async () => {
    schemaList.mockResolvedValue({
      status: 'ok',
      data: Array.from({ length: MAX_SCHEMAS + 5 }, (_, index) => ({
        name: `s${index}`,
        is_system: false,
      })),
    })

    await getCatalog('c1')

    expect(schemaRelations).toHaveBeenCalledTimes(MAX_SCHEMAS)
  })

  test('closes the session and reads again after an invalidation', async () => {
    await getCatalog('c1')
    sessionOpen.mockResolvedValue(connected(8))

    invalidateCatalog('c1')
    await getCatalog('c1')

    await vi.waitFor(() => expect(sessionClose).toHaveBeenCalledWith(7))
    expect(sessionOpen).toHaveBeenCalledTimes(2)
    expect(schemaList).toHaveBeenLastCalledWith(8)
  })

  test('gives no catalog when the connection fails, and tries again later', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    sessionOpen.mockResolvedValueOnce({
      status: 'ok',
      data: {
        status: 'failed',
        error: { kind: 'authentication', advice: 'Check.', detail: 'no' },
      },
    })

    expect(await getCatalog('c1')).toBeNull()
    expect(await getCatalog('c1')).toBeNull()
    expect(sessionOpen).toHaveBeenCalledOnce()
    expect(await getColumns('c1', 'public', 'item')).toEqual([])

    vi.setSystemTime(Date.now() + RETRY_AFTER_MS + 1)
    expect(await getCatalog('c1')).not.toBeNull()
    expect(sessionOpen).toHaveBeenCalledTimes(2)
  })
})

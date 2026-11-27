import type { HistoryEntry_Serialize } from '../../src/bindings'
import { ARCHIVE_ID, FILES, LIVE_ID, LOCAL_ID, STAGING_ID } from './workspace'

/** The query history of the workspace over three days. */

const NAMES: Record<string, string> = {
  [LOCAL_ID]: 'Local shop',
  [STAGING_ID]: 'Staging shop',
  [LIVE_ID]: 'Live shop',
  [ARCHIVE_ID]: 'Orders archive',
}

type Run = [
  time: string,
  connection: string,
  sql: string,
  elapsedMs: number,
  rows: number | null,
  error?: string,
]

const body = (path: string) =>
  FILES[path]
    .split('\n')
    .filter((line) => !line.startsWith('--') && !line.startsWith('//'))
    .join('\n')
    .trim()

const RUNS: Run[] = [
  ['2026-11-26T14:12:08+01:00', LOCAL_ID, body('queries/items.sql'), 38, 15],
  [
    '2026-11-26T13:58:41+01:00',
    LOCAL_ID,
    body('queries/open_orders.sql').replace('o.ordered_at', 'o.created_at'),
    4,
    null,
    'column o.created_at does not exist',
  ],
  [
    '2026-11-26T11:20:15+01:00',
    LIVE_ID,
    body('reports/daily_sales.sql'),
    1284,
    14,
  ],
  [
    '2026-11-26T10:47:02+01:00',
    ARCHIVE_ID,
    body('archive/closed_orders.mongodb.js'),
    17,
    12,
  ],
  [
    '2026-11-26T09:31:57+01:00',
    STAGING_ID,
    'SELECT status, count(*) FROM orders GROUP BY status;',
    12,
    5,
  ],
  [
    '2026-11-25T17:05:33+01:00',
    LOCAL_ID,
    body('reports/runs_by_day.sql'),
    64,
    168,
  ],
  [
    '2026-11-25T16:40:19+01:00',
    LIVE_ID,
    body('maintenance/vacuum_stats.sql'),
    9,
    10,
  ],
  [
    '2026-11-25T15:12:44+01:00',
    LOCAL_ID,
    "UPDATE item SET is_active = false WHERE sku IN ('HM-3201', 'HM-3202', 'HM-3215');",
    6,
    3,
  ],
  [
    '2026-11-25T11:02:10+01:00',
    STAGING_ID,
    body('queries/customers_by_country.sql'),
    22,
    18,
  ],
  [
    '2026-11-24T16:55:01+01:00',
    LOCAL_ID,
    body('maintenance/index_usage.sql'),
    15,
    3,
  ],
  [
    '2026-11-24T10:18:36+01:00',
    LIVE_ID,
    'SELECT * FROM orders ORDER BY ordered_at DESC LIMIT 100;',
    31,
    100,
  ],
]

export const HISTORY: HistoryEntry_Serialize[] = RUNS.map(
  ([time, connection, sql, elapsed_ms, rows, error], index) => ({
    id: RUNS.length - index,
    connection_id: connection,
    connection_name: NAMES[connection],
    sql,
    executed_at_secs: Math.floor(Date.parse(time) / 1000),
    elapsed_ms,
    status: error ? 'failed' : 'ok',
    rows: error ? null : rows,
    error: error ?? null,
  }),
)

export function searchHistory(query: string): HistoryEntry_Serialize[] {
  const text = query.trim().toLowerCase()
  return text === ''
    ? HISTORY
    : HISTORY.filter((entry) => entry.sql.toLowerCase().includes(text))
}

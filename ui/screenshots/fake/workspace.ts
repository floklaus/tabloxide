import type {
  ConnectionProfile_Serialize,
  EngineEntry_Serialize,
  FileEntry,
  Preferences_Serialize,
  RecentWorkspaceInfo_Serialize,
  WorkspaceSnapshot_Serialize,
} from '../../src/bindings'
import { DEFAULT_ENGINES } from '../../src/engines/engineStore'

/** The workspace of the screenshots: a small project with reports for a web shop. */

export const WORKSPACE_PATH = '/home/dana/projects/shop-reports'

export const LOCAL_ID = 'conn-local-shop'
export const STAGING_ID = 'conn-staging-shop'
export const LIVE_ID = 'conn-live-shop'
export const ARCHIVE_ID = 'conn-orders-archive'

const CONNECTIONS: ConnectionProfile_Serialize[] = [
  {
    id: LOCAL_ID,
    name: 'Local shop',
    engine: 'postgres',
    environment: 'development',
    host: 'localhost',
    port: 5432,
    database: 'shop',
    user: 'shop_dev',
    tls_mode: 'prefer',
    connect_timeout_secs: 10,
    secret: { type: 'keychain' },
  },
  {
    id: STAGING_ID,
    name: 'Staging shop',
    engine: 'postgres',
    environment: 'staging',
    host: 'db.staging.shop.internal',
    port: 5432,
    database: 'shop',
    user: 'report_reader',
    tls_mode: 'require',
    connect_timeout_secs: 10,
    query_timeout_secs: 60,
    secret: { type: 'env-var', name: 'SHOP_STAGING_PASSWORD' },
  },
  {
    id: LIVE_ID,
    name: 'Live shop',
    engine: 'postgres',
    environment: 'production',
    host: 'db.shop.internal',
    port: 5432,
    database: 'shop',
    user: 'report_reader',
    tls_mode: 'verify-full',
    connect_timeout_secs: 10,
    query_timeout_secs: 30,
    read_only: true,
    params: { application_name: 'tabloxide' },
    secret: { type: 'keychain' },
  },
  {
    id: ARCHIVE_ID,
    name: 'Orders archive',
    engine: 'mongodb',
    environment: 'development',
    host: 'localhost',
    port: 27017,
    database: 'orders_archive',
    user: 'archive_reader',
    tls_mode: 'disable',
    connect_timeout_secs: 10,
    params: { authSource: 'admin' },
    secret: { type: 'keychain' },
  },
]

export const WORKSPACE: WorkspaceSnapshot_Serialize = {
  path: WORKSPACE_PATH,
  name: 'shop-reports',
  connections: CONNECTIONS,
}

export const RECENT: RecentWorkspaceInfo_Serialize[] = [
  {
    path: WORKSPACE_PATH,
    name: 'shop-reports',
    opened_at: 1_764_150_000,
    engines: ['postgres', 'mongodb'],
    exists: true,
  },
]

/** The MongoDB connector is installed from the official list. */
export const ENGINES: EngineEntry_Serialize[] = DEFAULT_ENGINES.map((entry) =>
  entry.info.engine === 'mongodb'
    ? {
        ...entry,
        source: {
          type: 'installed',
          version: '0.1.0',
          isOfficial: true,
          publisher: 'Tabloxide',
        },
      }
    : entry,
)

export const PREFERENCES: Preferences_Serialize = {
  editor: { font_size: 14, tab_width: 2, line_numbers: true, word_wrap: false },
  history_retention_days: 90,
  slow_query_ms: 1000,
  guardrails: { development: 'risky', staging: 'risky', production: 'always' },
  assistant: { model: 'claude-opus-5-5', rows_for_ai: 20 },
  check_for_updates: true,
}

const ITEMS_SQL = `-- Best-selling items of the last 30 days
SELECT i.sku,
       i.name,
       sum(ol.quantity)                 AS units,
       sum(ol.quantity * ol.unit_price) AS revenue
FROM item AS i
JOIN order_line AS ol ON ol.item_id = i.id
JOIN orders AS o ON o.id = ol.order_id
WHERE o.ordered_at >= now() - interval '30 days'
  AND o.status <> 'cancelled'
GROUP BY i.sku, i.name
ORDER BY revenue DESC
LIMIT 15;
`

const OPEN_ORDERS_SQL = `-- Orders that are paid but not shipped
SELECT o.id,
       c.name AS customer,
       o.created_at,
       o.total
FROM orders AS o
JOIN customer AS c ON c.id = o.customer_id
WHERE o.status = 'paid'
  AND o.shipped_at IS NULL
ORDER BY o.created_at;
`

const DAILY_SALES_SQL = `-- Revenue and orders for each day of the last two weeks
SELECT date_trunc('day', o.ordered_at)::date AS day,
       count(DISTINCT o.id)                  AS orders,
       sum(ol.quantity * ol.unit_price)      AS revenue
FROM orders AS o
JOIN order_line AS ol ON ol.order_id = o.id
WHERE o.ordered_at >= current_date - 14
  AND o.status <> 'cancelled'
GROUP BY 1
ORDER BY 1;
`

const DAILY_SALES_OLD = `-- Revenue for each day of the last two weeks
SELECT date_trunc('day', o.ordered_at)::date AS day,
       sum(o.total)                          AS revenue
FROM orders AS o
WHERE o.ordered_at >= current_date - 14
GROUP BY 1
ORDER BY 1;
`

const RUNS_BY_DAY_SQL = `-- Orders for each weekday and hour
SELECT extract(isodow FROM ordered_at) AS weekday,
       extract(hour FROM ordered_at)   AS hour,
       count(*)                        AS orders
FROM orders
WHERE ordered_at >= current_date - 28
GROUP BY 1, 2
ORDER BY 1, 2;
`

const VACUUM_SQL = `-- Tables with many dead rows
SELECT relname,
       n_live_tup,
       n_dead_tup,
       last_autovacuum
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 10;
`

const INDEX_USAGE_SQL = `-- Indexes that no scan used since the last reset
SELECT schemaname, relname, indexrelname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY relname;
`

const CLOSED_ORDERS_MONGO = `// Closed orders of 100 EUR or more, the newest first
db.orders.find(
  { status: "closed", total: { $gte: 100 } },
  { order_no: 1, customer: 1, total: 1, items: 1, closed_at: 1 }
).sort({ closed_at: -1 }).limit(20)
`

const README = `# shop-reports

SQL reports for the web shop. Open this folder in Tabloxide.

- queries/: queries for daily work
- reports/: reports for the weekly sales meeting
- maintenance/: checks for the database team
`

export const FILES: Record<string, string> = {
  'README.md': README,
  'queries/items.sql': ITEMS_SQL,
  'queries/open_orders.sql': OPEN_ORDERS_SQL,
  'queries/customers_by_country.sql': `SELECT country, count(*) AS customers
FROM customer
GROUP BY country
ORDER BY customers DESC;
`,
  'reports/daily_sales.sql': DAILY_SALES_SQL,
  'reports/runs_by_day.sql': RUNS_BY_DAY_SQL,
  'maintenance/vacuum_stats.sql': VACUUM_SQL,
  'maintenance/index_usage.sql': INDEX_USAGE_SQL,
  'archive/closed_orders.mongodb.js': CLOSED_ORDERS_MONGO,
}

/** The text of files before the changes in the working tree, for the diffs. */
export const COMMITTED_FILES: Record<string, string> = {
  'reports/daily_sales.sql': DAILY_SALES_OLD,
  'queries/items.sql': ITEMS_SQL.replace('LIMIT 15', 'LIMIT 10'),
  'README.md': README.replace(
    '- maintenance/: checks for the database team\n',
    '',
  ),
}

/** Lists one directory of the workspace: the folders first, then the files. */
export function listDirectory(directory: string): FileEntry[] {
  const prefix = directory === '' ? '' : `${directory}/`
  const names = new Map<string, boolean>()
  for (const path of Object.keys(FILES)) {
    if (!path.startsWith(prefix)) continue
    const rest = path.slice(prefix.length)
    const [name, ...below] = rest.split('/')
    names.set(name, below.length > 0)
  }
  return [...names.entries()]
    .map(([name, isDirectory]) => ({
      name,
      path: `${prefix}${name}`,
      is_directory: isDirectory,
    }))
    .sort(
      (a, b) =>
        Number(b.is_directory) - Number(a.is_directory) ||
        a.name.localeCompare(b.name),
    )
}

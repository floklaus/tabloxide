import type {
  Column_Serialize,
  Outcome_Serialize,
  StatementReport_Serialize,
} from '../../src/bindings'

/** The results of the statements that the screenshots run. */

type Cell = string | null

function column(
  name: string,
  type_name: string,
  kind: Column_Serialize['kind'],
): Column_Serialize {
  return { name, type_name, kind }
}

function rows(columns: Column_Serialize[], data: Cell[][]): Outcome_Serialize {
  return {
    type: 'rows',
    columns,
    rows: data,
    is_complete: true,
    total_rows: data.length,
  }
}

const TOP_ITEMS: Cell[][] = [
  ['KT-1042', 'Enamel mug, 350 ml', '412', '7396.40'],
  ['TX-2210', 'Linen tea towel, set of 2', '358', '6765.10'],
  ['KT-1187', 'Cast iron pan, 26 cm', '96', '6230.40'],
  ['HM-3305', 'Oak cutting board', '141', '5626.00'],
  ['TX-2034', 'Wool throw, grey', '61', '5179.00'],
  ['KT-1220', 'Pour-over coffee set', '88', '4831.20'],
  ['HM-3410', 'Ceramic vase, sand', '127', '4432.30'],
  ['GD-5102', 'Garden kneeler', '173', '3979.00'],
  ['KT-1093', 'Bread box, bamboo', '74', '3618.60'],
  ['HM-3377', 'Beeswax candles, set of 4', '219', '3482.10'],
  ['GD-5148', 'Watering can, 5 l', '68', '2713.20'],
  ['TX-2105', 'Cotton apron, olive', '104', '2589.60'],
  ['KT-1301', 'Spice jars, set of 6', '93', '2222.70'],
  ['HM-3502', 'Door mat, coir', '81', '2016.90'],
  ['GD-5201', 'Herb planter, 3 pots', '57', '1704.30'],
]

const OPEN_ORDERS: Cell[][] = [
  ['100481', 'Mara Lindqvist', '2026-11-24 08:12:44+01', '86.40'],
  ['100486', 'Tobias Wendt', '2026-11-24 09:47:02+01', '142.90'],
  ['100493', 'Ines Carvalho', '2026-11-24 13:05:19+01', '54.00'],
  ['100502', 'Jonas Albers', '2026-11-25 07:58:31+01', '219.70'],
  ['100507', 'Lea Hoffmann', '2026-11-25 11:22:10+01', '38.50'],
  ['100511', 'Pieter de Vries', '2026-11-25 16:40:57+01', '96.30'],
  ['100519', 'Sofia Marchetti', '2026-11-26 08:03:12+01', '175.20'],
  ['100524', 'Emil Novak', '2026-11-26 10:31:45+01', '64.80'],
]

function dailySales(): Cell[][] {
  const orders = [
    182, 167, 201, 214, 156, 129, 191, 188, 176, 223, 239, 171, 140, 198,
  ]
  return orders.map((count, index) => {
    const day = new Date(Date.UTC(2026, 10, 12 + index))
    const revenue = (count * 61.37 + index * 13.9).toFixed(2)
    return [day.toISOString().slice(0, 10), String(count), revenue]
  })
}

const ARCHIVE_DOCS: Cell[][] = [
  [
    '6745a1c2e4b0f1a2c3d4e501',
    'A-2026-09881',
    '{"name": "Mara Lindqvist", "country": "SE"}',
    '[{"sku": "KT-1187", "qty": 2}, {"sku": "HM-3305", "qty": 1}]',
    '169.70',
    '2026-11-25T16:42:10Z',
  ],
  [
    '6745a1c2e4b0f1a2c3d4e4f7',
    'A-2026-09874',
    '{"name": "Pieter de Vries", "country": "NL"}',
    '[{"sku": "TX-2034", "qty": 2}]',
    '170.00',
    '2026-11-25T11:05:37Z',
  ],
  [
    '6745a1c2e4b0f1a2c3d4e4e2',
    'A-2026-09861',
    '{"name": "Sofia Marchetti", "country": "IT"}',
    '[{"sku": "KT-1220", "qty": 1}, {"sku": "KT-1042", "qty": 4}]',
    '126.90',
    '2026-11-24T18:20:03Z',
  ],
  [
    '6745a1c2e4b0f1a2c3d4e4d0',
    'A-2026-09850',
    '{"name": "Jonas Albers", "country": "DE"}',
    '[{"sku": "GD-5148", "qty": 1}, {"sku": "GD-5102", "qty": 3}]',
    '108.90',
    '2026-11-24T09:14:48Z',
  ],
  [
    '6745a1c2e4b0f1a2c3d4e4c5',
    'A-2026-09842',
    '{"name": "Ines Carvalho", "country": "PT"}',
    '[{"sku": "HM-3410", "qty": 3}]',
    '104.70',
    '2026-11-23T15:36:21Z',
  ],
  [
    '6745a1c2e4b0f1a2c3d4e4b9',
    'A-2026-09833',
    '{"name": "Tobias Wendt", "country": "DE"}',
    '[{"sku": "TX-2210", "qty": 6}]',
    '113.40',
    '2026-11-23T08:51:09Z',
  ],
  [
    '6745a1c2e4b0f1a2c3d4e4a3',
    'A-2026-09819',
    '{"name": "Lea Hoffmann", "country": "AT"}',
    '[{"sku": "KT-1187", "qty": 1}, {"sku": "KT-1301", "qty": 2}]',
    '112.70',
    '2026-11-22T19:02:55Z',
  ],
  [
    '6745a1c2e4b0f1a2c3d4e498',
    'A-2026-09807',
    '{"name": "Emil Novak", "country": "CZ"}',
    '[{"sku": "HM-3377", "qty": 8}]',
    '127.20',
    '2026-11-22T12:44:30Z',
  ],
  [
    '6745a1c2e4b0f1a2c3d4e486',
    'A-2026-09796',
    '{"name": "Aino Virtanen", "country": "FI"}',
    '[{"sku": "TX-2034", "qty": 1}, {"sku": "TX-2105", "qty": 2}]',
    '134.80',
    '2026-11-21T17:28:14Z',
  ],
  [
    '6745a1c2e4b0f1a2c3d4e471',
    'A-2026-09788',
    '{"name": "Lucas Moreau", "country": "FR"}',
    '[{"sku": "KT-1093", "qty": 1}, {"sku": "KT-1042", "qty": 3}]',
    '102.80',
    '2026-11-21T10:09:42Z',
  ],
  [
    '6745a1c2e4b0f1a2c3d4e465',
    'A-2026-09775',
    '{"name": "Hanna Berg", "country": "NO"}',
    '[{"sku": "HM-3305", "qty": 3}]',
    '120.00',
    '2026-11-20T14:57:06Z',
  ],
  [
    '6745a1c2e4b0f1a2c3d4e452',
    'A-2026-09764',
    '{"name": "Marek Kowalski", "country": "PL"}',
    '[{"sku": "GD-5201", "qty": 2}, {"sku": "GD-5148", "qty": 1}]',
    '199.20',
    '2026-11-20T08:33:51Z',
  ],
]

/** The error of the query with a wrong column name. */
export const WRONG_COLUMN_MESSAGE = 'column o.created_at does not exist'

function report(
  sql: string,
  outcome: Outcome_Serialize,
  elapsed_ms: number,
): StatementReport_Serialize {
  return {
    range: { from: 0, to: sql.trimEnd().length },
    elapsed_ms,
    outcome,
    messages: [],
  }
}

/** Returns the report of a run. The text of the statement selects the result. */
export function runStatement(sql: string): StatementReport_Serialize {
  if (sql.includes('o.created_at')) {
    const position = sql.indexOf('o.created_at') + 1
    return report(
      sql,
      {
        type: 'failed',
        error: {
          kind: 'database',
          message: WRONG_COLUMN_MESSAGE,
          detail: null,
          hint: 'Perhaps you meant to reference the column "o.ordered_at".',
          code: '42703',
          position,
        },
        location: null,
      },
      4,
    )
  }
  if (sql.includes('FROM item AS i')) {
    return report(
      sql,
      rows(
        [
          column('sku', 'varchar', 'text'),
          column('name', 'varchar', 'text'),
          column('units', 'int8', 'number'),
          column('revenue', 'numeric', 'number'),
        ],
        TOP_ITEMS,
      ),
      38,
    )
  }
  if (sql.includes("o.status = 'paid'")) {
    return report(
      sql,
      rows(
        [
          column('id', 'int8', 'number'),
          column('customer', 'varchar', 'text'),
          column('ordered_at', 'timestamptz', 'temporal'),
          column('total', 'numeric', 'number'),
        ],
        OPEN_ORDERS,
      ),
      21,
    )
  }
  if (sql.includes('db.orders.find')) {
    return report(
      sql,
      rows(
        [
          column('_id', 'objectId', 'other'),
          column('order_no', 'string', 'text'),
          column('customer', 'object', 'json'),
          column('items', 'array', 'json'),
          column('total', 'decimal', 'number'),
          column('closed_at', 'date', 'temporal'),
        ],
        ARCHIVE_DOCS,
      ),
      17,
    )
  }
  return report(
    sql,
    rows(
      [
        column('day', 'date', 'temporal'),
        column('orders', 'int8', 'number'),
        column('revenue', 'numeric', 'number'),
      ],
      dailySales(),
    ),
    52,
  )
}

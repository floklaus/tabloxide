import type {
  ColumnInfo_Serialize,
  ConstraintInfo,
  IndexInfo,
  RelationDetail_Serialize,
  RelationInfo,
  SchemaInfo,
} from '../../src/bindings'

/** The schema of the shop database, and the collections of the MongoDB archive. */

type Column = [
  name: string,
  type: string,
  isNullable: boolean,
  defaultValue?: string,
]

function columns(primaryKey: string[], list: Column[]): ColumnInfo_Serialize[] {
  return list.map(([name, data_type, is_nullable, defaultValue]) => ({
    name,
    data_type,
    is_nullable,
    default: defaultValue ?? null,
    is_primary_key: primaryKey.includes(name),
  }))
}

function index(
  name: string,
  definition: string,
  is_unique = false,
  is_primary = false,
): IndexInfo {
  return { name, definition, is_unique, is_primary }
}

function constraint(
  name: string,
  kind: ConstraintInfo['kind'],
  definition: string,
): ConstraintInfo {
  return { name, kind, definition }
}

const SERIAL = (table: string) => `nextval('${table}_id_seq'::regclass)`

const POSTGRES_DETAILS: Record<string, RelationDetail_Serialize> = {
  customer: {
    columns: columns(
      ['id'],
      [
        ['id', 'integer', false, SERIAL('customer')],
        ['name', 'character varying(120)', false],
        ['email', 'character varying(200)', false],
        ['country', 'character(2)', false],
        ['city', 'character varying(80)', true],
        ['created_at', 'timestamp with time zone', false, 'now()'],
      ],
    ),
    indexes: [
      index(
        'customer_pkey',
        'CREATE UNIQUE INDEX customer_pkey ON public.customer USING btree (id)',
        true,
        true,
      ),
      index(
        'customer_email_key',
        'CREATE UNIQUE INDEX customer_email_key ON public.customer USING btree (email)',
        true,
      ),
    ],
    constraints: [
      constraint('customer_pkey', 'primary-key', 'PRIMARY KEY (id)'),
      constraint('customer_email_key', 'unique', 'UNIQUE (email)'),
    ],
    columns_from_sample: false,
  },
  item: {
    columns: columns(
      ['id'],
      [
        ['id', 'integer', false, SERIAL('item')],
        ['sku', 'character varying(20)', false],
        ['name', 'character varying(120)', false],
        ['category', 'character varying(40)', false],
        ['unit_price', 'numeric(10,2)', false],
        ['weight_kg', 'numeric', true],
        ['is_active', 'boolean', false, 'true'],
        ['created_at', 'timestamp with time zone', false, 'now()'],
      ],
    ),
    indexes: [
      index(
        'item_pkey',
        'CREATE UNIQUE INDEX item_pkey ON public.item USING btree (id)',
        true,
        true,
      ),
      index(
        'item_sku_key',
        'CREATE UNIQUE INDEX item_sku_key ON public.item USING btree (sku)',
        true,
      ),
    ],
    constraints: [
      constraint('item_pkey', 'primary-key', 'PRIMARY KEY (id)'),
      constraint('item_sku_key', 'unique', 'UNIQUE (sku)'),
      constraint(
        'item_unit_price_check',
        'check',
        'CHECK ((unit_price >= (0)::numeric))',
      ),
    ],
    columns_from_sample: false,
  },
  orders: {
    columns: columns(
      ['id'],
      [
        ['id', 'bigint', false, SERIAL('orders')],
        ['customer_id', 'integer', false],
        ['ordered_at', 'timestamp with time zone', false, 'now()'],
        ['status', 'order_status', false, "'new'::order_status"],
        ['total', 'numeric(12,2)', false, '0'],
        ['shipped_at', 'timestamp with time zone', true],
        ['note', 'text', true],
      ],
    ),
    indexes: [
      index(
        'orders_pkey',
        'CREATE UNIQUE INDEX orders_pkey ON public.orders USING btree (id)',
        true,
        true,
      ),
      index(
        'orders_customer_id_idx',
        'CREATE INDEX orders_customer_id_idx ON public.orders USING btree (customer_id)',
      ),
      index(
        'orders_ordered_at_idx',
        'CREATE INDEX orders_ordered_at_idx ON public.orders USING btree (ordered_at)',
      ),
    ],
    constraints: [
      constraint('orders_pkey', 'primary-key', 'PRIMARY KEY (id)'),
      constraint(
        'orders_customer_id_fkey',
        'foreign-key',
        'FOREIGN KEY (customer_id) REFERENCES customer(id)',
      ),
      constraint(
        'orders_total_check',
        'check',
        'CHECK ((total >= (0)::numeric))',
      ),
    ],
    columns_from_sample: false,
  },
  order_line: {
    columns: columns(
      ['order_id', 'line_no'],
      [
        ['order_id', 'bigint', false],
        ['line_no', 'smallint', false],
        ['item_id', 'integer', false],
        ['quantity', 'integer', false],
        ['unit_price', 'numeric(10,2)', false],
        ['discount', 'numeric(4,2)', true],
      ],
    ),
    indexes: [
      index(
        'order_line_pkey',
        'CREATE UNIQUE INDEX order_line_pkey ON public.order_line USING btree (order_id, line_no)',
        true,
        true,
      ),
      index(
        'order_line_item_id_idx',
        'CREATE INDEX order_line_item_id_idx ON public.order_line USING btree (item_id)',
      ),
    ],
    constraints: [
      constraint(
        'order_line_pkey',
        'primary-key',
        'PRIMARY KEY (order_id, line_no)',
      ),
      constraint(
        'order_line_order_id_fkey',
        'foreign-key',
        'FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE',
      ),
      constraint(
        'order_line_item_id_fkey',
        'foreign-key',
        'FOREIGN KEY (item_id) REFERENCES item(id)',
      ),
      constraint(
        'order_line_quantity_check',
        'check',
        'CHECK ((quantity > 0))',
      ),
    ],
    columns_from_sample: false,
  },
  daily_revenue: {
    columns: columns(
      [],
      [
        ['day', 'date', true],
        ['orders', 'bigint', true],
        ['revenue', 'numeric', true],
      ],
    ),
    indexes: [],
    constraints: [],
    columns_from_sample: false,
  },
}

const ARCHIVE_DETAILS: Record<string, RelationDetail_Serialize> = {
  orders: {
    columns: columns(
      ['_id'],
      [
        ['_id', 'objectId', false],
        ['order_no', 'string', false],
        ['customer', 'object', false],
        ['items', 'array', false],
        ['total', 'decimal', false],
        ['currency', 'string', false],
        ['status', 'string', false],
        ['closed_at', 'date', false],
        ['note', 'string|null', true],
      ],
    ),
    indexes: [
      index('_id_', '{ "_id": 1 }', true, true),
      index('status_1_closed_at_-1', '{ "status": 1, "closed_at": -1 }'),
    ],
    constraints: [],
    columns_from_sample: true,
  },
  returns: {
    columns: columns(
      ['_id'],
      [
        ['_id', 'objectId', false],
        ['order_no', 'string', false],
        ['reason', 'string', false],
        ['refund', 'decimal', false],
        ['received_at', 'date', false],
      ],
    ),
    indexes: [index('_id_', '{ "_id": 1 }', true, true)],
    constraints: [],
    columns_from_sample: true,
  },
  customers: {
    columns: columns(
      ['_id'],
      [
        ['_id', 'objectId', false],
        ['name', 'string', false],
        ['country', 'string', false],
        ['orders', 'int', false],
      ],
    ),
    indexes: [index('_id_', '{ "_id": 1 }', true, true)],
    constraints: [],
    columns_from_sample: true,
  },
}

export function schemaList(isMongo: boolean): SchemaInfo[] {
  if (isMongo) return [{ name: 'orders_archive', is_system: false }]
  return [
    { name: 'public', is_system: false },
    { name: 'reporting', is_system: false },
    { name: 'information_schema', is_system: true },
    { name: 'pg_catalog', is_system: true },
  ]
}

export function relationList(isMongo: boolean, schema: string): RelationInfo[] {
  if (isMongo) {
    return Object.keys(ARCHIVE_DETAILS)
      .sort()
      .map((name) => ({ name, kind: 'table' }))
  }
  if (schema === 'public') {
    return [
      { name: 'customer', kind: 'table' },
      { name: 'item', kind: 'table' },
      { name: 'order_line', kind: 'table' },
      { name: 'orders', kind: 'table' },
      { name: 'daily_revenue', kind: 'view' },
    ]
  }
  if (schema === 'reporting') {
    return [
      { name: 'monthly_sales', kind: 'materialized-view' },
      { name: 'top_customers', kind: 'view' },
    ]
  }
  return []
}

export function relationDetail(
  isMongo: boolean,
  name: string,
): RelationDetail_Serialize {
  const detail = (isMongo ? ARCHIVE_DETAILS : POSTGRES_DETAILS)[name]
  return (
    detail ?? {
      columns: [],
      indexes: [],
      constraints: [],
      columns_from_sample: false,
    }
  )
}

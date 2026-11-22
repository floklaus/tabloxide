import { describe, expect, test, vi } from 'vitest'
import type { Catalog } from './catalogCache'
import {
  completionOptions,
  findRelation,
  type ColumnReader,
} from './sqlCompletion'
import { completionTarget } from './sqlText'

const CATALOG: Catalog = {
  schemas: [
    { name: 'public', is_system: false },
    { name: 'sales', is_system: false },
    { name: 'pg_catalog', is_system: true },
  ],
  relations: {
    sales: [
      { name: 'orders', kind: 'table' },
      { name: 'customer', kind: 'table' },
    ],
    public: [
      { name: 'customer', kind: 'table' },
      { name: 'Active Customer', kind: 'view' },
    ],
  },
}

const COLUMNS: Record<string, string[]> = {
  'sales.orders': ['id', 'total', 'customer_id'],
  'public.customer': ['id', 'name'],
  'sales.customer': ['id', 'region'],
}

const readColumns: ColumnReader = vi.fn(async (schema, name) =>
  (COLUMNS[`${schema}.${name}`] ?? []).map((column) => ({
    name: column,
    data_type: 'integer',
    is_nullable: false,
    default: null,
    is_primary_key: false,
  })),
)

async function complete(textBefore: string, rest = '') {
  const target = completionTarget(textBefore)
  if (!target) throw new Error('no target')
  return completionOptions(CATALOG, textBefore + rest, target, readColumns)
}

const labels = (options: { label: string }[]) =>
  options.map((option) => option.label)

describe('completionOptions', () => {
  test('offers the columns of the tables of the statement, then tables and schemas', async () => {
    const options = await complete('select ', ' from sales.orders')

    expect(labels(options)).toEqual([
      'id',
      'total',
      'customer_id',
      'customer',
      '"Active Customer"',
      'orders',
      'customer',
      'public',
      'sales',
    ])
    expect(options[0]).toMatchObject({
      type: 'property',
      detail: 'integer · orders',
      boost: 2,
    })
  })

  test('a table of a different schema gets its schema name when the user selects it', async () => {
    const options = await complete('select * from ')

    const orders = options.find((option) => option.label === 'orders')
    const customers = options.filter((option) => option.label === 'customer')
    expect(orders?.apply).toBe('sales.orders')
    // The name is in two schemas. Each option names its schema.
    expect(customers.map((option) => option.apply)).toEqual([
      'public.customer',
      'sales.customer',
    ])
    expect(options.find((o) => o.label === '"Active Customer"')?.apply).toBe(
      '"Active Customer"',
    )
  })

  test('offers the columns of an alias', async () => {
    const options = await complete(
      'select o.',
      ' from sales.orders o join customer c on true',
    )

    expect(labels(options)).toEqual(['id', 'total', 'customer_id'])
  })

  test('an unqualified table of the statement uses the default schema first', async () => {
    const options = await complete('select c.', ' from customer c')

    expect(labels(options)).toEqual(['id', 'name'])
  })

  test('offers the tables of a schema', async () => {
    const options = await complete('select * from sales.')

    expect(labels(options)).toEqual(['orders', 'customer'])
    expect(options[0].apply).toBe('orders')
  })

  test('offers the columns of a schema and table qualifier', async () => {
    const options = await complete('select sales.customer.')

    expect(labels(options)).toEqual(['id', 'region'])
  })

  test('offers nothing for an unknown qualifier', async () => {
    expect(await complete('select nothing.')).toEqual([])
  })
})

test('findRelation uses the default schema first and ignores the case of the catalog name', () => {
  expect(findRelation(CATALOG, null, 'orders')?.schema).toBe('sales')
  expect(findRelation(CATALOG, 'sales', 'customer')?.schema).toBe('sales')
  expect(findRelation(CATALOG, null, 'customer')?.schema).toBe('public')
  // DuckDB compares names without their case. The completion does the same.
  expect(findRelation(CATALOG, null, 'active customer')?.info.kind).toBe('view')
  expect(findRelation(CATALOG, null, 'Active Customer')?.info.kind).toBe('view')
  expect(findRelation(CATALOG, null, 'no_such_table')).toBeNull()
})

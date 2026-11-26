import { describe, expect, test } from 'vitest'
import {
  buildRows,
  foreignKeyColumns,
  foreignKeyTargets,
  relationKey,
  schemaKey,
  type RelationDetail,
  type TreeInput,
} from './treeModel'

const detail: RelationDetail = {
  columns: [
    {
      name: 'id',
      data_type: 'integer',
      is_nullable: false,
      default: null,
      is_primary_key: true,
    },
    {
      name: 'note',
      data_type: 'text',
      is_nullable: true,
      default: null,
      is_primary_key: false,
    },
  ],
  indexes: [
    {
      name: 'item_pkey',
      definition: 'CREATE …',
      is_unique: true,
      is_primary: true,
    },
  ],
  constraints: [],
  columns_from_sample: false,
}

function input(overrides: Partial<TreeInput> = {}): TreeInput {
  return {
    schemas: {
      status: 'loaded',
      data: [
        { name: 'public', is_system: false },
        { name: 'pg_catalog', is_system: true },
      ],
    },
    relations: {
      public: {
        status: 'loaded',
        data: [
          { name: 'Item', kind: 'table' },
          { name: 'order_view', kind: 'view' },
        ],
      },
    },
    details: {},
    expanded: new Set(),
    filter: '',
    ...overrides,
  }
}

function labels(rows: ReturnType<typeof buildRows>): string[] {
  return rows.map((row) => {
    switch (row.type) {
      case 'schema':
        return `schema ${row.schema}`
      case 'relation':
        return `relation ${row.name}`
      case 'column':
        return `column ${row.name}: ${row.typeText}${row.isPrimaryKey ? ' (primary key)' : ''}${row.isForeignKey ? ' (foreign key)' : ''}`
      case 'note':
        return `note ${row.text}`
    }
  })
}

describe('buildRows', () => {
  test('gives no rows before the schema loads', () => {
    expect(buildRows(input({ schemas: null }))).toEqual([])
  })

  test('shows a note while the schemas load, and the error if the load fails', () => {
    expect(
      labels(buildRows(input({ schemas: { status: 'loading' } }))),
    ).toEqual(['note Loading…'])
    const failed = buildRows(
      input({ schemas: { status: 'failed', message: 'permission denied' } }),
    )
    expect(failed[0]).toMatchObject({
      text: 'permission denied',
      isError: true,
    })
  })

  test('shows only the schemas when no node is open', () => {
    expect(labels(buildRows(input()))).toEqual([
      'schema public',
      'schema pg_catalog',
    ])
  })

  test('shows the tables of an open schema', () => {
    const rows = buildRows(input({ expanded: new Set([schemaKey('public')]) }))

    expect(labels(rows)).toEqual([
      'schema public',
      'relation Item',
      'relation order_view',
      'schema pg_catalog',
    ])
  })

  test('shows a note for an open schema that loads', () => {
    const rows = buildRows(
      input({ expanded: new Set([schemaKey('pg_catalog')]) }),
    )

    expect(labels(rows)).toEqual([
      'schema public',
      'schema pg_catalog',
      'note Loading…',
    ])
  })

  test('filters the tables without case', () => {
    const expanded = new Set([schemaKey('public')])

    expect(labels(buildRows(input({ expanded, filter: ' ITEM ' })))).toEqual([
      'schema public',
      'relation Item',
      'schema pg_catalog',
    ])
    expect(labels(buildRows(input({ expanded, filter: 'zzz' })))).toContain(
      'note No table contains this text.',
    )
  })

  test('shows the columns of an open table, with the type and the keys', () => {
    const key = relationKey('public', 'Item')
    const rows = buildRows(
      input({
        expanded: new Set([schemaKey('public'), key]),
        details: { [key]: { status: 'loaded', data: detail } },
      }),
    )

    expect(labels(rows)).toEqual([
      'schema public',
      'relation Item',
      'column id: integer (primary key)',
      'column note: text?',
      'relation order_view',
      'schema pg_catalog',
    ])
  })

  test('finds the columns and the targets of the foreign keys', () => {
    const withKeys: RelationDetail = {
      ...detail,
      constraints: [
        {
          name: 'item_order_fk',
          kind: 'foreign-key',
          definition:
            'FOREIGN KEY (order_id, line) REFERENCES orders(order_id, line_no) ON DELETE CASCADE',
        },
      ],
    }

    expect([...foreignKeyColumns(withKeys)]).toEqual(['order_id', 'line'])
    expect(Object.fromEntries(foreignKeyTargets(withKeys))).toEqual({
      order_id: 'orders (order_id)',
      line: 'orders (line_no)',
    })
  })

  test('gives each row a different key', () => {
    const key = relationKey('public', 'Item')
    const rows = buildRows(
      input({
        expanded: new Set([schemaKey('public'), key]),
        details: { [key]: { status: 'loaded', data: detail } },
      }),
    )

    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length)
  })
})

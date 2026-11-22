import { describe, expect, test } from 'vitest'
import {
  completionTarget,
  quoteIfNecessary,
  statementAround,
  tableReferences,
} from './sqlText'

describe('tableReferences', () => {
  test('finds the tables and their aliases', () => {
    const statement = `SELECT o.id FROM sales.orders AS o
      JOIN customer c ON c.id = o.customer_id
      LEFT JOIN "Line Item" li USING (id)
      WHERE o.total > 0`

    expect(tableReferences(statement)).toEqual([
      { schema: 'sales', name: 'orders', alias: 'o' },
      { schema: null, name: 'customer', alias: 'c' },
      { schema: null, name: 'Line Item', alias: 'li' },
    ])
  })

  test('reads a list of tables after FROM', () => {
    expect(tableReferences('select * from a x, b, c y where 1 = 1')).toEqual([
      { schema: null, name: 'a', alias: 'x' },
      { schema: null, name: 'b', alias: null },
      { schema: null, name: 'c', alias: 'y' },
    ])
  })

  test('a keyword after the table is not an alias', () => {
    expect(tableReferences('select * from item where id = 1')).toEqual([
      { schema: null, name: 'item', alias: null },
    ])
    expect(tableReferences('update item set a = 1')).toEqual([
      { schema: null, name: 'item', alias: null },
    ])
    expect(tableReferences('insert into item values (1)')).toEqual([
      { schema: null, name: 'item', alias: null },
    ])
  })

  test('ignores strings, comments, and table functions', () => {
    const statement = `select 'from fake' -- from other
      from read_csv('a.csv') r /* join hidden h */ join real_table t on true`

    expect(tableReferences(statement)).toEqual([
      { schema: null, name: 'real_table', alias: 't' },
    ])
  })

  test('an unquoted name is in lower case, a quoted name keeps its case', () => {
    expect(
      tableReferences('select * from Public.Item, "Public"."Item"'),
    ).toEqual([
      { schema: 'public', name: 'item', alias: null },
      { schema: 'Public', name: 'Item', alias: null },
    ])
  })
})

describe('completionTarget', () => {
  test('reads the prefix and the qualifier before the cursor', () => {
    expect(completionTarget('select na')).toEqual({
      qualifier: [],
      prefix: 'na',
      from: 7,
    })
    expect(completionTarget('select o.')).toEqual({
      qualifier: ['o'],
      prefix: '',
      from: 9,
    })
    expect(completionTarget('select * from public.it')).toEqual({
      qualifier: ['public'],
      prefix: 'it',
      from: 21,
    })
    expect(completionTarget('select "My Schema"."Ta')).toEqual({
      qualifier: ['My Schema'],
      prefix: 'Ta',
      from: 19,
    })
  })

  test('gives an empty prefix after a space', () => {
    expect(completionTarget('select ')).toEqual({
      qualifier: [],
      prefix: '',
      from: 7,
    })
  })

  test('gives no target in a string or a comment', () => {
    expect(completionTarget("select 'from ta")).toBeNull()
    expect(completionTarget('select 1 -- from ta')).toBeNull()
    expect(completionTarget('select /* ta')).toBeNull()
    expect(completionTarget('select $$ta')).toBeNull()
    // A string that ends before the cursor does not stop the completion.
    expect(completionTarget("select 'x', ta")?.prefix).toBe('ta')
    expect(completionTarget('select 1 -- note\nfrom ta')?.prefix).toBe('ta')
  })
})

describe('statementAround', () => {
  test('returns the statement of the cursor', () => {
    const text = "select 1;\nselect 'a;b' from t;\nselect 3"

    expect(statementAround(text, 3)).toEqual({
      statement: 'select 1',
      start: 0,
    })
    expect(statementAround(text, 20)).toEqual({
      statement: "\nselect 'a;b' from t",
      start: 9,
    })
    expect(statementAround(text, text.length).statement).toBe('\nselect 3')
  })
})

test('quoteIfNecessary puts names with capitals or spaces in quotes', () => {
  expect(quoteIfNecessary('item_2')).toBe('item_2')
  expect(quoteIfNecessary('Item')).toBe('"Item"')
  expect(quoteIfNecessary('line item')).toBe('"line item"')
  expect(quoteIfNecessary('a"b')).toBe('"a""b"')
})

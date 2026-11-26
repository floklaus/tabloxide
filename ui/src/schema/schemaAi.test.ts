import { describe, expect, test, vi } from 'vitest'
import { firstRowsStatement } from './schemaAi'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)

describe('firstRowsStatement', () => {
  test('quotes the names of SQL, and doubles a quote in a name', () => {
    expect(
      firstRowsStatement({ schema: 'public', name: 'my "table"' }, 'sql'),
    ).toBe('select * from "public"."my ""table""" limit 100;')
  })

  test('uses the syntax of MongoDB for a collection', () => {
    expect(
      firstRowsStatement({ schema: 'shop', name: 'orders' }, 'mongodb-shell'),
    ).toBe('db.getSiblingDB("shop").getCollection("orders").find().limit(100)')
  })
})

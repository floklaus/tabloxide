import { describe, expect, test } from 'vitest'
import { planRequest } from './assistantSession'

describe('planRequest', () => {
  test('a MongoDB plan has the words and the tag of MongoDB', () => {
    const text = planRequest(
      'db.users.find()',
      '{}',
      true,
      false,
      'mongodb-shell',
    )

    expect(text).toContain('```mongodb\ndb.users.find()\n```')
    expect(text).toContain(
      'Plan from explain("executionStats") (measured times):',
    )
  })

  test('an SQL plan keeps EXPLAIN', () => {
    const text = planRequest('select 1', 'Seq Scan', false, false)

    expect(text).toContain('```sql\nselect 1\n```')
    expect(text).toContain('Plan from EXPLAIN (estimates only):')
  })
})

import { describe, expect, test } from 'vitest'
import { riskLabel } from './riskLabels'

describe('riskLabel', () => {
  test('uses the words of the query language', () => {
    expect(riskLabel('delete-without-where', 'sql')).toBe(
      'DELETE without WHERE removes all rows',
    )
    expect(riskLabel('delete-without-where', 'mongodb-shell')).toBe(
      'The statement deletes all documents of the collection',
    )
    expect(riskLabel('drop', 'mongodb-shell')).toContain('drops a collection')
    expect(riskLabel('unchecked', 'unknown')).toBe(
      'The application cannot check this statement',
    )
  })
})

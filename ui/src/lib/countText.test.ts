import { describe, expect, test } from 'vitest'
import { countText } from './countText'

describe('countText', () => {
  test('uses the singular for 1', () => {
    expect(countText(1, 'row')).toBe('1 row')
  })

  test('uses the plural for 0 and for more than 1', () => {
    expect(countText(0, 'row')).toBe('0 rows')
    expect(countText(15, 'row')).toBe('15 rows')
  })

  test('formats large numbers with separators', () => {
    expect(countText(1250, 'row')).toBe('1,250 rows')
  })

  test('accepts an irregular plural', () => {
    expect(countText(2, 'index', 'indexes')).toBe('2 indexes')
  })
})

import { describe, expect, test } from 'vitest'
import {
  compareValues,
  nextSort,
  rowsToTsv,
  sortedIndexes,
  type Column,
  type Row,
} from './gridModel'

const columns: Column[] = [
  { name: 'n', type_name: 'int4', kind: 'number' },
  { name: 't', type_name: 'text', kind: 'text' },
]

describe('nextSort', () => {
  test('goes from ascending to descending to no sort', () => {
    const first = nextSort(null, 1)
    const second = nextSort(first, 1)

    expect(first).toEqual({ column: 1, direction: 'asc' })
    expect(second).toEqual({ column: 1, direction: 'desc' })
    expect(nextSort(second, 1)).toBeNull()
  })

  test('starts with ascending on a different column', () => {
    expect(nextSort({ column: 0, direction: 'desc' }, 1)).toEqual({
      column: 1,
      direction: 'asc',
    })
  })
})

describe('compareValues', () => {
  test('compares numbers by value', () => {
    expect(compareValues('10', '9', 'number')).toBeGreaterThan(0)
    expect(compareValues('-1.5', '0.25', 'number')).toBeLessThan(0)
  })

  test('compares text by characters', () => {
    expect(compareValues('10', '9', 'text')).toBeLessThan(0)
  })

  test('uses the text sequence for a number column with other text', () => {
    expect(compareValues('$10.00', '$9.00', 'number')).toBeLessThan(0)
  })
})

describe('sortedIndexes', () => {
  const rows: Row[] = [
    ['10', 'b'],
    [null, 'a'],
    ['9', 'c'],
    ['9', 'a'],
  ]

  test('keeps the sequence without a sort', () => {
    expect(sortedIndexes(rows, columns, null)).toEqual([0, 1, 2, 3])
  })

  test('sorts ascending with NULL last and equal rows in sequence', () => {
    const sort = { column: 0, direction: 'asc' } as const

    expect(sortedIndexes(rows, columns, sort)).toEqual([2, 3, 0, 1])
  })

  test('sorts descending with NULL last', () => {
    const sort = { column: 0, direction: 'desc' } as const

    expect(sortedIndexes(rows, columns, sort)).toEqual([0, 2, 3, 1])
  })

  test('does not change the rows', () => {
    const copy = structuredClone(rows)

    sortedIndexes(rows, columns, { column: 1, direction: 'asc' })

    expect(rows).toEqual(copy)
  })
})

describe('rowsToTsv', () => {
  test('writes the selected columns with tabs and line ends', () => {
    const rows: Row[] = [
      ['1', 'a', 'x'],
      ['2', null, 'y'],
    ]

    expect(rowsToTsv(rows, [0, 1])).toBe('1\ta\n2\t')
  })

  test('replaces tabs and line ends in a value', () => {
    expect(rowsToTsv([['a\tb\nc']], [0])).toBe('a b c')
  })
})

import { describe, expect, test } from 'vitest'
import type { Row } from '../../results/gridModel'
import { column } from '../chart/testColumns'
import { profileColumns } from './profileData'

describe('profileColumns', () => {
  test('counts the empty cells and the different values of each column', () => {
    const rows: Row[] = [
      ['DE', '1'],
      ['DE', null],
      [null, '3'],
      ['FR', '3'],
    ]

    const [country, amount] = profileColumns(
      [column('country', 'text'), column('amount', 'number')],
      rows,
    )

    expect(country).toMatchObject({ filled: 3, empty: 1, distinct: 2 })
    expect(amount).toMatchObject({ filled: 3, empty: 1, distinct: 2 })
  })

  test('a number column has the smallest and the largest number, and a histogram with ranges of equal width', () => {
    const rows: Row[] = [0, 1, 2, 5, 9, 10, 100].map((value) => [String(value)])

    const [profile] = profileColumns([column('n', 'number')], rows)

    expect(profile).toMatchObject({
      min: '0',
      max: '100',
      barsKind: 'histogram',
    })
    expect(profile.bars).toHaveLength(10)
    expect(profile.bars[0]).toEqual({ label: '0 to 10', count: 5 })
    // The largest value is in the last range.
    expect(profile.bars.at(-1)).toEqual({ label: '90 to 100', count: 1 })
    expect(profile.bars[1]).toEqual({ label: '10 to 20', count: 1 })
  })

  test('the numbers compare as numbers, not as text', () => {
    const [profile] = profileColumns(
      [column('n', 'number')],
      [['9'], ['10'], ['-2.5']],
    )

    expect(profile).toMatchObject({ min: '-2.5', max: '10' })
  })

  test('a number column tells how many cells are not numbers', () => {
    const [profile] = profileColumns(
      [column('n', 'number')],
      [['1'], ['n/a'], ['3']],
    )

    expect(profile).toMatchObject({ notConverted: 1, min: '1', max: '3' })
  })

  test('a date column has the earliest and the latest date as the grid shows them', () => {
    const [profile] = profileColumns(
      [column('created', 'temporal')],
      [
        ['2026-03-05 10:00:00+00'],
        ['2026-01-01 08:30:00+00'],
        ['2026-03-01 00:00:00+00'],
      ],
    )

    expect(profile).toMatchObject({
      min: '2026-01-01 08:30:00+00',
      max: '2026-03-05 10:00:00+00',
      barsKind: 'histogram',
    })
    expect(profile.bars[0].label).toMatch(/^2026-01-01 to 2026-01-/)
    expect(profile.bars.reduce((total, bar) => total + bar.count, 0)).toBe(3)
  })

  test('a text column has its most frequent values, with the most frequent one first', () => {
    const rows: Row[] = ['b', 'a', 'c', 'a', 'c', 'c'].map((value) => [value])

    const [profile] = profileColumns([column('kind', 'text')], rows)

    expect(profile).toMatchObject({ min: 'a', max: 'c', barsKind: 'top' })
    expect(profile.bars).toEqual([
      { label: 'c', count: 3 },
      { label: 'a', count: 2 },
      { label: 'b', count: 1 },
    ])
  })

  test('a text column shows a maximum of five values', () => {
    const rows: Row[] = Array.from({ length: 20 }, (_, index) => [`v${index}`])

    const [profile] = profileColumns([column('kind', 'text')], rows)

    expect(profile.bars).toHaveLength(5)
    expect(profile.distinct).toBe(20)
  })

  test('a long value is cut', () => {
    const long = 'x'.repeat(200)

    const [profile] = profileColumns([column('note', 'text')], [[long]])

    expect(profile.min).toHaveLength(60)
    expect(profile.min?.endsWith('…')).toBe(true)
  })

  test('a column with only one value has one bar', () => {
    const [profile] = profileColumns([column('n', 'number')], [['7'], ['7']])

    expect(profile.bars).toEqual([{ label: '7 to 7', count: 2 }])
  })

  test('a column without values has no smallest value and no bars', () => {
    const [profile] = profileColumns([column('n', 'number')], [[null], [null]])

    expect(profile).toMatchObject({
      filled: 0,
      empty: 2,
      distinct: 0,
      min: null,
      max: null,
      bars: [],
    })
  })
})

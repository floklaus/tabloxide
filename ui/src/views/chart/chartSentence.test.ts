import { describe, expect, test } from 'vitest'
import type { Row } from '../../results/gridModel'
import { prepareChart } from './chartData'
import { chartSentence } from './chartSentence'
import type { ChartSettings } from './chartSettings'
import { column } from './testColumns'

const PAYMENTS = [
  column('paid', 'temporal'),
  column('staff', 'text'),
  column('amount', 'number'),
  column('tax', 'number'),
]
const ROWS: Row[] = [
  ['2026-01-15', 'Mike', '1', '0.1'],
  ['2026-01-20', 'Jon', '2', '0.2'],
  ['2026-02-03', 'Mike', '5', '0.5'],
]

function sentence(settings: ChartSettings) {
  return chartSentence(prepareChart(settings, PAYMENTS, ROWS), ROWS.length)
}

describe('chartSentence', () => {
  test('names the aggregate, the time unit, and the series column', () => {
    expect(
      sentence({
        type: 'line',
        x: 'paid',
        y: ['amount'],
        series: 'staff',
        timeUnit: 'month',
      }),
    ).toEqual({
      what: 'Sum of amount for each month of paid, one series for each value of staff.',
      size: '3 rows in 3 points.',
    })
  })

  test('says that each row is one mark when the chart does not combine rows', () => {
    expect(sentence({ type: 'line', x: 'paid', y: ['amount', 'tax'] })).toEqual(
      {
        what: 'amount and tax against paid, one point for each row.',
        size: '3 rows in 6 points.',
      },
    )
  })

  test('names the number of rows', () => {
    expect(
      sentence({ type: 'bar', x: 'staff', y: [], countRows: true }),
    ).toEqual({
      what: 'Number of rows for each staff.',
      size: '3 rows in 2 bars.',
    })
  })

  test('names an aggregate of the settings', () => {
    expect(
      sentence({ type: 'bar', x: 'staff', y: ['amount'], aggregate: 'mean' })
        ?.what,
    ).toBe('Mean of amount for each staff.')
  })

  test('names the aggregate of each column', () => {
    expect(
      sentence({
        type: 'bar',
        x: 'staff',
        y: ['amount', 'tax'],
        aggregates: { amount: 'sum', tax: 'mean' },
      })?.what,
    ).toBe('Sum of amount and mean of tax for each staff.')
  })

  test('puts columns with the same aggregate together', () => {
    expect(
      sentence({
        type: 'bar',
        x: 'staff',
        y: ['amount', 'tax'],
        aggregate: 'max',
      })?.what,
    ).toBe('Maximum of amount and tax for each staff.')
  })

  test('names the limit and the category "Other"', () => {
    expect(
      sentence({
        type: 'bar',
        x: 'staff',
        y: ['amount'],
        aggregate: 'sum',
        limit: 1,
        other: true,
      })?.what,
    ).toBe('Sum of amount for each staff, the first 1 and "Other".')
  })

  test('describes a histogram', () => {
    expect(sentence({ type: 'histogram', x: 'amount', y: [] })?.what).toBe(
      'Number of rows for each range of amount.',
    )
  })

  test('a single value has no sentence', () => {
    expect(sentence({ type: 'value', y: ['amount'] })).toBeNull()
  })
})

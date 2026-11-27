import { describe, expect, test } from 'vitest'
import {
  addToChart,
  CHART_COLUMN_ACTIONS,
  chartOfColumns,
} from './chartFromColumns'
import { column } from './testColumns'

const COLUMNS = [
  column('day', 'temporal'),
  column('country', 'text'),
  column('amount', 'number'),
  column('tax', 'number'),
  column('document', 'json'),
]
const ROWS = 20

describe('chartOfColumns', () => {
  test('the rules select the chart from only the selected columns', () => {
    expect(chartOfColumns(COLUMNS, ['country', 'amount'], ROWS)).toEqual({
      type: 'bar',
      x: 'country',
      y: ['amount'],
    })
    expect(chartOfColumns(COLUMNS, ['amount', 'day'], ROWS)).toEqual({
      type: 'line',
      x: 'day',
      y: ['amount'],
    })
  })

  test('one number column gives a histogram', () => {
    expect(chartOfColumns(COLUMNS, ['tax'], ROWS)).toEqual({
      type: 'histogram',
      x: 'tax',
      y: [],
    })
  })

  test('a column without a rule gives a count of the rows', () => {
    expect(chartOfColumns(COLUMNS, ['document'], ROWS)).toEqual({
      type: 'bar',
      x: 'document',
      y: [],
      countRows: true,
    })
  })
})

describe('addToChart', () => {
  const bar = { type: 'bar', x: 'country', y: ['amount'] }

  test('a number column goes to the vertical axis', () => {
    expect(addToChart(bar, COLUMNS, ['tax'], ROWS)).toEqual({
      ...bar,
      y: ['amount', 'tax'],
    })
  })

  test('a number column that is on the axis changes nothing', () => {
    expect(addToChart(bar, COLUMNS, ['amount'], ROWS)).toEqual(bar)
  })

  test('a date column becomes the horizontal axis', () => {
    expect(addToChart(bar, COLUMNS, ['day'], ROWS)).toEqual({
      ...bar,
      x: 'day',
    })
  })

  test('a text column becomes the series', () => {
    const line = { type: 'line', x: 'day', y: ['amount'] }

    expect(addToChart(line, COLUMNS, ['country'], ROWS)).toEqual({
      ...line,
      series: 'country',
    })
  })

  test('a number column replaces the number of rows', () => {
    const counts = { type: 'bar', x: 'country', y: [], countRows: true }

    expect(addToChart(counts, COLUMNS, ['amount'], ROWS)).toEqual(bar)
  })

  test('without chart settings, the columns go to the proposed chart', () => {
    const columns = [column('country', 'text'), column('amount', 'number')]

    expect(
      addToChart(
        undefined,
        [...columns, column('tax', 'number')],
        ['tax'],
        ROWS,
      ),
    ).toEqual({ type: 'bar', x: 'country', y: ['amount', 'tax'] })
  })

  test('a histogram becomes a bar chart, because it has no place for one more column', () => {
    const histogram = { type: 'histogram', x: 'amount', y: [] }

    expect(addToChart(histogram, COLUMNS, ['tax'], ROWS)).toEqual({
      type: 'bar',
      x: 'day',
      y: ['amount', 'tax'],
    })
  })
})

test('the labels of the actions name the column or give the number of columns', () => {
  const [chart, add] = CHART_COLUMN_ACTIONS

  expect(chart.label(['amount'])).toBe('Chart the column amount')
  expect(chart.label(['day', 'amount'])).toBe('Chart these 2 columns')
  expect(add.label(['amount'])).toBe('Add amount to the chart')
  expect(add.label(['day', 'amount'])).toBe('Add these 2 columns to the chart')
})

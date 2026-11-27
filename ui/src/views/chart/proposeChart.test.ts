import { describe, expect, test } from 'vitest'
import {
  chartScore,
  proposeChart,
  proposeCharts,
  suggestionLabel,
} from './proposeChart'
import { column } from './testColumns'

const MANY_ROWS = 20

describe('proposeChart', () => {
  test('one temporal column and number columns give a line chart', () => {
    const columns = [
      column('bucket', 'temporal'),
      column('temperature', 'number'),
      column('humidity', 'number'),
    ]

    expect(proposeChart(columns, MANY_ROWS)).toEqual({
      type: 'line',
      x: 'bucket',
      y: ['temperature', 'humidity'],
    })
  })

  test('a text column with one temporal and one number column divides the lines', () => {
    const columns = [
      column('day', 'temporal'),
      column('kind', 'text'),
      column('amount', 'number'),
    ]

    expect(proposeChart(columns, MANY_ROWS)).toEqual({
      type: 'line',
      x: 'day',
      y: ['amount'],
      series: 'kind',
    })
  })

  test('a line chart proposal has a maximum of four lines', () => {
    const columns = [
      column('day', 'temporal'),
      ...['a', 'b', 'c', 'd', 'e'].map((name) => column(name, 'number')),
    ]

    expect(proposeChart(columns, MANY_ROWS)?.y).toEqual(['a', 'b', 'c', 'd'])
  })

  test('one text column and one number column give a bar chart', () => {
    const columns = [column('country', 'text'), column('total', 'number')]

    expect(proposeChart(columns, MANY_ROWS)).toEqual({
      type: 'bar',
      x: 'country',
      y: ['total'],
    })
  })

  test('two number columns give a scatter plot', () => {
    const columns = [column('height', 'number'), column('weight', 'number')]

    expect(proposeChart(columns, MANY_ROWS)).toEqual({
      type: 'scatter',
      x: 'height',
      y: ['weight'],
    })
  })

  test('one number column gives a histogram', () => {
    expect(proposeChart([column('age', 'number')], MANY_ROWS)).toEqual({
      type: 'histogram',
      x: 'age',
      y: [],
    })
  })

  test('one row with one number gives a single value', () => {
    expect(proposeChart([column('count', 'number')], 1)).toEqual({
      type: 'value',
      y: ['count'],
    })
  })

  test('a result without a number column gives a bar chart of the number of rows', () => {
    const columns = [column('country', 'text'), column('city', 'text')]

    expect(proposeChart(columns, MANY_ROWS)).toEqual({
      type: 'bar',
      x: 'country',
      y: [],
      countRows: true,
    })
  })

  test('columns that fit no rule give no proposal', () => {
    const columns = [column('a', 'json'), column('b', 'json')]

    expect(proposeChart(columns, MANY_ROWS)).toBeNull()
  })
})

describe('chartScore', () => {
  test('a result that fits a rule has the best score', () => {
    expect(
      chartScore([column('country', 'text'), column('total', 'number')]),
    ).toBe(1)
  })

  test('a result without a proposal has a lower score, because the user must select the columns', () => {
    const score = chartScore([column('document', 'json')])

    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
  })

  test('a result without columns hides the chart view', () => {
    expect(chartScore([])).toBe(0)
  })
})

describe('proposeCharts', () => {
  const labels = (columns: Parameters<typeof proposeCharts>[0]) =>
    proposeCharts(columns, MANY_ROWS).map(suggestionLabel)

  test('a date, a text, and a number column give four charts, with the line for each series first', () => {
    const columns = [
      column('day', 'temporal'),
      column('kind', 'text'),
      column('amount', 'number'),
    ]

    expect(labels(columns)).toEqual([
      'Line: amount by day, for each kind',
      'Line: amount by day',
      'Bar: amount by kind',
      'Histogram of amount',
    ])
  })

  test('a text column and two number columns give a bar chart first', () => {
    const columns = [
      column('country', 'text'),
      column('amount', 'number'),
      column('tax', 'number'),
    ]

    expect(labels(columns)).toEqual([
      'Bar: amount by country',
      'Scatter: tax by amount',
      'Histogram of amount',
      'Bar: number of rows by country',
    ])
  })

  test('only text columns give one count for each column', () => {
    expect(labels([column('country', 'text'), column('city', 'text')])).toEqual(
      ['Bar: number of rows by country', 'Bar: number of rows by city'],
    )
  })

  test('a date column without a number gives the number of rows for each day', () => {
    expect(proposeCharts([column('created', 'temporal')], MANY_ROWS)).toEqual([
      { type: 'line', x: 'created', y: [], countRows: true, timeUnit: 'day' },
    ])
    expect(labels([column('created', 'temporal')])).toEqual([
      'Line: number of rows by day of created',
    ])
  })

  test('the list has a maximum of four charts', () => {
    const columns = [
      column('day', 'temporal'),
      column('kind', 'text'),
      column('a', 'number'),
      column('b', 'number'),
    ]

    expect(proposeCharts(columns, MANY_ROWS)).toHaveLength(4)
  })

  test('one row with one number gives the single value first', () => {
    expect(
      proposeCharts([column('count', 'number')], 1).map(suggestionLabel),
    ).toEqual(['Single value: count', 'Histogram of count'])
  })
})

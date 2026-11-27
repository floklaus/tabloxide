import { describe, expect, test } from 'vitest'
import {
  incompleteReason,
  missingColumns,
  normalize,
  parseChartSettings,
  withType,
} from './chartSettings'
import { column } from './testColumns'

describe('parseChartSettings', () => {
  test('reads the settings of the design document', () => {
    const value = { type: 'line', x: 'day', y: ['amount'], series: 'kind' }

    const parsed = parseChartSettings(value)

    expect(parsed).toEqual({ settings: value })
  })

  test('refuses a chart type that it does not know', () => {
    const parsed = parseChartSettings({ type: 'sankey', y: [] })

    expect(parsed).toEqual({ error: 'The chart type "sankey" is not known.' })
  })

  test.each([
    [{ type: 'bar', x: 1, y: [] }, '"x"'],
    [{ type: 'bar', y: 'amount' }, '"y"'],
    [{ type: 'bar', y: [1] }, '"y"'],
    [{ type: 'bar', y: [], series: {} }, '"series"'],
    [{ type: 'bar', y: [], aggregate: 'median' }, 'aggregate'],
    [{ type: 'bar', y: [], stacked: 'yes' }, '"stacked"'],
    [{ type: 'bar', y: [], scale: 'sqrt' }, 'scale'],
    ['line', 'not an object'],
  ])('refuses %j', (value, part) => {
    const parsed = parseChartSettings(value)

    expect('error' in parsed && parsed.error).toContain(part)
  })

  test('accepts settings without "y", for example of a histogram', () => {
    const parsed = parseChartSettings({ type: 'histogram', x: 'age' })

    expect(parsed).toEqual({
      settings: { type: 'histogram', x: 'age', y: [] },
    })
  })
})

describe('normalize', () => {
  test('removes the parts that the chart type does not use', () => {
    const settings = normalize({
      type: 'histogram',
      x: 'age',
      y: ['amount'],
      series: 'kind',
      aggregate: 'sum',
      stacked: true,
      scale: 'log',
    })

    expect(settings).toEqual({ type: 'histogram', x: 'age', y: [] })
  })

  test('keeps only the first column of a single value', () => {
    const settings = normalize({ type: 'value', x: 'day', y: ['a', 'b'] })

    expect(settings).toEqual({ type: 'value', y: ['a'] })
  })

  test('removes the default values', () => {
    const settings = normalize({
      type: 'bar',
      x: 'kind',
      y: ['amount'],
      stacked: false,
      scale: 'linear',
    })

    expect(settings).toEqual({ type: 'bar', x: 'kind', y: ['amount'] })
  })
})

test('missingColumns gives each column of the settings that the result does not have', () => {
  const columns = [column('day', 'temporal'), column('amount', 'number')]

  const missing = missingColumns(
    { type: 'line', x: 'day', y: ['amount', 'tax', 'tax'], series: 'kind' },
    columns,
  )

  expect(missing).toEqual(['tax', 'kind'])
})

describe('incompleteReason', () => {
  test('asks for the horizontal axis first', () => {
    expect(incompleteReason({ type: 'bar', y: [] })).toBe(
      'Select the column of the horizontal axis.',
    )
  })

  test('asks for a column of the vertical axis', () => {
    expect(incompleteReason({ type: 'bar', x: 'kind', y: [] })).toBe(
      'Select a column of the vertical axis.',
    )
  })

  test('a histogram needs only its column', () => {
    expect(incompleteReason({ type: 'histogram', x: 'age', y: [] })).toBeNull()
  })

  test('a single value needs only its column', () => {
    expect(incompleteReason({ type: 'value', y: ['total'] })).toBeNull()
  })
})

describe('withType', () => {
  const columns = [
    column('country', 'text'),
    column('amount', 'number'),
    column('tax', 'number'),
  ]

  test('a change from a bar chart to a line chart keeps the columns', () => {
    const settings = withType(
      { type: 'bar', x: 'country', y: ['amount'], series: 'tax' },
      'line',
      columns,
    )

    expect(settings).toEqual({
      type: 'line',
      x: 'country',
      y: ['amount'],
      series: 'tax',
    })
  })

  test('a histogram gets the first column of the vertical axis', () => {
    const settings = withType(
      { type: 'bar', x: 'country', y: ['tax', 'amount'] },
      'histogram',
      columns,
    )

    expect(settings).toEqual({ type: 'histogram', x: 'tax', y: [] })
  })

  test('the column of a histogram becomes the vertical axis of a bar chart', () => {
    const settings = withType(
      { type: 'histogram', x: 'tax', y: [] },
      'bar',
      columns,
    )

    expect(settings).toEqual({ type: 'bar', x: 'country', y: ['tax'] })
  })

  test('a single value keeps one column', () => {
    const settings = withType(
      { type: 'bar', x: 'country', y: ['amount', 'tax'], stacked: true },
      'value',
      columns,
    )

    expect(settings).toEqual({ type: 'value', y: ['amount'] })
  })

  test('a result without a number column gives settings that are not complete', () => {
    const settings = withType({ type: 'bar', y: [] }, 'histogram', [
      column('name', 'text'),
    ])

    expect(settings).toEqual({ type: 'histogram', y: [] })
  })
})

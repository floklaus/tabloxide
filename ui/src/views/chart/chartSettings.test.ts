import { describe, expect, test } from 'vitest'
import {
  axisControls,
  incompleteReason,
  missingColumns,
  normalize,
  parseChartSettings,
  withType,
  withX,
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

describe('the settings of step 1 of the input design', () => {
  test('parseChartSettings reads the number of rows, the time unit, the sort, and the aggregate None', () => {
    const value = {
      type: 'bar',
      x: 'paid',
      y: ['amount'],
      aggregate: 'none',
      timeUnit: 'month',
      sort: 'value-desc',
    }

    expect(parseChartSettings(value)).toEqual({ settings: value })
    expect(
      parseChartSettings({ type: 'bar', x: 'country', countRows: true }),
    ).toEqual({
      settings: { type: 'bar', x: 'country', y: [], countRows: true },
    })
  })

  test.each([
    [{ type: 'bar', y: [], countRows: 'yes' }, '"countRows"'],
    [{ type: 'bar', y: [], timeUnit: 'decade' }, 'time unit'],
    [{ type: 'bar', y: [], sort: 'random' }, 'sort'],
  ])('parseChartSettings refuses %j', (value, part) => {
    const parsed = parseChartSettings(value)

    expect('error' in parsed && parsed.error).toContain(part)
  })

  test('the number of rows has no column and no aggregate', () => {
    const settings = normalize({
      type: 'bar',
      x: 'country',
      y: ['amount'],
      countRows: true,
      aggregate: 'mean',
    })

    expect(settings).toEqual({
      type: 'bar',
      x: 'country',
      y: [],
      countRows: true,
    })
  })

  test('a chart of the number of rows is complete without a column of the vertical axis', () => {
    expect(
      incompleteReason({ type: 'bar', x: 'country', y: [], countRows: true }),
    ).toBeNull()
  })

  test('a scatter plot cannot count rows, group dates, or sort', () => {
    const settings = normalize({
      type: 'scatter',
      x: 'a',
      y: ['b'],
      countRows: true,
      timeUnit: 'day',
      sort: 'name',
    })

    expect(settings).toEqual({ type: 'scatter', x: 'a', y: ['b'] })
  })
})

describe('the controls of the horizontal axis', () => {
  const columns = [
    column('paid', 'temporal'),
    column('country', 'text'),
    column('year', 'number'),
    column('amount', 'number'),
  ]
  const line = (x: string) => ({ type: 'line' as const, x, y: ['amount'] })

  test('a date column has a time unit', () => {
    expect(axisControls(line('paid'), columns)).toEqual({
      timeUnit: true,
      sort: false,
    })
  })

  test('a text column has a sort', () => {
    expect(axisControls(line('country'), columns)).toEqual({
      timeUnit: false,
      sort: true,
    })
  })

  test('a number column has a sort only in a bar chart, where it gives categories', () => {
    expect(axisControls(line('year'), columns).sort).toBe(false)
    expect(
      axisControls({ type: 'bar', x: 'year', y: ['amount'] }, columns).sort,
    ).toBe(true)
  })

  test('withX removes the time unit when the new column is not a date', () => {
    const settings = withX(
      { ...line('paid'), timeUnit: 'month' },
      'country',
      columns,
    )

    expect(settings).toEqual({ type: 'line', x: 'country', y: ['amount'] })
  })

  test('withType keeps the number of rows and removes a sort that the type cannot use', () => {
    const settings = withType(
      { type: 'bar', x: 'year', y: [], countRows: true, sort: 'name' },
      'line',
      columns,
    )

    expect(settings).toEqual({
      type: 'line',
      x: 'year',
      y: [],
      countRows: true,
    })
  })
})

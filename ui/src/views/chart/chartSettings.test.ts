import { describe, expect, test } from 'vitest'
import {
  aggregateOf,
  axisControls,
  incompleteReason,
  missingColumns,
  normalize,
  parseChartSettings,
  typeProblem,
  withAggregate,
  withEachRow,
  withKind,
  withLimit,
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
    const parsed = parseChartSettings({ type: 'gantt', y: [] })

    expect(parsed).toEqual({ error: 'The chart type "gantt" is not known.' })
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

    expect(parseChartSettings(value)).toEqual({
      settings: {
        type: 'bar',
        x: 'paid',
        y: ['amount'],
        aggregates: { amount: 'none' },
        timeUnit: 'month',
        sort: 'value-desc',
      },
    })
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

describe('an aggregate for each column', () => {
  const settings = {
    type: 'bar' as const,
    x: 'country',
    y: ['amount', 'tax'],
  }

  test('parseChartSettings reads the aggregates by column name', () => {
    const value = { ...settings, aggregates: { amount: 'sum', tax: 'none' } }

    expect(parseChartSettings(value)).toEqual({ settings: value })
  })

  test('parseChartSettings refuses an aggregate that it does not know', () => {
    const parsed = parseChartSettings({
      ...settings,
      aggregates: { amount: 'median' },
    })

    expect('error' in parsed && parsed.error).toContain('"aggregates"')
  })

  test('an aggregate for all columns of a file of the first form becomes one entry for each column', () => {
    expect(normalize({ ...settings, aggregate: 'mean' })).toEqual({
      ...settings,
      aggregates: { amount: 'mean', tax: 'mean' },
    })
  })

  test('normalize removes the aggregate of a column that is not on the vertical axis', () => {
    expect(
      normalize({ ...settings, y: ['tax'], aggregates: { amount: 'sum' } }),
    ).toEqual({ ...settings, y: ['tax'] })
  })

  test('withAggregate sets and removes the aggregate of one column', () => {
    const withSum = withAggregate(settings, 'tax', 'sum')
    const again = withAggregate(withSum, 'tax', undefined)

    expect(withSum.aggregates).toEqual({ tax: 'sum' })
    expect(aggregateOf(withSum, 'amount')).toBeUndefined()
    expect(again).toEqual(settings)
  })

  test('withEachRow sets None for the columns that let the chart decide', () => {
    const result = withEachRow({ ...settings, aggregates: { tax: 'max' } })

    expect(result.aggregates).toEqual({ amount: 'none', tax: 'max' })
  })
})

describe('typeProblem', () => {
  const text = [column('country', 'text'), column('city', 'text')]

  test('a histogram and a scatter plot need a number column', () => {
    expect(typeProblem('histogram', text)).toBe(
      'A histogram needs a number column. This result has none.',
    )
    expect(typeProblem('scatter', text)).toContain('needs a number column')
  })

  test('a scatter plot needs two columns', () => {
    expect(typeProblem('scatter', [column('n', 'number')])).toBe(
      'A scatter plot needs 2 columns. This result has 1.',
    )
  })

  test('the other types can count rows, thus they have no problem', () => {
    for (const type of ['line', 'area', 'bar', 'value'] as const) {
      expect(typeProblem(type, text)).toBeNull()
    }
  })
})

describe('the limit and the kind of a column', () => {
  const bar = { type: 'bar' as const, x: 'country', y: ['amount'] }
  const columns = [
    column('country', 'text'),
    column('year', 'number'),
    column('created', 'text'),
    column('amount', 'number'),
  ]

  test('parseChartSettings reads the limit, "other", and the kinds', () => {
    const value = {
      ...bar,
      sort: 'value-desc',
      limit: 10,
      other: true,
      kinds: { country: 'text' },
    }

    expect(parseChartSettings(value)).toEqual({ settings: value })
  })

  test.each([
    [{ ...bar, limit: 0 }, '"limit"'],
    [{ ...bar, limit: 2.5 }, '"limit"'],
    [{ ...bar, limit: 5000 }, '"limit"'],
    [{ ...bar, limit: 5, other: 'yes' }, '"other"'],
    [{ ...bar, kinds: { country: 'json' } }, '"kinds"'],
  ])('parseChartSettings refuses %j', (value, part) => {
    const parsed = parseChartSettings(value)

    expect('error' in parsed && parsed.error).toContain(part)
  })

  test('normalize removes "other" without a limit, and the kind of a column that is not the horizontal axis', () => {
    expect(
      normalize({ ...bar, other: true, kinds: { amount: 'text' } }),
    ).toEqual(bar)
  })

  test('a new limit also sets the sort by value and "Other"', () => {
    expect(withLimit(bar, 10)).toEqual({
      ...bar,
      sort: 'value-desc',
      limit: 10,
      other: true,
    })
  })

  test('a change of the limit keeps the sort and the choice for "Other"', () => {
    const settings = { ...bar, sort: 'name' as const, limit: 10 }

    expect(withLimit(settings, 20)).toEqual({ ...settings, limit: 20 })
    expect(withLimit(settings, undefined)).toEqual({ ...bar, sort: 'name' })
  })

  test('a number column as a category has a sort in a line chart', () => {
    const line = { type: 'line' as const, x: 'year', y: ['amount'] }

    const settings = withKind(line, 'text', columns)

    expect(settings.kinds).toEqual({ year: 'text' })
    expect(axisControls(settings, columns)).toEqual({
      timeUnit: false,
      sort: true,
    })
  })

  test('a text column as a date has a time unit, and loses its sort and its limit', () => {
    const settings = withKind(
      { type: 'line', x: 'created', y: ['amount'], sort: 'name', limit: 5 },
      'temporal',
      columns,
    )

    expect(settings).toEqual({
      type: 'line',
      x: 'created',
      y: ['amount'],
      kinds: { created: 'temporal' },
    })
    expect(axisControls(settings, columns).timeUnit).toBe(true)
  })

  test('a different column of the horizontal axis removes the kind of the old one', () => {
    const settings = withX(
      { ...bar, kinds: { country: 'text' } },
      'year',
      columns,
    )

    expect(settings.kinds).toBeUndefined()
  })
})

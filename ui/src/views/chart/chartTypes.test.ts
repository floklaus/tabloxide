import { describe, expect, test } from 'vitest'
import type { Row } from '../../results/gridModel'
import { prepareChart } from './chartData'
import { chartSentence } from './chartSentence'
import {
  CHART_ROLES,
  CHART_TYPE_LABELS,
  CHART_TYPES,
  incompleteReason,
  normalize,
  parseChartSettings,
  roleLabels,
  typeProblem,
  withType,
  type ChartSettings,
} from './chartSettings'
import { chartSummary } from './chartSummary'
import { proposeCharts, suggestionLabel } from './proposeChart'
import { column } from './testColumns'

const SALES = [
  column('day', 'temporal'),
  column('country', 'text'),
  column('kind', 'text'),
  column('amount', 'number'),
  column('tax', 'number'),
  column('items', 'number'),
]

describe('the catalog of chart types', () => {
  test('has 18 types, each with a name and with roles', () => {
    expect(CHART_TYPES).toHaveLength(18)
    for (const type of CHART_TYPES) {
      expect(CHART_TYPE_LABELS[type]).toBeTruthy()
      expect(CHART_ROLES[type]).toBeDefined()
    }
  })

  test('a chart type has its own names for the parts of the settings', () => {
    expect(roleLabels('bar')).toEqual({
      x: 'Horizontal axis',
      y: 'Vertical axis',
      series: 'Series',
    })
    expect(roleLabels('sankey')).toEqual({
      x: 'Source',
      y: 'Value',
      series: 'Target',
    })
    expect(roleLabels('heatmap').series).toBe('Rows')
  })
})

describe('typeProblem for the new types', () => {
  const text = [column('country', 'text'), column('city', 'text')]

  test.each([
    ['boxplot', 'A box plot needs a number column. This result has none.'],
    ['bubble', 'A bubble chart needs 2 number columns. This result has none.'],
    [
      'parallel',
      'Parallel coordinates need 2 number columns. This result has none.',
    ],
    [
      'candlestick',
      'A candlestick chart needs 4 number columns. This result has none.',
    ],
    [
      'calendar',
      'A calendar heat map needs a date column. This result has none.',
    ],
  ] as const)('%s', (type, problem) => {
    expect(typeProblem(type, text)).toBe(problem)
  })

  test('a heat map and a Sankey diagram need two columns', () => {
    const one = [column('country', 'text')]

    expect(typeProblem('heatmap', one)).toBe(
      'A heat map needs 2 columns. This result has 1.',
    )
    expect(typeProblem('sankey', one)).toContain('needs 2 columns')
  })

  test('the types that can count rows have no problem with text columns', () => {
    for (const type of [
      'pie',
      'funnel',
      'treemap',
      'sunburst',
      'radar',
    ] as const) {
      expect(typeProblem(type, text)).toBeNull()
    }
  })
})

describe('the settings of the new types', () => {
  test('parseChartSettings reads the size column of a bubble chart', () => {
    const value = { type: 'bubble', x: 'amount', y: ['tax'], size: 'items' }

    expect(parseChartSettings(value)).toEqual({ settings: value })
    expect('error' in parseChartSettings({ ...value, size: 3 })).toBe(true)
  })

  test('only a bubble chart keeps the size column', () => {
    expect(
      normalize({ type: 'scatter', x: 'amount', y: ['tax'], size: 'items' }),
    ).toEqual({ type: 'scatter', x: 'amount', y: ['tax'] })
  })

  test.each([
    [
      { type: 'heatmap', x: 'country', y: ['amount'] },
      'Select the column for "Rows".',
    ],
    [
      { type: 'sankey', y: ['amount'], series: 'kind' },
      'Select the column for "Source".',
    ],
    [
      { type: 'bubble', x: 'amount', y: ['tax'] },
      'Select the column for the size of the bubbles.',
    ],
    [
      { type: 'candlestick', x: 'day', y: ['amount', 'tax'] },
      'Select four columns in this sequence: open, high, low, close.',
    ],
    [
      { type: 'parallel', y: ['amount'] },
      'Select two or more columns for the axes.',
    ],
    [{ type: 'pie', x: 'country', y: [] }, 'Select the column for "Value".'],
  ] as [ChartSettings, string][])(
    'incompleteReason of %j',
    (settings, reason) => {
      expect(incompleteReason(settings)).toBe(reason)
    },
  )

  test('a box plot is complete without a category column', () => {
    expect(incompleteReason({ type: 'boxplot', y: ['amount'] })).toBeNull()
  })
})

describe('a change to a new chart type gives the columns that it needs', () => {
  const bar: ChartSettings = { type: 'bar', x: 'country', y: ['amount'] }

  test('a heat map gets a second group that is not a number', () => {
    expect(withType(bar, 'heatmap', SALES)).toEqual({
      type: 'heatmap',
      x: 'country',
      y: ['amount'],
      series: 'day',
    })
  })

  test('a bubble chart gets a size column that the axes do not use', () => {
    const scatter: ChartSettings = { type: 'scatter', x: 'amount', y: ['tax'] }

    expect(withType(scatter, 'bubble', SALES)).toEqual({
      type: 'bubble',
      x: 'amount',
      y: ['tax'],
      size: 'items',
    })
  })

  test('parallel coordinates get the number columns as axes', () => {
    expect(withType(bar, 'parallel', SALES)).toEqual({
      type: 'parallel',
      y: ['amount', 'tax', 'items'],
    })
  })

  test('a candlestick chart gets the columns with the usual names and a date axis', () => {
    const prices = [
      column('day', 'temporal'),
      column('Close', 'number'),
      column('Open', 'number'),
      column('Low', 'number'),
      column('High', 'number'),
    ]

    expect(
      withType({ type: 'line', x: 'day', y: ['Close'] }, 'candlestick', prices),
    ).toEqual({
      type: 'candlestick',
      x: 'day',
      y: ['Open', 'High', 'Low', 'Close'],
    })
  })

  test('a calendar gets the date column', () => {
    expect(withType(bar, 'calendar', SALES)).toEqual({
      type: 'calendar',
      x: 'day',
      y: ['amount'],
    })
  })

  test('a pie chart starts with the 10 largest slices and "Other"', () => {
    expect(withType(bar, 'pie', SALES)).toEqual({
      type: 'pie',
      x: 'country',
      y: ['amount'],
      sort: 'value-desc',
      limit: 10,
      other: true,
    })
  })

  test('a box plot does not use a number column for its categories', () => {
    const scatter: ChartSettings = { type: 'scatter', x: 'tax', y: ['amount'] }

    expect(withType(scatter, 'boxplot', SALES)).toEqual({
      type: 'boxplot',
      x: 'country',
      y: ['amount'],
    })
  })
})

describe('the suggestions for the new types', () => {
  const labels = (columns: Parameters<typeof proposeCharts>[0]) =>
    proposeCharts(columns, 20).map(suggestionLabel)

  test('columns with the names open, high, low, and close give a candlestick chart first', () => {
    const prices = [
      column('day', 'temporal'),
      column('open', 'number'),
      column('high', 'number'),
      column('low', 'number'),
      column('close', 'number'),
    ]

    expect(labels(prices)[0]).toBe('Candlestick by day')
    expect(proposeCharts(prices, 20)[0]).toEqual({
      type: 'candlestick',
      x: 'day',
      y: ['open', 'high', 'low', 'close'],
    })
  })

  test('two text columns and number columns give a heat map and a bubble chart', () => {
    const columns = SALES.filter((item) => item.name !== 'day')

    expect(labels(columns)).toEqual([
      'Bar: amount by country',
      'Scatter: tax by amount',
      'Heat map: amount by country and kind',
      'Bubble: tax by amount, size from items',
    ])
  })
})

describe('the sentence and the summary of the new types', () => {
  const ROWS: Row[] = [
    ['2026-03-01', 'DE', 'card', '10', '1', '2'],
    ['2026-03-02', 'DE', 'cash', '20', '2', '4'],
    ['2026-03-02', 'FR', 'card', '5', '3', '6'],
  ]
  const what = (settings: ChartSettings) =>
    chartSentence(prepareChart(settings, SALES, ROWS), ROWS.length)

  test('a heat map names its two groups', () => {
    expect(
      what({ type: 'heatmap', x: 'country', y: ['amount'], series: 'kind' }),
    ).toEqual({
      what: 'amount for each country and each kind, one cell for each row.',
      size: '3 rows in 3 cells.',
    })
  })

  test('a Sankey diagram names the source and the target', () => {
    expect(
      what({ type: 'sankey', x: 'country', y: ['amount'], series: 'kind' })
        ?.what,
    ).toBe('amount from each country to each kind, one link for each row.')
  })

  test('a pie chart with repeated categories names the sum and its slices', () => {
    expect(what({ type: 'pie', x: 'country', y: ['amount'] })).toEqual({
      what: 'Sum of amount for each country.',
      size: '3 rows in 2 slices.',
    })
  })

  test('a bubble chart names the size column', () => {
    expect(
      what({ type: 'bubble', x: 'amount', y: ['tax'], size: 'items' })?.what,
    ).toBe(
      'tax against amount, with the size from items, one bubble for each row.',
    )
  })

  test('a box plot names the distribution and its boxes', () => {
    expect(what({ type: 'boxplot', x: 'country', y: ['amount'] })).toEqual({
      what: 'Distribution of amount for each country.',
      size: '3 rows in 2 boxes.',
    })
    expect(what({ type: 'boxplot', y: ['amount'] })).toEqual({
      what: 'Distribution of amount.',
      size: '3 rows in 1 box.',
    })
  })

  test('parallel coordinates name their axes and the colour column', () => {
    expect(
      what({ type: 'parallel', y: ['amount', 'tax', 'items'], series: 'kind' }),
    ).toEqual({
      what: 'amount, tax and items of each row, one colour for each value of kind.',
      size: '3 rows in 3 lines.',
    })
  })

  test('a calendar names the day', () => {
    expect(what({ type: 'calendar', x: 'day', y: ['amount'] })?.what).toBe(
      'Sum of amount for each day of day.',
    )
  })

  test('the text for a screen reader has the chart type and the sentence', () => {
    const chart = prepareChart(
      { type: 'pie', x: 'country', y: ['amount'] },
      SALES,
      ROWS,
    )

    expect(chartSummary(chart, ROWS.length)).toBe(
      'Pie chart. Sum of amount for each country. 3 rows in 2 slices. The Grid view has the values.',
    )
  })
})

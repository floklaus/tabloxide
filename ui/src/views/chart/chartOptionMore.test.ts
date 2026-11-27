import { describe, expect, test } from 'vitest'
import type { Row } from '../../results/gridModel'
import { prepareChart, type DrawnChart } from './chartData'
import { drawOption } from './chartOptionMore'
import type { ChartSettings } from './chartSettings'
import type { ChartTheme } from './chartTheme'
import { column } from './testColumns'

const THEME: ChartTheme = {
  background: '#ffffff',
  surface: '#f4f5f7',
  text: '#1b1f27',
  textMuted: '#5b6472',
  border: '#d5d9e0',
  series: ['#111111', '#222222', '#333333'],
  ramp: ['#cce3fd', '#0e3d7e'],
  font: 'system-ui',
  isHighContrast: false,
}

const SALES = [
  column('country', 'text'),
  column('kind', 'text'),
  column('amount', 'number'),
  column('tax', 'number'),
]
const ROWS: Row[] = [
  ['DE', 'card', '10', '1'],
  ['DE', 'cash', '20', '2'],
  ['FR', 'card', '5', '3'],
]

type Option = Record<string, unknown> & {
  series: Record<string, unknown>[]
  aria: { decal: { show: boolean } }
}

/** Makes the description of the chart of the settings, as the chart view does. */
function option(
  settings: ChartSettings,
  rows = ROWS,
  columns = SALES,
  theme = THEME,
): Option {
  const chart = prepareChart(settings, columns, rows)
  if (chart.kind === 'empty' || chart.kind === 'value') {
    throw new Error(`no chart: ${chart.kind}`)
  }
  return drawOption(chart satisfies DrawnChart, settings, {
    theme,
    canAnimate: true,
  }) as unknown as Option
}

describe('the parts of a whole', () => {
  test('a pie chart has one slice for each category, with its name', () => {
    const result = option({ type: 'pie', x: 'country', y: ['amount'] })

    expect(result.series[0]).toMatchObject({
      type: 'pie',
      data: [
        { name: 'DE', value: 30 },
        { name: 'FR', value: 5 },
      ],
    })
  })

  test('the slice "Other" has a neutral colour', () => {
    const result = option({
      type: 'pie',
      x: 'country',
      y: ['amount'],
      sort: 'value-desc',
      limit: 1,
      other: true,
    })

    expect(result.series[0].data).toEqual([
      { name: 'DE', value: 30 },
      { name: 'Other', value: 5, itemStyle: { color: THEME.textMuted } },
    ])
  })

  test('a part of a whole cannot be zero or negative', () => {
    const result = option({ type: 'pie', x: 'country', y: ['amount'] }, [
      ['DE', 'card', '10', null],
      ['FR', 'card', '-5', null],
      ['IT', 'card', '0', null],
    ])

    expect(result.series[0].data).toEqual([{ name: 'DE', value: 10 }])
  })

  test('a funnel keeps the sequence of its stages and has one colour', () => {
    const result = option({ type: 'funnel', x: 'country', y: ['amount'] })

    expect(result.series[0]).toMatchObject({ type: 'funnel', sort: 'none' })
    expect(result.color).toEqual([THEME.series[0]])
  })

  test('a tree map and a sunburst chart have the subgroups below their group', () => {
    const tree = [
      {
        name: 'DE',
        children: [
          { name: 'card', value: 10 },
          { name: 'cash', value: 20 },
        ],
      },
      { name: 'FR', children: [{ name: 'card', value: 5 }] },
    ]
    const settings = { x: 'country', y: ['amount'], series: 'kind' }

    expect(option({ type: 'treemap', ...settings }).series[0]).toMatchObject({
      type: 'treemap',
      data: tree,
    })
    expect(option({ type: 'sunburst', ...settings }).series[0]).toMatchObject({
      type: 'sunburst',
      data: tree,
    })
  })

  test('a tree map without a subgroup column has one level', () => {
    const result = option({ type: 'treemap', x: 'country', y: ['amount'] })

    expect(result.series[0].data).toEqual([
      { name: 'DE', value: 30 },
      { name: 'FR', value: 5 },
    ])
  })
})

describe('charts with a colour scale', () => {
  const heatmap: ChartSettings = {
    type: 'heatmap',
    x: 'country',
    y: ['amount'],
    series: 'kind',
  }

  test('a heat map has one cell for each value, and a scale from the lowest to the highest value', () => {
    const result = option(heatmap)

    expect(result.series[0]).toMatchObject({
      type: 'heatmap',
      // The column, the row, and the value.
      data: [
        [0, 0, 10],
        [1, 0, 5],
        [0, 1, 20],
      ],
    })
    expect(result.xAxis).toMatchObject({ data: ['DE', 'FR'], name: 'country' })
    expect(result.yAxis).toMatchObject({ data: ['card', 'cash'], name: 'kind' })
    expect(result.visualMap).toMatchObject({
      min: 5,
      max: 20,
      inRange: { color: THEME.ramp },
    })
  })

  test('a heat map has no zoom, because ECharts then gives an error after the chart is gone', () => {
    expect(option(heatmap)).not.toHaveProperty('dataZoom')
  })

  test('a chart with a colour scale has no patterns in the high contrast theme', () => {
    const highContrast = { ...THEME, isHighContrast: true }

    expect(option(heatmap, ROWS, SALES, highContrast).aria.decal.show).toBe(
      false,
    )
    expect(
      option(
        { type: 'pie', x: 'country', y: ['amount'] },
        ROWS,
        SALES,
        highContrast,
      ).aria.decal.show,
    ).toBe(true)
  })

  test('a scale with one value has two different ends', () => {
    const result = option(heatmap, [['DE', 'card', '7', null]])

    expect(result.visualMap).toMatchObject({ min: 7, max: 8 })
  })

  test('a calendar has one part for each year, and a week starts on Monday', () => {
    const result = option(
      { type: 'calendar', x: 'day', y: ['orders'] },
      [
        ['2025-12-31', '4'],
        ['2026-01-01', '6'],
      ],
      [column('day', 'temporal'), column('orders', 'number')],
    )

    expect(result.calendar).toMatchObject([
      { range: '2025', dayLabel: { firstDay: 1 } },
      { range: '2026' },
    ])
    expect(result.series).toMatchObject([
      {
        coordinateSystem: 'calendar',
        calendarIndex: 0,
        data: [['2025-12-31', 4]],
      },
      {
        coordinateSystem: 'calendar',
        calendarIndex: 1,
        data: [['2026-01-01', 6]],
      },
    ])
  })
})

describe('relations', () => {
  test('a radar chart has one axis for each category, all with the same scale', () => {
    const result = option({
      type: 'radar',
      x: 'country',
      y: ['amount'],
      aggregate: 'sum',
    })

    expect(result.radar).toMatchObject({
      indicator: [
        { name: 'DE', max: 30, min: 0 },
        { name: 'FR', max: 30, min: 0 },
      ],
    })
    expect(result.series[0]).toMatchObject({
      type: 'radar',
      data: [{ name: 'amount', value: [30, 5] }],
    })
  })

  test('parallel coordinates have one axis for each column and one line for each row', () => {
    const result = option({
      type: 'parallel',
      y: ['amount', 'tax'],
      series: 'kind',
    })

    expect(result.parallelAxis).toEqual([
      { dim: 0, name: 'amount' },
      { dim: 1, name: 'tax' },
    ])
    expect(result.series).toMatchObject([
      {
        type: 'parallel',
        name: 'card',
        data: [
          [10, 1],
          [5, 3],
        ],
      },
      { type: 'parallel', name: 'cash', data: [[20, 2]] },
    ])
    expect(result.legend).toBeDefined()
  })

  test('a Sankey diagram has one node for each name and one link for each pair', () => {
    const result = option(
      { type: 'sankey', x: 'country', y: ['amount'], series: 'kind' },
      [
        ['Search', 'Product', '10', null],
        ['Product', 'Cart', '4', null],
      ],
    )

    expect(result.series[0]).toMatchObject({
      type: 'sankey',
      data: [{ name: 'Search' }, { name: 'Product' }, { name: 'Cart' }],
      links: [
        { source: 'Search', target: 'Product', value: 10 },
        { source: 'Product', target: 'Cart', value: 4 },
      ],
    })
  })

  test('the size of a bubble follows the root of its value', () => {
    const settings: ChartSettings = {
      type: 'bubble',
      x: 'amount',
      y: ['tax'],
      size: 'amount',
    }
    const result = option(settings, [
      ['DE', 'card', '0', '1'],
      ['DE', 'card', '25', '2'],
      ['DE', 'card', '100', '3'],
    ])
    const series = result.series[0] as {
      data: number[][]
      symbolSize: (value: number[]) => number
    }

    const [none, quarter, full] = series.data.map(series.symbolSize)

    expect(series.data[2]).toEqual([100, 3, 100])
    // A quarter of the value gives half of the way from the smallest to the largest diameter.
    expect(quarter - none).toBeCloseTo((full - none) / 2)
  })
})

describe('distributions and prices', () => {
  test('a box plot has the five numbers of each box, and the values outside the whiskers as points', () => {
    const values = [1, 2, 3, 4, 5, 100].map((value): Row => [
      'DE',
      'card',
      String(value),
      null,
    ])

    const result = option(
      { type: 'boxplot', x: 'country', y: ['amount'] },
      values,
    )

    expect(result.series).toMatchObject([
      { type: 'boxplot', data: [[1, 2.25, 3.5, 4.75, 5]] },
      { type: 'scatter', data: [['DE', 100]] },
    ])
  })

  test('a candlestick chart gives ECharts the values as open, close, low, high', () => {
    const result = option(
      { type: 'candlestick', x: 'day', y: ['open', 'high', 'low', 'close'] },
      [
        ['2026-03-02', '10', '14', '9', '12'],
        ['2026-03-03', '12', null, '8', '9'],
      ],
      [
        column('day', 'temporal'),
        column('open', 'number'),
        column('high', 'number'),
        column('low', 'number'),
        column('close', 'number'),
      ],
    )

    expect(result.series[0]).toMatchObject({
      type: 'candlestick',
      // A row without the four values has no candle.
      data: [[10, 12, 9, 14], '-'],
    })
  })

  test('a candle that closes lower is empty and has a different colour', () => {
    const result = option(
      {
        type: 'candlestick',
        x: 'country',
        y: ['amount', 'tax', 'amount', 'tax'],
      },
      ROWS,
    )

    expect(result.series[0].itemStyle).toMatchObject({
      color: THEME.series[0],
      color0: THEME.background,
      borderColor0: THEME.series[1],
    })
  })
})

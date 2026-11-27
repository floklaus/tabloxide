import { describe, expect, test } from 'vitest'
import type { Row } from '../../results/gridModel'
import {
  prepareChart,
  type BoxChart,
  type CartesianChart,
  type RowsChart,
} from './chartData'
import { candles, sankeyLinks } from './chartOtherData'
import type { ChartSettings } from './chartSettings'
import { column } from './testColumns'

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
  ['DE', 'card', '30', '4'],
]

function series(settings: ChartSettings, rows = ROWS, columns = SALES) {
  const chart = prepareChart(settings, columns, rows)
  if (chart.kind !== 'cartesian') throw new Error(`not series: ${chart.kind}`)
  return chart satisfies CartesianChart
}

describe('the parts of a whole', () => {
  test('a pie chart has one slice for each category, with the sum of its rows', () => {
    const chart = series({ type: 'pie', x: 'country', y: ['amount'] })

    expect(chart.categories).toEqual(['DE', 'FR'])
    expect(chart.series[0].values).toEqual([60, 5])
    expect(chart.xAxis).toBe('category')
  })

  test('a funnel keeps the sequence of the result', () => {
    const chart = series({ type: 'funnel', x: 'country', y: ['amount'] }, [
      ['Visit', '', '100', null],
      ['Cart', '', '40', null],
      ['Order', '', '10', null],
    ])

    expect(chart.categories).toEqual(['Visit', 'Cart', 'Order'])
    expect(chart.series[0].values).toEqual([100, 40, 10])
  })

  test('a pie chart has a maximum of 50 slices, and a note gives the total', () => {
    const many: Row[] = Array.from({ length: 80 }, (_, index) => [
      `c${index}`,
      'card',
      '1',
      null,
    ])

    const chart = series({ type: 'pie', x: 'country', y: ['amount'] }, many)

    expect(chart.categories).toHaveLength(50)
    expect(chart.notes).toEqual([
      { id: 'category-limit', shown: 50, total: 80, hasOther: false },
    ])
  })

  test('a tree map has the groups as categories and the subgroups as series', () => {
    const chart = series({
      type: 'treemap',
      x: 'country',
      y: ['amount'],
      series: 'kind',
    })

    expect(chart.categories).toEqual(['DE', 'FR'])
    expect(chart.series).toMatchObject([
      { name: 'card', values: [40, 5] },
      { name: 'cash', values: [20, null] },
    ])
  })
})

describe('a heat map', () => {
  test('has one cell for each pair of a column value and a row value', () => {
    const chart = series({
      type: 'heatmap',
      x: 'country',
      y: [],
      countRows: true,
      series: 'kind',
    })

    expect(chart.series).toMatchObject([
      { name: 'card', values: [2, 1] },
      { name: 'cash', values: [1, null] },
    ])
    expect(chart.pointCount).toBe(3)
  })

  test('the rows of a heat map are not series with colours, thus more than 8 show and none is "Other"', () => {
    const many: Row[] = Array.from({ length: 20 }, (_, index) => [
      'DE',
      `kind ${index}`,
      '1',
      null,
    ])

    const chart = series(
      { type: 'heatmap', x: 'country', y: ['amount'], series: 'kind' },
      many,
    )

    expect(chart.series).toHaveLength(20)
    expect(chart.otherSeries).toEqual([])
    expect(chart.notes).toEqual([])
  })
})

describe('a calendar heat map', () => {
  const DAYS = [column('day', 'temporal'), column('orders', 'number')]

  test('has one value for each day, in the sequence of the time', () => {
    const chart = series(
      { type: 'calendar', x: 'day', y: ['orders'] },
      [
        ['2026-03-02 10:00:00', '1'],
        ['2026-03-01 08:00:00', '5'],
        ['2026-03-02 18:00:00', '2'],
      ],
      DAYS,
    )

    expect(chart.categories).toEqual(['2026-03-01', '2026-03-02'])
    expect(chart.series[0].values).toEqual([5, 3])
    expect(chart.timeUnit).toBe('day')
  })

  test('does not say that it combined rows when each day has one row', () => {
    const chart = series(
      { type: 'calendar', x: 'day', y: ['orders'] },
      [
        ['2026-03-01', '5'],
        ['2026-03-02', '3'],
      ],
      DAYS,
    )

    expect(chart.isAutoAggregate).toBe(false)
  })

  test('shows the last three years, and a note gives the number of years', () => {
    const rows: Row[] = [2021, 2022, 2023, 2024, 2025].map((year) => [
      `${year}-06-01`,
      '1',
    ])

    const chart = series(
      { type: 'calendar', x: 'day', y: ['orders'] },
      rows,
      DAYS,
    )

    expect(chart.categories).toEqual(['2023-06-01', '2024-06-01', '2025-06-01'])
    expect(chart.pointCount).toBe(3)
    expect(chart.notes).toEqual([{ id: 'year-limit', shown: 3, total: 5 }])
  })

  test('a column that is not a date gives no chart, and a note counts its cells', () => {
    const chart = prepareChart(
      { type: 'calendar', x: 'country', y: ['amount'] },
      SALES,
      ROWS,
    )

    expect(chart).toEqual({
      kind: 'empty',
      notes: [{ id: 'not-times', column: 'country', count: 4 }],
    })
  })
})

describe('a Sankey diagram', () => {
  const FLOWS = [
    column('source', 'text'),
    column('target', 'text'),
    column('visits', 'number'),
  ]
  const flow = (rows: Row[]) =>
    prepareChart(
      { type: 'sankey', x: 'source', y: ['visits'], series: 'target' },
      FLOWS,
      rows,
    )

  test('has one link for each pair of a source and a target, with the sum of its rows', () => {
    const chart = flow([
      ['Search', 'Product', '10'],
      ['Search', 'Product', '5'],
      ['Product', 'Cart', '4'],
    ])

    if (chart.kind !== 'cartesian') throw new Error(chart.kind)
    expect(sankeyLinks(chart)).toEqual([
      { source: 'Search', target: 'Product', value: 15 },
      { source: 'Product', target: 'Cart', value: 4 },
    ])
    expect(chart.pointCount).toBe(2)
  })

  test('links that go in a circle give no chart and a note', () => {
    const chart = flow([
      ['A', 'B', '1'],
      ['B', 'C', '1'],
      ['C', 'A', '1'],
    ])

    expect(chart).toEqual({ kind: 'empty', notes: [{ id: 'cycle' }] })
  })

  test('a link from a node to the same node is not a flow', () => {
    const chart = flow([
      ['A', 'A', '7'],
      ['A', 'B', '1'],
    ])

    if (chart.kind !== 'cartesian') throw new Error(chart.kind)
    expect(sankeyLinks(chart)).toEqual([{ source: 'A', target: 'B', value: 1 }])
  })
})

describe('a candlestick chart', () => {
  const PRICES = [
    column('day', 'temporal'),
    column('open', 'number'),
    column('high', 'number'),
    column('low', 'number'),
    column('close', 'number'),
  ]
  const settings: ChartSettings = {
    type: 'candlestick',
    x: 'day',
    y: ['open', 'high', 'low', 'close'],
  }

  test('has one candle for each row, with the four values in the sequence of the settings', () => {
    const chart = series(
      settings,
      [
        ['2026-03-02', '10', '14', '9', '12'],
        ['2026-03-03', '12', '13', '8', '9'],
      ],
      PRICES,
    )

    expect(candles(chart)).toEqual([
      { category: '2026-03-02', values: [10, 14, 9, 12] },
      { category: '2026-03-03', values: [12, 13, 8, 9] },
    ])
    expect(chart.pointCount).toBe(2)
    expect(chart.yAggregates).toEqual([null, null, null, null])
  })

  test('a row with an empty value has no candle, and a note says so', () => {
    const chart = series(
      settings,
      [
        ['2026-03-02', '10', '14', '9', '12'],
        ['2026-03-03', '12', null, '8', '9'],
      ],
      PRICES,
    )

    expect(candles(chart)[1].values).toBeNull()
    expect(chart.pointCount).toBe(1)
    expect(chart.notes).toEqual([{ id: 'incomplete-rows', count: 1 }])
  })
})

describe('a bubble chart', () => {
  const settings: ChartSettings = {
    type: 'bubble',
    x: 'amount',
    y: ['tax'],
    size: 'tax',
  }

  test('each mark has a position and a size value', () => {
    const chart = series({
      ...settings,
      size: 'amount',
      x: 'tax',
      y: ['amount'],
    })

    expect(chart.xAxis).toBe('value')
    expect(chart.series[0].points).toEqual([
      [1, 10],
      [2, 20],
      [3, 5],
      [4, 30],
    ])
    expect(chart.series[0].sizes).toEqual([10, 20, 5, 30])
    expect(chart.sizeColumn).toBe('amount')
  })

  test('a row without a size is not shown, and a size that is not a number gives a note', () => {
    const chart = series(settings, [
      ['DE', 'card', '10', null],
      ['DE', 'card', '20', 'big'],
      ['DE', 'card', '30', '3'],
    ])

    expect(chart.series[0].points).toEqual([[30, 3]])
    expect(chart.notes).toEqual([
      { id: 'not-numbers', column: 'tax', count: 1 },
    ])
  })

  test('shows a maximum of 5,000 bubbles, and a note gives the total', () => {
    const many: Row[] = Array.from({ length: 5200 }, (_, index) => [
      'DE',
      'card',
      String(index),
      '1',
    ])

    const chart = series(settings, many)

    expect(chart.series[0].points).toHaveLength(5000)
    expect(chart.series[0].sizes).toHaveLength(5000)
    expect(chart.notes).toEqual([
      { id: 'point-limit', shown: 5000, total: 5200 },
    ])
  })
})

describe('a box plot', () => {
  function box(settings: ChartSettings, rows: Row[]) {
    const chart = prepareChart(settings, SALES, rows)
    if (chart.kind !== 'box') throw new Error(`not a box plot: ${chart.kind}`)
    return chart satisfies BoxChart
  }
  const values = (numbers: number[], country = 'DE'): Row[] =>
    numbers.map((value) => [country, 'card', String(value), null])

  test('has the quartiles of each category, and the whiskers at the lowest and the highest value', () => {
    const chart = box({ type: 'boxplot', x: 'country', y: ['amount'] }, [
      ...values([1, 2, 3, 4, 5]),
      ...values([10, 20], 'FR'),
    ])

    expect(chart.categories).toEqual(['DE', 'FR'])
    expect(chart.boxes).toEqual([
      [1, 2, 3, 4, 5],
      [10, 12.5, 15, 17.5, 20],
    ])
    expect(chart.outliers).toEqual([])
    expect(chart.pointCount).toBe(2)
  })

  test('a value that is far from the quartiles is outside the whiskers', () => {
    const chart = box(
      { type: 'boxplot', x: 'country', y: ['amount'] },
      values([1, 2, 3, 4, 5, 100]),
    )

    // The quartiles are 2.25 and 4.75. The whisker ends at 5.
    expect(chart.boxes[0]).toEqual([1, 2.25, 3.5, 4.75, 5])
    expect(chart.outliers).toEqual([[0, 100]])
  })

  test('without a category column, one box has all rows', () => {
    const chart = box({ type: 'boxplot', y: ['amount'] }, values([1, 2, 3]))

    expect(chart.xName).toBeNull()
    expect(chart.categories).toEqual(['All rows'])
  })

  test('the sort by value uses the median', () => {
    const chart = box(
      { type: 'boxplot', x: 'country', y: ['amount'], sort: 'value-desc' },
      [...values([1, 2, 3]), ...values([50, 60], 'FR')],
    )

    expect(chart.categories).toEqual(['FR', 'DE'])
  })

  test('a cell that is not a number gives a note', () => {
    const chart = box({ type: 'boxplot', x: 'country', y: ['amount'] }, [
      ['DE', 'card', 'n/a', null],
      ['DE', 'card', '3', null],
    ])

    expect(chart.boxes).toEqual([[3, 3, 3, 3, 3]])
    expect(chart.notes).toEqual([
      { id: 'not-numbers', column: 'amount', count: 1 },
    ])
  })
})

describe('parallel coordinates', () => {
  function parallel(settings: ChartSettings, rows = ROWS) {
    const chart = prepareChart(settings, SALES, rows)
    if (chart.kind !== 'rows') throw new Error(`not rows: ${chart.kind}`)
    return chart satisfies RowsChart
  }

  test('each row is one line with a value for each axis', () => {
    const chart = parallel({ type: 'parallel', y: ['amount', 'tax'] })

    expect(chart.axes).toEqual(['amount', 'tax'])
    expect(chart.groups).toEqual([
      {
        name: 'Rows',
        lines: [
          [10, 1],
          [20, 2],
          [5, 3],
          [30, 4],
        ],
      },
    ])
    expect(chart.pointCount).toBe(4)
  })

  test('a series column gives one group of lines for each of its values', () => {
    const chart = parallel({
      type: 'parallel',
      y: ['amount', 'tax'],
      series: 'kind',
    })

    expect(chart.groups.map((group) => group.name)).toEqual(['card', 'cash'])
    expect(chart.groups[1].lines).toEqual([[20, 2]])
  })

  test('a row with an empty value or a value that is not a number has no line', () => {
    const chart = parallel({ type: 'parallel', y: ['amount', 'tax'] }, [
      ['DE', 'card', '10', null],
      ['DE', 'card', 'x', '2'],
      ['DE', 'card', '30', '4'],
    ])

    expect(chart.pointCount).toBe(1)
    expect(chart.notes).toEqual([{ id: 'incomplete-rows', count: 2 }])
  })

  test('with fewer than two axes, there is no chart', () => {
    const chart = prepareChart({ type: 'parallel', y: ['amount'] }, SALES, ROWS)

    expect(chart.kind).toBe('empty')
  })
})

describe('a radar chart', () => {
  test('has one axis for each category and one form for each series', () => {
    const chart = series({
      type: 'radar',
      x: 'country',
      y: ['amount', 'tax'],
      aggregate: 'sum',
    })

    expect(chart.categories).toEqual(['DE', 'FR'])
    expect(chart.series).toMatchObject([
      { name: 'amount', values: [60, 5] },
      { name: 'tax', values: [7, 3] },
    ])
  })
})

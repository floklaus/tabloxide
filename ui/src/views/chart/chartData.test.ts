import { describe, expect, test } from 'vitest'
import type { Row } from '../../results/gridModel'
import {
  MAX_SERIES,
  noteText,
  prepareChart,
  type CartesianChart,
} from './chartData'
import { column } from './testColumns'

function cartesian(chart: ReturnType<typeof prepareChart>): CartesianChart {
  if (chart.kind !== 'cartesian') throw new Error(`not a chart: ${chart.kind}`)
  return chart
}

const SALES = [
  column('country', 'text'),
  column('kind', 'text'),
  column('amount', 'number'),
  column('tax', 'number'),
]

describe('a chart with categories', () => {
  test('each row is one bar with the aggregate None and no series column', () => {
    const rows: Row[] = [
      ['DE', 'a', '10', '1'],
      ['FR', 'a', '20', '2'],
      ['DE', 'b', '5', null],
    ]

    const chart = cartesian(
      prepareChart(
        {
          type: 'bar',
          x: 'country',
          y: ['amount', 'tax'],
          aggregate: 'none',
        },
        SALES,
        rows,
      ),
    )

    expect(chart.xAxis).toBe('category')
    expect(chart.categories).toEqual(['DE', 'FR', 'DE'])
    expect(chart.series).toMatchObject([
      { name: 'amount', values: [10, 20, 5] },
      { name: 'tax', values: [1, 2, null] },
    ])
    expect(chart.yName).toBeNull()
    expect(chart.pointCount).toBe(5)
    expect(chart.notes).toEqual([])
  })

  test('an aggregate combines the rows with the same category', () => {
    const rows: Row[] = [
      ['DE', 'a', '10', null],
      ['FR', 'a', '20', null],
      ['DE', 'b', '5', null],
    ]

    const chart = cartesian(
      prepareChart(
        { type: 'bar', x: 'country', y: ['amount'], aggregate: 'mean' },
        SALES,
        rows,
      ),
    )

    expect(chart.categories).toEqual(['DE', 'FR'])
    expect(chart.series[0].values).toEqual([7.5, 20])
    expect(chart.yName).toBe('mean of amount')
  })

  test.each([
    ['sum', [15, 20]],
    ['count', [2, 1]],
    ['min', [5, 20]],
    ['max', [10, 20]],
  ] as const)('the aggregate %s', (aggregate, expected) => {
    const rows: Row[] = [
      ['DE', 'a', '10', null],
      ['FR', 'a', '20', null],
      ['DE', 'b', '5', null],
    ]

    const chart = cartesian(
      prepareChart(
        { type: 'bar', x: 'country', y: ['amount'], aggregate },
        SALES,
        rows,
      ),
    )

    expect(chart.series[0].values).toEqual(expected)
  })

  test('the aggregate count also counts cells that are not numbers', () => {
    const rows: Row[] = [
      ['DE', 'a', null, null],
      ['DE', 'b', null, null],
      ['FR', null, null, null],
    ]

    const chart = cartesian(
      prepareChart(
        { type: 'bar', x: 'country', y: ['kind'], aggregate: 'count' },
        SALES,
        rows,
      ),
    )

    expect(chart.series[0].values).toEqual([2, null])
    expect(chart.notes).toEqual([])
  })

  test('a series column divides the rows into series with the same categories', () => {
    const rows: Row[] = [
      ['DE', 'a', '10', null],
      ['DE', 'b', '5', null],
      ['FR', 'b', '7', null],
    ]

    const chart = cartesian(
      prepareChart(
        { type: 'bar', x: 'country', y: ['amount'], series: 'kind' },
        SALES,
        rows,
      ),
    )

    expect(chart.categories).toEqual(['DE', 'FR'])
    expect(chart.series).toMatchObject([
      { name: 'a', values: [10, null] },
      { name: 'b', values: [5, 7] },
    ])
  })

  test('with the aggregate None, a second row of the same category and series is not shown, and a note says so', () => {
    const rows: Row[] = [
      ['DE', 'a', '10', null],
      ['DE', 'a', '99', null],
    ]

    const chart = cartesian(
      prepareChart(
        {
          type: 'bar',
          x: 'country',
          y: ['amount'],
          series: 'kind',
          aggregate: 'none',
        },
        SALES,
        rows,
      ),
    )

    expect(chart.series[0].values).toEqual([10])
    expect(chart.notes).toEqual([{ id: 'duplicates', count: 1 }])
  })

  test('a cell that is not a number is an empty value, and a note gives the number of such cells', () => {
    const rows: Row[] = [
      ['DE', 'a', '$10', null],
      ['FR', 'a', 'n/a', null],
      ['IT', 'a', '3', null],
    ]

    const chart = cartesian(
      prepareChart({ type: 'bar', x: 'country', y: ['amount'] }, SALES, rows),
    )

    expect(chart.series[0].values).toEqual([null, null, 3])
    expect(chart.notes).toEqual([
      { id: 'not-numbers', column: 'amount', count: 2 },
    ])
  })

  test('a row without a value for the horizontal axis is not shown', () => {
    const rows: Row[] = [
      [null, 'a', '10', null],
      ['FR', 'a', '20', null],
    ]

    const chart = cartesian(
      prepareChart({ type: 'bar', x: 'country', y: ['amount'] }, SALES, rows),
    )

    expect(chart.categories).toEqual(['FR'])
    expect(chart.notes).toEqual([{ id: 'empty-x', count: 1 }])
  })

  test('a bar chart has categories also for a number column', () => {
    const columns = [column('year', 'number'), column('total', 'number')]

    const chart = cartesian(
      prepareChart({ type: 'bar', x: 'year', y: ['total'] }, columns, [
        ['2025', '1'],
        ['2026', '2'],
      ]),
    )

    expect(chart.xAxis).toBe('category')
    expect(chart.categories).toEqual(['2025', '2026'])
  })
})

describe('a chart with a value axis or a time axis', () => {
  const READINGS = [
    column('time', 'temporal'),
    column('sensor', 'text'),
    column('temperature', 'number'),
  ]

  test('a line over a temporal column has a time axis and goes from the left to the right', () => {
    const rows: Row[] = [
      ['2026-11-26 12:00:00', 's1', '21'],
      ['2026-11-26 10:00:00', 's1', '19'],
      ['2026-11-26 11:00:00', 's1', null],
    ]

    const chart = cartesian(
      prepareChart(
        { type: 'line', x: 'time', y: ['temperature'] },
        READINGS,
        rows,
      ),
    )

    expect(chart.xAxis).toBe('time')
    expect(chart.series[0].points).toEqual([
      [Date.UTC(2026, 10, 26, 10), 19],
      [Date.UTC(2026, 10, 26, 12), 21],
    ])
    expect(chart.pointCount).toBe(2)
  })

  test('a series column gives one line for each of its values', () => {
    const rows: Row[] = [
      ['2026-11-26', 's1', '1'],
      ['2026-11-26', 's2', '2'],
      ['2026-11-27', 's1', '3'],
    ]

    const chart = cartesian(
      prepareChart(
        { type: 'line', x: 'time', y: ['temperature'], series: 'sensor' },
        READINGS,
        rows,
      ),
    )

    expect(chart.series.map((series) => series.name)).toEqual(['s1', 's2'])
    expect(chart.series[0].points).toHaveLength(2)
    expect(chart.series[1].points).toHaveLength(1)
  })

  test('an aggregate combines the rows with the same position', () => {
    const rows: Row[] = [
      ['2026-11-26', 's1', '1'],
      ['2026-11-26', 's2', '3'],
    ]

    const chart = cartesian(
      prepareChart(
        { type: 'line', x: 'time', y: ['temperature'], aggregate: 'mean' },
        READINGS,
        rows,
      ),
    )

    expect(chart.series[0].points).toEqual([[Date.UTC(2026, 10, 26), 2]])
  })

  test('a time without a date gives categories', () => {
    const rows: Row[] = [
      ['10:00:00', 's1', '1'],
      ['11:00:00', 's1', '2'],
    ]

    const chart = cartesian(
      prepareChart(
        { type: 'line', x: 'time', y: ['temperature'] },
        READINGS,
        rows,
      ),
    )

    expect(chart.xAxis).toBe('category')
    expect(chart.categories).toEqual(['10:00:00', '11:00:00'])
  })

  test('a cell of the time axis that is not a date is not shown', () => {
    const rows: Row[] = [
      ['2026-11-26', 's1', '1'],
      ['infinity', 's1', '2'],
    ]

    const chart = cartesian(
      prepareChart(
        { type: 'line', x: 'time', y: ['temperature'] },
        READINGS,
        rows,
      ),
    )

    expect(chart.series[0].points).toHaveLength(1)
    expect(chart.notes).toEqual([{ id: 'not-times', column: 'time', count: 1 }])
  })

  test('a scatter plot of two number columns keeps the row sequence', () => {
    const columns = [column('height', 'number'), column('weight', 'number')]

    const chart = cartesian(
      prepareChart({ type: 'scatter', x: 'height', y: ['weight'] }, columns, [
        ['180', '80'],
        ['160', '55'],
      ]),
    )

    expect(chart.xAxis).toBe('value')
    expect(chart.series[0].points).toEqual([
      [180, 80],
      [160, 55],
    ])
  })

  test('a logarithmic axis does not show zero and negative values', () => {
    const columns = [column('x', 'number'), column('y', 'number')]

    const chart = cartesian(
      prepareChart(
        { type: 'scatter', x: 'x', y: ['y'], scale: 'log' },
        columns,
        [
          ['1', '10'],
          ['2', '0'],
          ['3', '-4'],
        ],
      ),
    )

    expect(chart.series[0].points).toEqual([[1, 10]])
    expect(chart.notes).toEqual([{ id: 'not-positive', count: 2 }])
  })
})

describe('the number of series', () => {
  test('a chart shows no more series than it has colours', () => {
    const columns = [
      column('x', 'number'),
      column('group', 'text'),
      column('y', 'number'),
    ]
    const groups = 12
    const rows: Row[] = Array.from({ length: groups }, (_, index) => [
      String(index),
      `g${index}`,
      '1',
    ])

    const chart = cartesian(
      prepareChart(
        { type: 'scatter', x: 'x', y: ['y'], series: 'group' },
        columns,
        rows,
      ),
    )

    expect(chart.series).toHaveLength(MAX_SERIES)
    expect(chart.notes).toEqual([
      { id: 'series-limit', shown: MAX_SERIES, total: groups },
    ])
  })

  test('a series column with two y columns gives one series for each pair', () => {
    const rows: Row[] = [
      ['DE', 'a', '10', '1'],
      ['DE', 'b', '5', '2'],
    ]

    const chart = cartesian(
      prepareChart(
        { type: 'bar', x: 'country', y: ['amount', 'tax'], series: 'kind' },
        SALES,
        rows,
      ),
    )

    expect(chart.series.map((series) => series.name)).toEqual([
      'a · amount',
      'a · tax',
      'b · amount',
      'b · tax',
    ])
  })

  test('rows without a value in the series column are one series', () => {
    const rows: Row[] = [
      ['DE', null, '10', null],
      ['FR', null, '5', null],
    ]

    const chart = cartesian(
      prepareChart(
        { type: 'bar', x: 'country', y: ['amount'], series: 'kind' },
        SALES,
        rows,
      ),
    )

    expect(chart.series.map((series) => series.name)).toEqual(['(empty)'])
  })
})

describe('a histogram', () => {
  const AGE = [column('age', 'number')]

  test('counts the values in bins of equal width with round limits', () => {
    const rows: Row[] = [1, 2, 3, 12, 13, 28, 39, 40].map((value) => [
      String(value),
    ])

    const chart = cartesian(
      prepareChart({ type: 'histogram', x: 'age', y: [] }, AGE, rows),
    )

    expect(chart.type).toBe('histogram')
    expect(chart.categories).toEqual([
      '0 to 10',
      '10 to 20',
      '20 to 30',
      '30 to 40',
      '40 to 50',
    ])
    expect(chart.series[0].values).toEqual([3, 2, 1, 1, 1])
  })

  test('all values equal give one bin', () => {
    const chart = cartesian(
      prepareChart({ type: 'histogram', x: 'age', y: [] }, AGE, [['5'], ['5']]),
    )

    expect(chart.series[0].values).toEqual([2])
  })

  test('ignores empty cells and counts cells that are not numbers in a note', () => {
    const chart = cartesian(
      prepareChart({ type: 'histogram', x: 'age', y: [] }, AGE, [
        ['5'],
        [null],
        ['old'],
      ]),
    )

    expect(chart.series[0].values).toEqual([1])
    expect(chart.notes).toEqual([
      { id: 'not-numbers', column: 'age', count: 1 },
    ])
  })
})

describe('a single value', () => {
  const TOTAL = [column('total', 'number')]

  test('shows the number of the first row', () => {
    const chart = prepareChart({ type: 'value', y: ['total'] }, TOTAL, [
      ['1234567.5'],
    ])

    expect(chart).toEqual({
      kind: 'value',
      label: 'total',
      text: '1,234,567.5',
      notes: [],
    })
  })

  test('says that it shows the first row when the result has more rows', () => {
    const chart = prepareChart({ type: 'value', y: ['total'] }, TOTAL, [
      ['1'],
      ['2'],
    ])

    expect(chart).toMatchObject({
      text: '1',
      notes: [{ id: 'first-row', rows: 2 }],
    })
  })

  test('an aggregate combines all rows', () => {
    const chart = prepareChart(
      { type: 'value', y: ['total'], aggregate: 'sum' },
      TOTAL,
      [['1'], ['2'], [null]],
    )

    expect(chart).toMatchObject({ label: 'sum of total', text: '3' })
  })

  test('shows text that is not a number as it is', () => {
    const chart = prepareChart(
      { type: 'value', y: ['total'] },
      [column('total', 'text')],
      [['open']],
    )

    expect(chart).toMatchObject({ text: 'open' })
  })
})

describe('no data', () => {
  test('a result without rows gives an empty chart', () => {
    const chart = prepareChart(
      { type: 'bar', x: 'country', y: ['amount'] },
      SALES,
      [],
    )

    expect(chart.kind).toBe('empty')
  })

  test('an empty chart keeps the notes that give the cause', () => {
    const chart = prepareChart(
      { type: 'bar', x: 'country', y: ['amount'] },
      SALES,
      [['DE', 'a', 'x', null]],
    )

    expect(chart).toEqual({
      kind: 'empty',
      notes: [{ id: 'not-numbers', column: 'amount', count: 1 }],
    })
  })
})

describe('noteText', () => {
  test('uses the singular for one cell', () => {
    expect(noteText({ id: 'not-numbers', column: 'amount', count: 1 })).toBe(
      '1 cell of the column amount is not a number. The chart does not show it.',
    )
  })

  test('uses the plural and separators for many cells', () => {
    expect(noteText({ id: 'not-numbers', column: 'amount', count: 1200 })).toBe(
      '1,200 cells of the column amount are not a number. The chart does not show them.',
    )
  })

  test('gives the number of series', () => {
    expect(noteText({ id: 'series-limit', shown: 8, total: 23 })).toBe(
      'The chart shows the first 8 of 23 series.',
    )
  })
})

describe('settings without an aggregate', () => {
  test('the chart shows the sum if the values of the horizontal axis repeat, and says that it decided', () => {
    const rows: Row[] = [
      ['DE', 'a', '10', null],
      ['FR', 'a', '20', null],
      ['DE', 'b', '5', null],
    ]

    const chart = cartesian(
      prepareChart({ type: 'bar', x: 'country', y: ['amount'] }, SALES, rows),
    )

    expect(chart.categories).toEqual(['DE', 'FR'])
    expect(chart.series[0].values).toEqual([15, 20])
    expect(chart).toMatchObject({
      aggregate: 'sum',
      isAutoAggregate: true,
      yName: 'sum of amount',
    })
  })

  test('each row is one mark if no value repeats', () => {
    const rows: Row[] = [
      ['DE', 'a', '10', null],
      ['FR', 'a', '20', null],
    ]

    const chart = cartesian(
      prepareChart({ type: 'bar', x: 'country', y: ['amount'] }, SALES, rows),
    )

    expect(chart).toMatchObject({
      aggregate: null,
      isAutoAggregate: false,
      yName: 'amount',
    })
  })

  test('the same value in two series is not a repeat', () => {
    const rows: Row[] = [
      ['DE', 'a', '10', null],
      ['DE', 'b', '5', null],
    ]

    const chart = cartesian(
      prepareChart(
        { type: 'bar', x: 'country', y: ['amount'], series: 'kind' },
        SALES,
        rows,
      ),
    )

    expect(chart.aggregate).toBeNull()
  })

  test('an aggregate of the settings is not automatic', () => {
    const rows: Row[] = [
      ['DE', 'a', '10', null],
      ['DE', 'b', '5', null],
    ]

    const chart = cartesian(
      prepareChart(
        { type: 'bar', x: 'country', y: ['amount'], aggregate: 'max' },
        SALES,
        rows,
      ),
    )

    expect(chart).toMatchObject({ aggregate: 'max', isAutoAggregate: false })
    expect(chart.series[0].values).toEqual([10])
  })

  test('a scatter plot never combines rows', () => {
    const columns = [column('x', 'number'), column('y', 'number')]

    const chart = cartesian(
      prepareChart({ type: 'scatter', x: 'x', y: ['y'] }, columns, [
        ['1', '10'],
        ['1', '20'],
      ]),
    )

    expect(chart.aggregate).toBeNull()
    expect(chart.series[0].points).toHaveLength(2)
  })
})

describe('the number of rows', () => {
  test('counts the rows of each category, also rows with empty cells', () => {
    const rows: Row[] = [
      ['DE', null, null, null],
      ['FR', null, null, null],
      ['DE', null, null, null],
    ]

    const chart = cartesian(
      prepareChart(
        { type: 'bar', x: 'country', y: [], countRows: true },
        SALES,
        rows,
      ),
    )

    expect(chart.categories).toEqual(['DE', 'FR'])
    expect(chart.series).toMatchObject([
      { name: 'Number of rows', values: [2, 1] },
    ])
    expect(chart).toMatchObject({
      countsRows: true,
      yName: 'Number of rows',
      yColumns: [],
      isAutoAggregate: false,
    })
  })

  test('a series column gives one count for each of its values', () => {
    const rows: Row[] = [
      ['DE', 'a', null, null],
      ['DE', 'b', null, null],
      ['DE', 'b', null, null],
    ]

    const chart = cartesian(
      prepareChart(
        { type: 'bar', x: 'country', y: [], countRows: true, series: 'kind' },
        SALES,
        rows,
      ),
    )

    expect(chart.series).toMatchObject([
      { name: 'a', values: [1] },
      { name: 'b', values: [2] },
    ])
  })

  test('a single value shows the number of the loaded rows', () => {
    const chart = prepareChart(
      { type: 'value', y: [], countRows: true },
      SALES,
      [
        ['DE', null, null, null],
        ['FR', null, null, null],
      ],
    )

    expect(chart).toEqual({
      kind: 'value',
      label: 'Number of rows',
      text: '2',
      notes: [],
    })
  })
})

describe('a time unit', () => {
  const PAYMENTS = [
    column('paid', 'temporal'),
    column('staff', 'text'),
    column('amount', 'number'),
  ]
  const rows: Row[] = [
    ['2026-02-03 10:00:00+00', 'Mike', '5'],
    ['2026-01-15 09:30:00+00', 'Mike', '1'],
    ['2026-01-20 18:00:00+00', 'Jon', '2'],
    ['2026-02-28 23:59:59+00', 'Jon', '10'],
  ]

  test('a line has one point for each month, with the sum of its rows', () => {
    const chart = cartesian(
      prepareChart(
        { type: 'line', x: 'paid', y: ['amount'], timeUnit: 'month' },
        PAYMENTS,
        rows,
      ),
    )

    expect(chart).toMatchObject({
      xAxis: 'time',
      timeUnit: 'month',
      aggregate: 'sum',
      isAutoAggregate: true,
    })
    expect(chart.series[0].points).toEqual([
      [Date.UTC(2026, 0, 1), 3],
      [Date.UTC(2026, 1, 1), 15],
    ])
  })

  test('a bar chart has one category for each month, in the sequence of the time', () => {
    const chart = cartesian(
      prepareChart(
        {
          type: 'bar',
          x: 'paid',
          y: ['amount'],
          timeUnit: 'month',
          aggregate: 'max',
        },
        PAYMENTS,
        rows,
      ),
    )

    expect(chart.xAxis).toBe('category')
    expect(chart.categories).toEqual(['2026-01', '2026-02'])
    expect(chart.series[0].values).toEqual([2, 10])
  })

  test('a week starts on Monday', () => {
    const chart = cartesian(
      prepareChart(
        { type: 'bar', x: 'paid', y: [], countRows: true, timeUnit: 'week' },
        PAYMENTS,
        // 2026-01-18 is a Sunday, and 2026-01-19 is a Monday.
        [
          ['2026-01-18', 'Mike', '1'],
          ['2026-01-19', 'Mike', '1'],
          ['2026-01-25', 'Mike', '1'],
        ],
      ),
    )

    expect(chart.categories).toEqual(['2026-01-12', '2026-01-19'])
    expect(chart.series[0].values).toEqual([1, 2])
  })

  test('a column that is not a date has no time unit', () => {
    const chart = cartesian(
      prepareChart(
        { type: 'bar', x: 'staff', y: ['amount'], timeUnit: 'month' },
        PAYMENTS,
        rows,
      ),
    )

    expect(chart.timeUnit).toBeNull()
    expect(chart.categories).toEqual(['Mike', 'Jon'])
  })
})

describe('the sort of the categories', () => {
  const rows: Row[] = [
    ['item 10', 'a', '5', null],
    ['item 2', 'a', '20', null],
    ['item 1', 'a', null, null],
    ['item 3', 'a', '10', null],
  ]
  const sorted = (sort: 'name' | 'value-asc' | 'value-desc') =>
    cartesian(
      prepareChart(
        { type: 'bar', x: 'country', y: ['amount'], sort },
        SALES,
        rows,
      ),
    )

  test('without a sort, the categories are as in the result', () => {
    const chart = cartesian(
      prepareChart({ type: 'bar', x: 'country', y: ['amount'] }, SALES, rows),
    )

    expect(chart.categories).toEqual(['item 10', 'item 2', 'item 1', 'item 3'])
  })

  test('by name, with the numbers in a name in their numeric sequence', () => {
    expect(sorted('name').categories).toEqual([
      'item 1',
      'item 2',
      'item 3',
      'item 10',
    ])
  })

  test('by value with the largest first, and a category without a value last', () => {
    const chart = sorted('value-desc')

    expect(chart.categories).toEqual(['item 2', 'item 3', 'item 10', 'item 1'])
    expect(chart.series[0].values).toEqual([20, 10, 5, null])
  })

  test('by value with the smallest first, and a category without a value last', () => {
    expect(sorted('value-asc').categories).toEqual([
      'item 10',
      'item 3',
      'item 2',
      'item 1',
    ])
  })

  test('the value of a category is the total of its series', () => {
    const chart = cartesian(
      prepareChart(
        {
          type: 'bar',
          x: 'country',
          y: ['amount', 'tax'],
          sort: 'value-desc',
        },
        SALES,
        [
          ['DE', 'a', '10', '1'],
          ['FR', 'a', '5', '20'],
        ],
      ),
    )

    expect(chart.categories).toEqual(['FR', 'DE'])
  })
})

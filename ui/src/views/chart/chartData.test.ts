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
  test('each row is one bar when there is no aggregate and no series column', () => {
    const rows: Row[] = [
      ['DE', 'a', '10', '1'],
      ['FR', 'a', '20', '2'],
      ['DE', 'b', '5', null],
    ]

    const chart = cartesian(
      prepareChart(
        { type: 'bar', x: 'country', y: ['amount', 'tax'] },
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

  test('without an aggregate, a second row of the same category and series is not shown, and a note says so', () => {
    const rows: Row[] = [
      ['DE', 'a', '10', null],
      ['DE', 'a', '99', null],
    ]

    const chart = cartesian(
      prepareChart(
        { type: 'bar', x: 'country', y: ['amount'], series: 'kind' },
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

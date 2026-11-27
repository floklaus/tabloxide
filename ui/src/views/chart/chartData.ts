import type { Column, Row } from '../../results/gridModel'
import { ROW_COUNT_NAME, type PreparedChart } from './chartModel'
import { Notes } from './chartNotes'
import {
  checkCandles,
  checkSankey,
  limitCalendar,
  prepareBox,
  prepareParallel,
} from './chartOtherData'
import {
  indexOf,
  prepareCartesian,
  yValue,
  type Input,
  type YColumn,
} from './chartSeriesData'
import {
  aggregateOf,
  effectiveColumns,
  type ChartSettings,
} from './chartSettings'
import { accumulate, newAccumulator, result } from './chartStats'
import { formatNumber, toNumber } from './chartValues'

export * from './chartModel'
export { noteText } from './chartNotes'

/** A histogram has a maximum of this number of bars. */
const MAX_BINS = 60

function niceStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(raw))
  const part = raw / power
  if (part <= 1) return power
  if (part <= 2) return 2 * power
  return part <= 5 ? 5 * power : 10 * power
}

function prepareHistogram(input: Input): PreparedChart {
  const { settings, columns, rows, notes } = input
  const xIndex = indexOf(columns, settings.x)
  if (xIndex < 0) return { kind: 'empty', notes: [] }
  const column = columns[xIndex].name
  const values: number[] = []
  for (const row of rows) {
    const cell = row[xIndex]
    if (cell === null) continue
    const value = toNumber(cell)
    if (value === null) notes.count({ id: 'not-numbers', column, count: 1 })
    else values.push(value)
  }
  if (values.length === 0) return { kind: 'empty', notes: notes.list() }

  let min = Infinity
  let max = -Infinity
  for (const value of values) {
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  // The rule of Sturges gives the number of bars from the number of values.
  const wanted = Math.min(MAX_BINS, Math.ceil(Math.log2(values.length)) + 1)
  const step = max === min ? 1 : niceStep((max - min) / wanted)
  const start = Math.floor(min / step) * step
  const binCount = Math.max(1, Math.floor((max - start) / step) + 1)
  const counts = Array.from({ length: binCount }, () => 0)
  for (const value of values) {
    const bin = Math.min(binCount - 1, Math.floor((value - start) / step))
    counts[bin] += 1
  }
  return {
    kind: 'cartesian',
    type: 'histogram',
    xAxis: 'category',
    xName: column,
    yName: ROW_COUNT_NAME,
    yColumns: [],
    yAggregates: [],
    countsRows: true,
    automatic: null,
    isAutoAggregate: false,
    timeUnit: null,
    seriesColumn: null,
    sizeColumn: null,
    limit: null,
    otherSeries: [],
    categories: counts.map((_, bin) => {
      const from = start + bin * step
      return `${formatNumber(from)} to ${formatNumber(from + step)}`
    }),
    series: [{ name: ROW_COUNT_NAME, values: counts, points: [] }],
    pointCount: binCount,
    notes: notes.list(),
  }
}

function prepareValue(input: Input): PreparedChart {
  const { settings, columns, rows, notes } = input
  if (settings.countRows) {
    return {
      kind: 'value',
      label: ROW_COUNT_NAME,
      text: formatNumber(rows.length),
      notes: [],
    }
  }
  const yIndex = indexOf(columns, settings.y[0])
  if (yIndex < 0 || rows.length === 0) return { kind: 'empty', notes: [] }
  const setting = aggregateOf(settings, columns[yIndex].name)
  const aggregate = setting === undefined || setting === 'none' ? null : setting
  const y: YColumn = { index: yIndex, name: columns[yIndex].name, aggregate }
  if (aggregate === null) {
    if (rows.length > 1) notes.add({ id: 'first-row', rows: rows.length })
    const cell = rows[0][yIndex]
    const value = cell === null ? null : toNumber(cell)
    const text = value === null ? (cell ?? 'NULL') : formatNumber(value)
    return { kind: 'value', label: y.name, text, notes: notes.list() }
  }
  const target = newAccumulator()
  for (const row of rows) {
    const value = yValue(row, y, notes)
    if (value !== null) accumulate(target, value)
  }
  const value = result(target, aggregate)
  return {
    kind: 'value',
    label: `${aggregate} of ${y.name}`,
    text: value === null ? 'NULL' : formatNumber(value),
    notes: notes.list(),
  }
}

/**
 * Makes the data of a chart from the loaded rows of a result. The function does
 * not know the chart library. A cell that it cannot convert is an empty value,
 * and a note gives the number of such cells.
 */

export function prepareChart(
  settings: ChartSettings,
  columns: Column[],
  rows: Row[],
): PreparedChart {
  const input: Input = {
    settings,
    columns: effectiveColumns(columns, settings.kinds),
    rows,
    notes: new Notes(),
  }
  if (settings.type === 'histogram') return prepareHistogram(input)
  if (settings.type === 'value') return prepareValue(input)
  if (settings.type === 'boxplot') return prepareBox(input)
  if (settings.type === 'parallel') return prepareParallel(input)
  const chart = prepareCartesian(input, settings.type)
  if (chart.kind !== 'cartesian') return chart
  // Some chart types have one more check after the series are ready.
  if (settings.type === 'sankey') return checkSankey(chart)
  if (settings.type === 'calendar') return limitCalendar(chart)
  if (settings.type === 'candlestick') return checkCandles(chart)
  return chart
}

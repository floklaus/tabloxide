import type {
  BoxChart,
  CartesianChart,
  PreparedChart,
  RowsChart,
  SeriesChartType,
} from './chartData'
import { OTHER_NAME, ROW_COUNT_NAME } from './chartData'
import { AGGREGATE_LABELS } from './chartSettings'

const count = new Intl.NumberFormat('en-US')

function plural(value: number, noun: string): string {
  return `${count.format(value)} ${noun}${value === 1 ? '' : 's'}`
}

function list(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

export type ChartSentence = {
  /** What the chart shows, with each step that the chart did for the user. */
  what: string
  /** The number of rows and the number of marks. */
  size: string
}

/** The name of one mark of each chart type. The other types have points. */
const MARKS: Partial<Record<SeriesChartType, string>> = {
  bar: 'bar',
  histogram: 'bar',
  bubble: 'bubble',
  heatmap: 'cell',
  calendar: 'day',
  pie: 'slice',
  funnel: 'stage',
  treemap: 'part',
  sunburst: 'part',
  sankey: 'link',
  candlestick: 'candle',
}

/** The types whose series column is a second group of the values, not a set of series. */
const GRID_TYPES: ReadonlySet<SeriesChartType> = new Set([
  'heatmap',
  'treemap',
  'sunburst',
])

function sizeText(rowCount: number, marks: number, mark: string): string {
  return `${plural(rowCount, 'row')} in ${plural(marks, mark)}.`
}

function boxSentence(chart: BoxChart, rowCount: number): ChartSentence {
  const unit = chart.timeUnit === null ? '' : `${chart.timeUnit} of `
  const groups = chart.xName === null ? '' : ` for each ${unit}${chart.xName}`
  return {
    what: `Distribution of ${chart.yName}${groups}.`,
    size: `${plural(rowCount, 'row')} in ${count.format(chart.pointCount)} ${chart.pointCount === 1 ? 'box' : 'boxes'}.`,
  }
}

function rowsSentence(chart: RowsChart, rowCount: number): ChartSentence {
  const colour =
    chart.seriesColumn === null
      ? ''
      : `, one colour for each value of ${chart.seriesColumn}`
  return {
    what: `${list(chart.axes)} of each row${colour}.`,
    size: sizeText(rowCount, chart.pointCount, 'line'),
  }
}

/** The part of the sentence about the horizontal axis, the limit, and the series column. */
function groupText(chart: CartesianChart): string {
  const x =
    chart.timeUnit === null
      ? chart.xName
      : `${chart.timeUnit} of ${chart.xName}`
  const limit =
    chart.limit === null
      ? ''
      : `, the first ${chart.limit.shown}${chart.limit.hasOther ? ` and "${OTHER_NAME}"` : ''}`
  const column = chart.seriesColumn
  if (chart.type === 'sankey') return `from each ${x} to each ${column}`
  if (column !== null && GRID_TYPES.has(chart.type)) {
    return `for each ${x} and each ${column}${limit}`
  }
  const series =
    column === null ? '' : `, one series for each value of ${column}`
  return `for each ${x}${limit}${series}`
}

/** The columns with their aggregates, for example "Sum of a and b". `null`: each row is one mark. */
function valueText(chart: CartesianChart): string | null {
  // Columns with the same aggregate are one group.
  const groups = new Map<string, string[]>()
  chart.yColumns.forEach((column, index) => {
    const aggregate = chart.yAggregates[index]
    const key = aggregate === null ? '' : AGGREGATE_LABELS[aggregate]
    groups.set(key, [...(groups.get(key) ?? []), column])
  })
  if (groups.size === 1 && groups.has('')) return null
  const parts = [...groups].map(([aggregate, columns], index) => {
    // A column without an aggregate in a chart with aggregates shows each row.
    const name = aggregate === '' ? 'each row' : aggregate
    const text = `${name} of ${list(columns)}`
    return index === 0 ? text : text.charAt(0).toLowerCase() + text.slice(1)
  })
  const [first, ...rest] = parts
  return list([first.charAt(0).toUpperCase() + first.slice(1), ...rest])
}

function seriesSentence(
  chart: CartesianChart,
  rowCount: number,
): ChartSentence {
  const mark = MARKS[chart.type] ?? 'point'
  const size = sizeText(rowCount, chart.pointCount, mark)
  if (chart.type === 'histogram') {
    return {
      what: `${ROW_COUNT_NAME} for each range of ${chart.xName}.`,
      size,
    }
  }
  if (chart.type === 'candlestick') {
    return {
      what: `Open, high, low, and close (${chart.yColumns.join(', ')}) for each ${chart.xName}.`,
      size,
    }
  }
  const groups = groupText(chart)
  if (chart.countsRows) return { what: `${ROW_COUNT_NAME} ${groups}.`, size }
  const values = valueText(chart)
  if (values !== null) return { what: `${values} ${groups}.`, size }
  // Each row is one mark.
  if (chart.type === 'sankey' || GRID_TYPES.has(chart.type)) {
    return {
      what: `${list(chart.yColumns)} ${groups}, one ${mark} for each row.`,
      size,
    }
  }
  const x = groups.replace(/^for each /, '')
  const bubble =
    chart.sizeColumn === null ? '' : `, with the size from ${chart.sizeColumn}`
  const [axis, ...rest] = x.split(', ')
  const tail = rest.length === 0 ? '' : `, ${rest.join(', ')}`
  return {
    what: `${list(chart.yColumns)} against ${axis}${bubble}, one ${mark} for each row${tail}.`,
    size,
  }
}

/**
 * Says in one sentence what a chart shows, for example "Sum of amount for each
 * month of payment_date, one series for each value of staff." Thus the user sees
 * an aggregate or a time unit that the chart set. Returns `null` for a view
 * without a chart.
 */
export function chartSentence(
  chart: PreparedChart,
  rowCount: number,
): ChartSentence | null {
  if (chart.kind === 'box') return boxSentence(chart, rowCount)
  if (chart.kind === 'rows') return rowsSentence(chart, rowCount)
  if (chart.kind !== 'cartesian') return null
  return seriesSentence(chart, rowCount)
}

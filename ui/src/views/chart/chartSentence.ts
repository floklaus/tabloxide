import type { PreparedChart } from './chartData'
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
  if (chart.kind !== 'cartesian') return null
  const isBars = chart.type === 'bar' || chart.type === 'histogram'
  const size = `${plural(rowCount, 'row')} in ${plural(chart.pointCount, isBars ? 'bar' : 'point')}.`
  if (chart.type === 'histogram') {
    return {
      what: `${ROW_COUNT_NAME} for each range of ${chart.xName}.`,
      size,
    }
  }
  const x =
    chart.timeUnit === null
      ? chart.xName
      : `${chart.timeUnit} of ${chart.xName}`
  const limit =
    chart.limit === null
      ? ''
      : `, the first ${chart.limit.shown}${chart.limit.hasOther ? ` and "${OTHER_NAME}"` : ''}`
  const series =
    limit +
    (chart.seriesColumn === null
      ? ''
      : `, one series for each value of ${chart.seriesColumn}`)
  if (chart.countsRows) {
    return { what: `${ROW_COUNT_NAME} for each ${x}${series}.`, size }
  }
  // Columns with the same aggregate are one group, for example "Sum of a and b".
  const groups = new Map<string, string[]>()
  chart.yColumns.forEach((column, index) => {
    const aggregate = chart.yAggregates[index]
    const key = aggregate === null ? '' : AGGREGATE_LABELS[aggregate]
    groups.set(key, [...(groups.get(key) ?? []), column])
  })
  const mark = isBars ? 'bar' : 'point'
  if (groups.size === 1 && groups.has('')) {
    return {
      what: `${list(chart.yColumns)} against ${x}, one ${mark} for each row${series}.`,
      size,
    }
  }
  const parts = [...groups].map(([aggregate, columns], index) => {
    // A column without an aggregate in a chart with aggregates shows each row.
    const name = aggregate === '' ? 'each row' : aggregate
    const text = `${name} of ${list(columns)}`
    return index === 0 ? text : text.charAt(0).toLowerCase() + text.slice(1)
  })
  const [first, ...rest] = parts
  const what = first.charAt(0).toUpperCase() + first.slice(1)
  return { what: `${list([what, ...rest])} for each ${x}${series}.`, size }
}

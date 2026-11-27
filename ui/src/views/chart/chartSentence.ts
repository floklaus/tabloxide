import type { PreparedChart } from './chartData'
import { ROW_COUNT_NAME } from './chartData'
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
  const columns = list(chart.yColumns)
  const x =
    chart.timeUnit === null
      ? chart.xName
      : `${chart.timeUnit} of ${chart.xName}`
  const series =
    chart.seriesColumn === null
      ? ''
      : `, one series for each value of ${chart.seriesColumn}`
  if (chart.countsRows) {
    return { what: `${ROW_COUNT_NAME} for each ${x}${series}.`, size }
  }
  if (chart.aggregate === null) {
    return {
      what: `${columns} against ${x}, one ${isBars ? 'bar' : 'point'} for each row${series}.`,
      size,
    }
  }
  return {
    what: `${AGGREGATE_LABELS[chart.aggregate]} of ${columns} for each ${x}${series}.`,
    size,
  }
}

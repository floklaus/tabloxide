import type { PreparedChart } from './chartData'
import { CHART_TYPE_LABELS } from './chartSettings'

const count = new Intl.NumberFormat('en-US')

function plural(value: number, noun: string): string {
  return `${count.format(value)} ${noun}${value === 1 ? '' : 's'}`
}

/**
 * The text of a chart for a screen reader: the chart type, the axes, and the
 * number of series and marks. The grid has the values.
 */
export function chartSummary(chart: PreparedChart): string {
  if (chart.kind === 'empty') return 'The chart has no data.'
  if (chart.kind === 'value') return `${chart.label}: ${chart.text}.`
  const names = chart.series.map((series) => series.name).join(', ')
  const vertical = chart.yName ?? names
  const mark =
    chart.type === 'bar' || chart.type === 'histogram' ? 'bar' : 'point'
  return [
    `${CHART_TYPE_LABELS[chart.type]}.`,
    `Horizontal axis: ${chart.xName}.`,
    `Vertical axis: ${vertical}.`,
    `${count.format(chart.series.length)} series, ${plural(chart.pointCount, mark)}.`,
    'The Grid view has the values.',
  ].join(' ')
}

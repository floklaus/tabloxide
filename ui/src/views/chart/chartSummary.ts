import type { CartesianChart, PreparedChart } from './chartData'
import { chartSentence } from './chartSentence'
import { CHART_TYPE_LABELS } from './chartSettings'

const count = new Intl.NumberFormat('en-US')

function plural(value: number, noun: string): string {
  return `${count.format(value)} ${noun}${value === 1 ? '' : 's'}`
}

/** The chart types that have a horizontal axis and a vertical axis with series. */
const AXIS_TYPES: ReadonlySet<CartesianChart['type']> = new Set([
  'line',
  'area',
  'bar',
  'scatter',
  'histogram',
])

/**
 * The text of a chart for a screen reader. A chart with two axes gives the chart
 * type, the axes, and the number of series and marks. The other charts give the
 * chart type and the sentence of the chart. The grid has the values.
 */
export function chartSummary(chart: PreparedChart, rowCount = 0): string {
  if (chart.kind === 'empty') return 'The chart has no data.'
  if (chart.kind === 'value') return `${chart.label}: ${chart.text}.`
  if (chart.kind !== 'cartesian' || !AXIS_TYPES.has(chart.type)) {
    const sentence = chartSentence(chart, rowCount)
    return [
      `${CHART_TYPE_LABELS[chart.type]}.`,
      sentence?.what,
      sentence?.size,
      'The Grid view has the values.',
    ].join(' ')
  }
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

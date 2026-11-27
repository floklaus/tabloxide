import type { Column } from '../../results/gridModel'
import type { ChartSettings } from './chartSettings'

/** A chart with more lines than this is not readable. The proposal uses the first ones. */
const MAX_PROPOSED_LINES = 4

function names(columns: Column[], kind: Column['kind']): string[] {
  return columns
    .filter((column) => column.kind === kind)
    .map((column) => column.name)
}

/** The chart view shows a maximum of this number of suggested charts. */
const MAX_SUGGESTIONS = 4

/**
 * Proposes charts from the kinds of the columns, with the best fit first. The
 * rules are fixed. They use no rows, except their number for the single value.
 * The list is empty if no rule applies: the user then selects the columns.
 */
export function proposeCharts(
  columns: Column[],
  rowCount: number,
): ChartSettings[] {
  const numbers = names(columns, 'number')
  const temporal = names(columns, 'temporal')
  const texts = names(columns, 'text')
  const charts: ChartSettings[] = []

  if (rowCount === 1 && columns.length === 1 && numbers.length === 1) {
    charts.push({ type: 'value', y: numbers })
  }
  if (temporal.length > 0 && numbers.length > 0) {
    // One text column divides the rows into series, for example one line for each sensor.
    const hasSeries = texts.length === 1 && numbers.length === 1
    const line: ChartSettings = {
      type: 'line',
      x: temporal[0],
      y: numbers.slice(0, MAX_PROPOSED_LINES),
    }
    if (hasSeries) charts.push({ ...line, series: texts[0] })
    charts.push(line)
  }
  if (texts.length > 0 && numbers.length > 0) {
    charts.push({ type: 'bar', x: texts[0], y: [numbers[0]] })
  }
  if (numbers.length > 1) {
    charts.push({ type: 'scatter', x: numbers[0], y: [numbers[1]] })
  }
  if (numbers.length > 0) {
    charts.push({ type: 'histogram', x: numbers[0], y: [] })
  }
  // A chart can count the rows of each category, also without a number column.
  for (const text of numbers.length === 0 ? texts : texts.slice(0, 1)) {
    charts.push({ type: 'bar', x: text, y: [], countRows: true })
  }
  if (temporal.length > 0 && numbers.length === 0) {
    charts.push({
      type: 'line',
      x: temporal[0],
      y: [],
      countRows: true,
      timeUnit: 'day',
    })
  }
  return charts.slice(0, MAX_SUGGESTIONS)
}

/** The first proposed chart. Returns `null` if no rule applies. */
export function proposeChart(
  columns: Column[],
  rowCount: number,
): ChartSettings | null {
  return proposeCharts(columns, rowCount)[0] ?? null
}

const SHORT_NAMES: Record<ChartSettings['type'], string> = {
  line: 'Line',
  area: 'Area',
  bar: 'Bar',
  scatter: 'Scatter',
  histogram: 'Histogram',
  value: 'Single value',
}

/** The short name of a proposed chart, for example "Line: amount by day, for each kind". */
export function suggestionLabel(chart: ChartSettings): string {
  const name = SHORT_NAMES[chart.type]
  const y = chart.countRows ? 'number of rows' : chart.y.join(', ')
  if (chart.type === 'histogram') return `${name} of ${chart.x}`
  if (chart.type === 'value') return `${name}: ${y}`
  const x =
    chart.timeUnit === undefined ? chart.x : `${chart.timeUnit} of ${chart.x}`
  const series = chart.series === undefined ? '' : `, for each ${chart.series}`
  return `${name}: ${y} by ${x}${series}`
}

/** The score of a result for which no rule gives a proposal. */
const SCORE_NO_PROPOSAL = 0.5

/**
 * The score of the chart view for a result, from 0 to 1. The score 0 hides the
 * view. A result without a proposal has a lower score: the user must select the
 * columns.
 */
export function chartScore(columns: Column[]): number {
  if (columns.length === 0) return 0
  // The number of rows decides only between the single value and the histogram.
  return proposeChart(columns, 2) === null ? SCORE_NO_PROPOSAL : 1
}

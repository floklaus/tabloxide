import type { Column } from '../../results/gridModel'
import type { ChartSettings } from './chartSettings'

/** A chart with more lines than this is not readable. The proposal uses the first ones. */
const MAX_PROPOSED_LINES = 4

function names(columns: Column[], kind: Column['kind']): string[] {
  return columns
    .filter((column) => column.kind === kind)
    .map((column) => column.name)
}

/**
 * Proposes a chart from the kinds of the columns. The rules are fixed. They use
 * no rows, except their number for the single value. Returns `null` if no rule
 * applies: the user then selects the columns.
 */
export function proposeChart(
  columns: Column[],
  rowCount: number,
): ChartSettings | null {
  const numbers = names(columns, 'number')
  const temporal = names(columns, 'temporal')
  const texts = names(columns, 'text')

  if (rowCount === 1 && columns.length === 1 && numbers.length === 1) {
    return { type: 'value', y: numbers }
  }
  if (temporal.length === 1 && numbers.length > 0) {
    // One text column divides the rows into series, for example one line for each sensor.
    const series = texts.length === 1 && numbers.length === 1 ? texts[0] : null
    return {
      type: 'line',
      x: temporal[0],
      y: numbers.slice(0, MAX_PROPOSED_LINES),
      ...(series === null ? {} : { series }),
    }
  }
  if (texts.length === 1 && numbers.length === 1) {
    return { type: 'bar', x: texts[0], y: numbers }
  }
  if (numbers.length === 2 && texts.length === 0 && temporal.length === 0) {
    return { type: 'scatter', x: numbers[0], y: [numbers[1]] }
  }
  if (numbers.length === 1 && columns.length === 1) {
    return { type: 'histogram', x: numbers[0], y: [] }
  }
  return null
}

/** The score of a result that the chart can only count, because it has no number column. */
const SCORE_COUNT_ONLY = 0.2
/** The score of a result with numbers for which no rule gives a proposal. */
const SCORE_NO_PROPOSAL = 0.5

/**
 * The score of the chart view for a result, from 0 to 1. The score 0 hides the
 * view. A result without a number column has a low score: a chart can only count
 * its rows.
 */
export function chartScore(columns: Column[]): number {
  if (columns.length === 0) return 0
  if (!columns.some((column) => column.kind === 'number')) {
    return SCORE_COUNT_ONLY
  }
  // The number of rows decides only between the single value and the histogram.
  return proposeChart(columns, 2) === null ? SCORE_NO_PROPOSAL : 1
}

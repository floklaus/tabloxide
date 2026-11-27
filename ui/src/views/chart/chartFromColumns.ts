import type { Column } from '../../results/gridModel'
import type { ColumnActionSource } from '../viewTypes'
import {
  CHART_ROLES,
  normalize,
  parseChartSettings,
  withType,
  withX,
  type ChartSettings,
} from './chartSettings'
import { proposeChart } from './proposeChart'

/**
 * Makes a chart of the columns that the user selected in the grid. The fixed
 * rules select the chart, as they do for a result with only these columns.
 */
export function chartOfColumns(
  columns: Column[],
  names: string[],
  rowCount: number,
): ChartSettings {
  const selected = columns.filter((column) => names.includes(column.name))
  return (
    proposeChart(selected, rowCount) ?? {
      // No rule fits, for example for a JSON column. The chart counts the rows.
      type: 'bar',
      x: selected[0]?.name,
      y: [],
      countRows: true,
    }
  )
}

/** Adds one column to a chart: a number to the vertical axis, a date to the horizontal axis, and other columns as the series. */
function withColumn(
  settings: ChartSettings,
  column: Column,
  columns: Column[],
): ChartSettings {
  if (column.kind === 'number') {
    if (settings.y.includes(column.name)) return settings
    return normalize({
      ...settings,
      countRows: false,
      y: [...settings.y, column.name],
    })
  }
  if (column.kind === 'temporal' || settings.x === undefined) {
    return withX(settings, column.name, columns)
  }
  return normalize({ ...settings, series: column.name })
}

/**
 * Adds the selected columns to the chart that the result has now. A result
 * without chart settings has the proposed chart.
 */
export function addToChart(
  current: unknown,
  columns: Column[],
  names: string[],
  rowCount: number,
): ChartSettings {
  const parsed = current === undefined ? null : parseChartSettings(current)
  const base: ChartSettings =
    parsed !== null && 'settings' in parsed
      ? parsed.settings
      : (proposeChart(columns, rowCount) ?? { type: 'bar', y: [] })
  // A histogram or a single value has no place for one more column.
  const start =
    CHART_ROLES[base.type].y === 'many' ? base : withType(base, 'bar', columns)
  return columns
    .filter((column) => names.includes(column.name))
    .reduce((settings, column) => withColumn(settings, column, columns), start)
}

/** The actions of the chart view in the menu of a column header of the grid. */
export const CHART_COLUMN_ACTIONS: ColumnActionSource[] = [
  {
    label: (names) =>
      names.length === 1
        ? `Chart the column ${names[0]}`
        : `Chart these ${names.length} columns`,
    settings: ({ columns, names, rowCount }) =>
      chartOfColumns(columns, names, rowCount),
  },
  {
    label: (names) =>
      names.length === 1
        ? `Add ${names[0]} to the chart`
        : `Add these ${names.length} columns to the chart`,
    settings: ({ columns, names, rowCount, current }) =>
      addToChart(current, columns, names, rowCount),
  },
]

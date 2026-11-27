import type { Column } from '../../results/gridModel'

export const CHART_TYPES = [
  'line',
  'area',
  'bar',
  'scatter',
  'histogram',
  'value',
] as const
export type ChartType = (typeof CHART_TYPES)[number]

export const CHART_TYPE_LABELS: Record<ChartType, string> = {
  line: 'Line chart',
  area: 'Area chart',
  bar: 'Bar chart',
  scatter: 'Scatter plot',
  histogram: 'Histogram',
  value: 'Single value',
}

export const AGGREGATES = ['sum', 'mean', 'count', 'min', 'max'] as const
export type Aggregate = (typeof AGGREGATES)[number]

export const AGGREGATE_LABELS: Record<Aggregate, string> = {
  sum: 'Sum',
  mean: 'Mean',
  count: 'Count',
  min: 'Minimum',
  max: 'Maximum',
}

export const SCALES = ['linear', 'log'] as const
export type Scale = (typeof SCALES)[number]

/**
 * The settings of the chart view. The view settings file has this form. The
 * settings have column names and no part of the chart library, thus a file stays
 * valid when the library changes.
 */
export type ChartSettings = {
  type: ChartType
  /** The column of the horizontal axis. A histogram counts the values of this column. */
  x?: string
  /** The columns of the vertical axis. A single value shows the first one. */
  y: string[]
  /** A column that divides the rows into series. */
  series?: string
  /** Combines the rows that have the same `x`. Without it, each row is one mark. */
  aggregate?: Aggregate
  stacked?: boolean
  /** The scale of the vertical axis. Without it, the scale is linear. */
  scale?: Scale
}

/** What each chart type uses from the settings. The settings form shows only these parts. */
export type ChartRoles = {
  x: boolean
  y: 'none' | 'one' | 'many'
  series: boolean
  aggregate: boolean
  stacked: boolean
  scale: boolean
}

export const CHART_ROLES: Record<ChartType, ChartRoles> = {
  line: {
    x: true,
    y: 'many',
    series: true,
    aggregate: true,
    stacked: false,
    scale: true,
  },
  area: {
    x: true,
    y: 'many',
    series: true,
    aggregate: true,
    stacked: true,
    scale: false,
  },
  bar: {
    x: true,
    y: 'many',
    series: true,
    aggregate: true,
    stacked: true,
    scale: true,
  },
  scatter: {
    x: true,
    y: 'many',
    series: true,
    aggregate: false,
    stacked: false,
    scale: true,
  },
  histogram: {
    x: true,
    y: 'none',
    series: false,
    aggregate: false,
    stacked: false,
    scale: false,
  },
  value: {
    x: false,
    y: 'one',
    series: false,
    aggregate: true,
    stacked: false,
    scale: false,
  },
}

function isOneOf<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return values.some((item) => item === value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reads chart settings from a JSON value, for example from the view settings file.
 * Returns the reason as text if the value is not valid.
 */
export function parseChartSettings(
  value: unknown,
): { settings: ChartSettings } | { error: string } {
  if (!isRecord(value)) return { error: 'The settings are not an object.' }
  const { type, x, y, series, aggregate, stacked, scale } = value
  if (!isOneOf(CHART_TYPES, type)) {
    return { error: `The chart type ${JSON.stringify(type)} is not known.` }
  }
  if (x !== undefined && typeof x !== 'string') {
    return { error: 'The setting "x" must be a column name.' }
  }
  const columns = y === undefined ? [] : y
  if (
    !Array.isArray(columns) ||
    columns.some((item) => typeof item !== 'string')
  ) {
    return { error: 'The setting "y" must be a list of column names.' }
  }
  if (series !== undefined && typeof series !== 'string') {
    return { error: 'The setting "series" must be a column name.' }
  }
  if (aggregate !== undefined && !isOneOf(AGGREGATES, aggregate)) {
    return {
      error: `The aggregate ${JSON.stringify(aggregate)} is not known.`,
    }
  }
  if (stacked !== undefined && typeof stacked !== 'boolean') {
    return { error: 'The setting "stacked" must be true or false.' }
  }
  if (scale !== undefined && !isOneOf(SCALES, scale)) {
    return { error: `The scale ${JSON.stringify(scale)} is not known.` }
  }
  return {
    settings: normalize({
      type,
      x,
      y: columns as string[],
      series,
      aggregate,
      stacked,
      scale,
    }),
  }
}

/**
 * Returns the settings with only the parts that have a value and that the chart
 * type uses, in a fixed sequence. Two settings that give the same chart are then
 * equal as JSON text, and the view settings file has no empty parts.
 */
export function normalize(settings: ChartSettings): ChartSettings {
  const roles = CHART_ROLES[settings.type]
  const y =
    roles.y === 'none'
      ? []
      : roles.y === 'one'
        ? settings.y.slice(0, 1)
        : settings.y
  return {
    type: settings.type,
    ...(roles.x && settings.x !== undefined ? { x: settings.x } : {}),
    y,
    ...(roles.series && settings.series !== undefined
      ? { series: settings.series }
      : {}),
    ...(roles.aggregate && settings.aggregate !== undefined
      ? { aggregate: settings.aggregate }
      : {}),
    ...(roles.stacked && settings.stacked ? { stacked: true } : {}),
    ...(roles.scale && settings.scale === 'log' ? { scale: 'log' } : {}),
  }
}

/** The column names of the settings that are not in the result. */
export function missingColumns(
  settings: ChartSettings,
  columns: Column[],
): string[] {
  const names = new Set(columns.map((column) => column.name))
  const used = [settings.x, ...settings.y, settings.series].filter(
    (name): name is string => name !== undefined,
  )
  return [...new Set(used)].filter((name) => !names.has(name))
}

/**
 * Tells what the settings need before the chart can show, as a sentence for the
 * user. Returns `null` if the settings are complete.
 */
export function incompleteReason(settings: ChartSettings): string | null {
  const roles = CHART_ROLES[settings.type]
  if (roles.x && settings.x === undefined) {
    return settings.type === 'histogram'
      ? 'Select the column of the histogram.'
      : 'Select the column of the horizontal axis.'
  }
  if (roles.y !== 'none' && settings.y.length === 0) {
    return settings.type === 'value'
      ? 'Select the column of the value.'
      : 'Select a column of the vertical axis.'
  }
  return null
}

function numberColumns(columns: Column[]): string[] {
  return columns
    .filter((column) => column.kind === 'number')
    .map((column) => column.name)
}

/**
 * Changes the chart type and keeps the columns where the new type can use them.
 * For example, the column of a histogram becomes the vertical axis of a bar chart.
 */
export function withType(
  settings: ChartSettings,
  type: ChartType,
  columns: Column[],
): ChartSettings {
  const numbers = numberColumns(columns)
  const isNumber = (name: string | undefined): name is string =>
    name !== undefined && numbers.includes(name)
  if (type === 'histogram') {
    const x =
      settings.y.find(isNumber) ??
      (isNumber(settings.x) ? settings.x : numbers[0])
    return normalize({ ...settings, type, x })
  }
  // A histogram has its column as `x`. The other types need it as `y`.
  const fromHistogram = settings.type === 'histogram'
  const y =
    settings.y.length > 0
      ? settings.y
      : [fromHistogram ? settings.x : undefined, numbers[0]]
          .filter((name) => name !== undefined)
          .slice(0, 1)
  const keepsX = settings.x !== undefined && !y.includes(settings.x)
  const x = keepsX
    ? settings.x
    : columns.find((column) => !y.includes(column.name))?.name
  return normalize({ ...settings, type, x, y })
}

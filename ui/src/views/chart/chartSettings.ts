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

/** `none`: each row is one mark. Without a value, the chart decides. */
export type AggregateSetting = Aggregate | 'none'

export const SCALES = ['linear', 'log'] as const
export type Scale = (typeof SCALES)[number]

export const TIME_UNITS = ['hour', 'day', 'week', 'month', 'year'] as const
export type TimeUnit = (typeof TIME_UNITS)[number]

export const TIME_UNIT_LABELS: Record<TimeUnit, string> = {
  hour: 'Hour',
  day: 'Day',
  week: 'Week',
  month: 'Month',
  year: 'Year',
}

export const SORTS = ['name', 'value-asc', 'value-desc'] as const
export type Sort = (typeof SORTS)[number]

export const SORT_LABELS: Record<Sort, string> = {
  name: 'By name',
  'value-desc': 'By value, largest first',
  'value-asc': 'By value, smallest first',
}

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
  /** The vertical axis shows the number of rows. The chart then uses no `y` column. */
  countRows?: boolean
  /** A column that divides the rows into series. */
  series?: string
  /**
   * The aggregate of each `y` column, by the name of the column. It combines
   * the rows that have the same `x`. A column without a value lets the chart
   * decide: it shows the sum if the values of `x` repeat, else each row.
   */
  aggregates?: Record<string, AggregateSetting>
  /**
   * The aggregate of the `y` columns that are not in `aggregates`. Files of
   * the first form have it. `normalize` moves it into `aggregates`.
   */
  aggregate?: AggregateSetting
  /** Combines the dates of `x` that are in the same hour, day, week, month, or year. */
  timeUnit?: TimeUnit
  /** The sequence of the categories of `x`. Without it, they are as in the result. */
  sort?: Sort
  stacked?: boolean
  /** The scale of the vertical axis. Without it, the scale is linear. */
  scale?: Scale
}

/** What each chart type uses from the settings. The settings form shows only these parts. */
export type ChartRoles = {
  x: boolean
  y: 'none' | 'one' | 'many'
  /** The vertical axis can show the number of rows. */
  countRows: boolean
  series: boolean
  aggregate: boolean
  /** The horizontal axis can have a time unit and a sort. */
  grouping: boolean
  stacked: boolean
  scale: boolean
}

export const CHART_ROLES: Record<ChartType, ChartRoles> = {
  line: {
    x: true,
    y: 'many',
    countRows: true,
    series: true,
    aggregate: true,
    grouping: true,
    stacked: false,
    scale: true,
  },
  area: {
    x: true,
    y: 'many',
    countRows: true,
    series: true,
    aggregate: true,
    grouping: true,
    stacked: true,
    scale: false,
  },
  bar: {
    x: true,
    y: 'many',
    countRows: true,
    series: true,
    aggregate: true,
    grouping: true,
    stacked: true,
    scale: true,
  },
  scatter: {
    x: true,
    y: 'many',
    countRows: false,
    series: true,
    aggregate: false,
    grouping: false,
    stacked: false,
    scale: true,
  },
  histogram: {
    x: true,
    y: 'none',
    countRows: false,
    series: false,
    aggregate: false,
    grouping: false,
    stacked: false,
    scale: false,
  },
  value: {
    x: false,
    y: 'one',
    countRows: true,
    series: false,
    aggregate: true,
    grouping: false,
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

function isAggregateSetting(value: unknown): value is AggregateSetting {
  return value === 'none' || isOneOf(AGGREGATES, value)
}

function isAggregates(
  value: unknown,
): value is Record<string, AggregateSetting> {
  return isRecord(value) && Object.values(value).every(isAggregateSetting)
}

/**
 * Returns the aggregate setting of a `y` column. `undefined`: the chart decides.
 */
export function aggregateOf(
  settings: ChartSettings,
  column: string,
): AggregateSetting | undefined {
  return settings.aggregates?.[column] ?? settings.aggregate
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
  const { countRows, timeUnit, sort, aggregates } = value
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
  if (
    aggregate !== undefined &&
    aggregate !== 'none' &&
    !isOneOf(AGGREGATES, aggregate)
  ) {
    return {
      error: `The aggregate ${JSON.stringify(aggregate)} is not known.`,
    }
  }
  if (aggregates !== undefined && !isAggregates(aggregates)) {
    return {
      error:
        'The setting "aggregates" must give an aggregate for column names.',
    }
  }
  if (countRows !== undefined && typeof countRows !== 'boolean') {
    return { error: 'The setting "countRows" must be true or false.' }
  }
  if (timeUnit !== undefined && !isOneOf(TIME_UNITS, timeUnit)) {
    return { error: `The time unit ${JSON.stringify(timeUnit)} is not known.` }
  }
  if (sort !== undefined && !isOneOf(SORTS, sort)) {
    return { error: `The sort ${JSON.stringify(sort)} is not known.` }
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
      countRows,
      series,
      aggregates,
      aggregate,
      timeUnit,
      sort,
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
  const countRows = roles.countRows && settings.countRows === true
  const y =
    roles.y === 'none' || countRows
      ? []
      : roles.y === 'one'
        ? settings.y.slice(0, 1)
        : settings.y
  const hasX = roles.x && settings.x !== undefined
  // The entries have the sequence of the columns. An aggregate for all columns
  // of a file of the first form becomes an entry for each column.
  const aggregates = y.flatMap((name): [string, AggregateSetting][] => {
    const aggregate = aggregateOf(settings, name)
    return aggregate === undefined ? [] : [[name, aggregate]]
  })
  return {
    type: settings.type,
    ...(hasX ? { x: settings.x } : {}),
    y,
    ...(countRows ? { countRows: true } : {}),
    ...(roles.series && settings.series !== undefined
      ? { series: settings.series }
      : {}),
    // The number of rows is a count. It has no other aggregate.
    ...(roles.aggregate && aggregates.length > 0
      ? { aggregates: Object.fromEntries(aggregates) }
      : {}),
    ...(roles.grouping && hasX && settings.timeUnit !== undefined
      ? { timeUnit: settings.timeUnit }
      : {}),
    ...(roles.grouping && hasX && settings.sort !== undefined
      ? { sort: settings.sort }
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
  if (roles.y !== 'none' && settings.y.length === 0 && !settings.countRows) {
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
  const keepsCount = settings.countRows === true && CHART_ROLES[type].countRows
  const y =
    settings.y.length > 0 || keepsCount
      ? settings.y
      : [fromHistogram ? settings.x : undefined, numbers[0]]
          .filter((name) => name !== undefined)
          .slice(0, 1)
  const keepsX = settings.x !== undefined && !y.includes(settings.x)
  const x = keepsX
    ? settings.x
    : columns.find((column) => !y.includes(column.name))?.name
  return fitAxisControls(
    normalize({ ...settings, type, x, y, countRows: keepsCount }),
    columns,
  )
}

/** Changes the column of the horizontal axis. */
export function withX(
  settings: ChartSettings,
  x: string | undefined,
  columns: Column[],
): ChartSettings {
  return fitAxisControls(normalize({ ...settings, x }), columns)
}

/** Removes the time unit and the sort if the new column or chart type cannot use them. */
function fitAxisControls(
  settings: ChartSettings,
  columns: Column[],
): ChartSettings {
  const controls = axisControls(settings, columns)
  return normalize({
    ...settings,
    timeUnit: controls.timeUnit ? settings.timeUnit : undefined,
    sort: controls.sort ? settings.sort : undefined,
  })
}

/**
 * Tells which controls the horizontal axis has for the column `x`: a time unit
 * for a date, and a sort for categories. A number axis has no control.
 */
export function axisControls(
  settings: ChartSettings,
  columns: Column[],
): { timeUnit: boolean; sort: boolean } {
  const column = columns.find((item) => item.name === settings.x)
  if (!CHART_ROLES[settings.type].grouping || !column) {
    return { timeUnit: false, sort: false }
  }
  if (column.kind === 'temporal') return { timeUnit: true, sort: false }
  const isCategory = settings.type === 'bar' || column.kind !== 'number'
  return { timeUnit: false, sort: isCategory }
}

/**
 * Tells why a chart type cannot show the columns of a result, as a sentence for
 * the user. Returns `null` if the type can show them.
 */
export function typeProblem(type: ChartType, columns: Column[]): string | null {
  const numbers = numberColumns(columns).length
  if (type === 'histogram' && numbers === 0) {
    return 'A histogram needs a number column. This result has none.'
  }
  if (type === 'scatter' && numbers === 0) {
    return 'A scatter plot needs a number column. This result has none.'
  }
  if (type === 'scatter' && columns.length < 2) {
    return 'A scatter plot needs two columns. This result has one.'
  }
  return null
}

/** Sets the aggregate of one `y` column. `undefined` lets the chart decide. */
export function withAggregate(
  settings: ChartSettings,
  column: string,
  aggregate: AggregateSetting | undefined,
): ChartSettings {
  const aggregates = { ...settings.aggregates }
  if (aggregate === undefined) delete aggregates[column]
  else aggregates[column] = aggregate
  return normalize({ ...settings, aggregates, aggregate: undefined })
}

/** Sets the aggregate None for each `y` column that lets the chart decide. */
export function withEachRow(settings: ChartSettings): ChartSettings {
  const aggregates = Object.fromEntries(
    settings.y.map((name) => [name, aggregateOf(settings, name) ?? 'none']),
  )
  return normalize({ ...settings, aggregates, aggregate: undefined })
}

import type { Column } from '../../results/gridModel'
import {
  CANDLESTICK_COLUMNS,
  CHART_ROLES,
  CHART_TYPES,
  MIN_PARALLEL_AXES,
  needsX,
  roleLabels,
  type ChartType,
} from './chartTypes'

export * from './chartTypes'

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

/** The numbers of categories that the user can select as a limit. */
export const LIMITS = [5, 10, 20, 50] as const
const MAX_LIMIT = 1000

/** How the chart uses a column, when the kind of the result is not what the user wants. */
export const KIND_OVERRIDES = ['number', 'temporal', 'text'] as const
export type KindOverride = (typeof KIND_OVERRIDES)[number]

export const KIND_OVERRIDE_LABELS: Record<KindOverride, string> = {
  number: 'Number',
  temporal: 'Date',
  text: 'Category',
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
  /** A column that gives the size of each mark of a bubble chart. */
  size?: string
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
  /** The chart shows only the first `limit` categories of `x`, in the sequence of the sort. */
  limit?: number
  /** With `limit`: the chart shows the other categories as one category "Other". */
  other?: boolean
  /**
   * How the chart uses a column, by the name of the column. For example, a
   * year is a number, but the user wants categories. Without an entry, the
   * chart uses the kind that the result gives.
   */
  kinds?: Record<string, KindOverride>
  stacked?: boolean
  /** The scale of the vertical axis. Without it, the scale is linear. */
  scale?: Scale
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

function isLimit(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1
    ? (value as number) <= MAX_LIMIT
    : false
}

function isKinds(value: unknown): value is Record<string, KindOverride> {
  return (
    isRecord(value) &&
    Object.values(value).every((kind) => isOneOf(KIND_OVERRIDES, kind))
  )
}

/** Returns the columns with the kinds that the settings give them. */
export function effectiveColumns(
  columns: Column[],
  kinds: ChartSettings['kinds'],
): Column[] {
  if (kinds === undefined) return columns
  return columns.map((column) => {
    const kind = kinds[column.name]
    return kind === undefined ? column : { ...column, kind }
  })
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
  const { countRows, timeUnit, sort, aggregates, limit, other, kinds } = value
  const { size } = value
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
  if (size !== undefined && typeof size !== 'string') {
    return { error: 'The setting "size" must be a column name.' }
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
  if (limit !== undefined && !isLimit(limit)) {
    return {
      error: `The setting "limit" must be a number from 1 to ${MAX_LIMIT}.`,
    }
  }
  if (other !== undefined && typeof other !== 'boolean') {
    return { error: 'The setting "other" must be true or false.' }
  }
  if (kinds !== undefined && !isKinds(kinds)) {
    return {
      error:
        'The setting "kinds" must give "number", "temporal", or "text" for column names.',
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
      countRows,
      series,
      size,
      aggregates,
      aggregate,
      timeUnit,
      sort,
      limit,
      other,
      kinds,
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
  const hasLimit = roles.grouping && hasX && settings.limit !== undefined
  const xKind =
    hasX && settings.type !== 'histogram'
      ? settings.kinds?.[settings.x!]
      : undefined
  return {
    type: settings.type,
    ...(hasX ? { x: settings.x } : {}),
    y,
    ...(countRows ? { countRows: true } : {}),
    ...(roles.series && settings.series !== undefined
      ? { series: settings.series }
      : {}),
    ...(roles.size && settings.size !== undefined
      ? { size: settings.size }
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
    ...(hasLimit ? { limit: settings.limit } : {}),
    ...(hasLimit && settings.other ? { other: true } : {}),
    // Only the column of the horizontal axis can have a different kind.
    ...(xKind === undefined ? {} : { kinds: { [settings.x!]: xKind } }),
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
  const used = [
    settings.x,
    ...settings.y,
    settings.series,
    settings.size,
  ].filter((name): name is string => name !== undefined)
  return [...new Set(used)].filter((name) => !names.has(name))
}

/**
 * Tells what the settings need before the chart can show, as a sentence for the
 * user. Returns `null` if the settings are complete.
 */
export function incompleteReason(settings: ChartSettings): string | null {
  const { type } = settings
  const roles = CHART_ROLES[type]
  const labels = roleLabels(type)
  const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)
  if (needsX(type) && settings.x === undefined) {
    if (type === 'histogram') return 'Select the column of the histogram.'
    return labels.x === 'Horizontal axis'
      ? 'Select the column of the horizontal axis.'
      : `Select the column for "${labels.x}".`
  }
  if (roles.seriesRequired && settings.series === undefined) {
    return `Select the column for "${labels.series}".`
  }
  if (type === 'candlestick' && settings.y.length !== CANDLESTICK_COLUMNS) {
    return 'Select four columns in this sequence: open, high, low, close.'
  }
  if (type === 'parallel' && settings.y.length < MIN_PARALLEL_AXES) {
    return 'Select two or more columns for the axes.'
  }
  if (roles.y !== 'none' && settings.y.length === 0 && !settings.countRows) {
    if (type === 'value') return 'Select the column of the value.'
    return labels.y === 'Vertical axis'
      ? 'Select a column of the vertical axis.'
      : `Select the column for "${lower(labels.y) === 'values' ? 'Values' : labels.y}".`
  }
  if (roles.size && settings.size === undefined) {
    return 'Select the column for the size of the bubbles.'
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
  return withTypeDefaults(
    fitAxisControls(
      normalize({ ...settings, type, x, y, countRows: keepsCount }),
      columns,
    ),
    columns,
  )
}

const CANDLE_NAMES = ['open', 'high', 'low', 'close']
/** Parallel coordinates start with a maximum of this number of axes. */
const MAX_DEFAULT_AXES = 8
/** A new pie chart shows this number of slices and "Other". */
const DEFAULT_SLICES = 10

/** The columns of a candlestick chart: the columns with the usual names, or the first four number columns. */
function candleColumns(columns: Column[]): string[] {
  const named = CANDLE_NAMES.map(
    (wanted) =>
      columns.find((column) => column.name.toLowerCase() === wanted)?.name,
  )
  return named.every((name) => name !== undefined)
    ? (named as string[])
    : numberColumns(columns).slice(0, CANDLESTICK_COLUMNS)
}

/**
 * Gives a new chart type the columns that it needs and that the settings do not
 * have, for example the size of a bubble chart. The user can change each of them.
 */
function withTypeDefaults(
  settings: ChartSettings,
  columns: Column[],
): ChartSettings {
  const numbers = numberColumns(columns)
  const dates = columns.filter((column) => column.kind === 'temporal')
  const kindOf = (name: string | undefined) =>
    columns.find((column) => column.name === name)?.kind
  const isFree = (name: string) =>
    name !== settings.x && !settings.y.includes(name)
  switch (settings.type) {
    case 'candlestick': {
      const y =
        settings.y.length === CANDLESTICK_COLUMNS
          ? settings.y
          : candleColumns(columns)
      const keepsX = settings.x !== undefined && !y.includes(settings.x)
      const x = keepsX
        ? settings.x
        : (dates[0]?.name ??
          columns.find((column) => !y.includes(column.name))?.name)
      return normalize({ ...settings, x, y })
    }
    case 'parallel':
      return settings.y.length >= MIN_PARALLEL_AXES
        ? settings
        : normalize({ ...settings, y: numbers.slice(0, MAX_DEFAULT_AXES) })
    case 'bubble':
      return normalize({
        ...settings,
        size: settings.size ?? numbers.find(isFree),
      })
    case 'heatmap':
    case 'sankey': {
      const free = columns.filter((column) => isFree(column.name))
      // A column that is not a number gives the second group of a chart.
      const second = free.find((column) => column.kind !== 'number') ?? free[0]
      return normalize({
        ...settings,
        series: settings.series ?? second?.name,
      })
    }
    case 'calendar':
      return kindOf(settings.x) === 'temporal' || dates.length === 0
        ? settings
        : normalize({ ...settings, x: dates[0].name })
    case 'boxplot':
      // A box plot has categories. A number column gives one box for each value.
      return kindOf(settings.x) === 'number'
        ? normalize({
            ...settings,
            x: columns.find((column) => column.kind === 'text')?.name,
          })
        : settings
    case 'pie':
      return settings.limit === undefined
        ? withLimit(settings, DEFAULT_SLICES)
        : settings
    default:
      return settings
  }
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
    // A limit is for categories, as the sort is.
    limit: controls.sort ? settings.limit : undefined,
  })
}

/**
 * Tells which controls the horizontal axis has for the column `x`: a time unit
 * for a date, and a sort with a limit for categories. A number axis has no
 * control. The kind of the column is the kind that the settings give it.
 */
export function axisControls(
  settings: ChartSettings,
  columns: Column[],
): { timeUnit: boolean; sort: boolean } {
  const column = effectiveColumns(columns, settings.kinds).find(
    (item) => item.name === settings.x,
  )
  if (!CHART_ROLES[settings.type].grouping || !column) {
    return { timeUnit: false, sort: false }
  }
  if (column.kind === 'temporal') return { timeUnit: true, sort: false }
  const isCategory = settings.type === 'bar' || column.kind !== 'number'
  return { timeUnit: false, sort: isCategory }
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

/**
 * Sets how the chart uses the column of the horizontal axis. `undefined` uses
 * the kind that the result gives. The time unit, the sort, and the limit stay
 * only if the new kind can use them.
 */
export function withKind(
  settings: ChartSettings,
  kind: KindOverride | undefined,
  columns: Column[],
): ChartSettings {
  if (settings.x === undefined) return settings
  const kinds = kind === undefined ? undefined : { [settings.x]: kind }
  return fitAxisControls(normalize({ ...settings, kinds }), columns)
}

/**
 * Sets the number of categories that the chart shows. A new limit also sets the
 * sort by value and the category "Other", because the user then sees the
 * largest categories and loses no value.
 */
export function withLimit(
  settings: ChartSettings,
  limit: number | undefined,
): ChartSettings {
  if (limit === undefined || settings.limit !== undefined) {
    return normalize({ ...settings, limit })
  }
  return normalize({
    ...settings,
    limit,
    other: true,
    sort: settings.sort ?? 'value-desc',
  })
}

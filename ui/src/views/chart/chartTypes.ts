import type { Column } from '../../results/gridModel'

/** The chart types. The sequence is the sequence of the buttons in the chart settings. */
export const CHART_TYPES = [
  'line',
  'area',
  'bar',
  'scatter',
  'histogram',
  'value',
  'bubble',
  'boxplot',
  'heatmap',
  'calendar',
  'pie',
  'funnel',
  'treemap',
  'sunburst',
  'radar',
  'parallel',
  'sankey',
  'candlestick',
] as const
export type ChartType = (typeof CHART_TYPES)[number]

export const CHART_TYPE_LABELS: Record<ChartType, string> = {
  line: 'Line chart',
  area: 'Area chart',
  bar: 'Bar chart',
  scatter: 'Scatter plot',
  histogram: 'Histogram',
  value: 'Single value',
  bubble: 'Bubble chart',
  boxplot: 'Box plot',
  heatmap: 'Heat map',
  calendar: 'Calendar heat map',
  pie: 'Pie chart',
  funnel: 'Funnel chart',
  treemap: 'Tree map',
  sunburst: 'Sunburst chart',
  radar: 'Radar chart',
  parallel: 'Parallel coordinates',
  sankey: 'Sankey diagram',
  candlestick: 'Candlestick chart',
}

/** What each chart type uses from the settings. The chart settings show only these parts. */
export type ChartRoles = {
  x: boolean
  y: 'none' | 'one' | 'many'
  /** The values can be the number of rows. */
  countRows: boolean
  series: boolean
  /** `true` if the chart cannot show without a series column. */
  seriesRequired: boolean
  aggregate: boolean
  /** The column `x` can have a time unit, a sort, and a limit. */
  grouping: boolean
  stacked: boolean
  scale: boolean
  /** A column gives the size of each mark. */
  size: boolean
}

export const CHART_ROLES: Record<ChartType, ChartRoles> = {
  line: {
    x: true,
    y: 'many',
    countRows: true,
    series: true,
    seriesRequired: false,
    aggregate: true,
    grouping: true,
    stacked: false,
    scale: true,
    size: false,
  },
  area: {
    x: true,
    y: 'many',
    countRows: true,
    series: true,
    seriesRequired: false,
    aggregate: true,
    grouping: true,
    stacked: true,
    scale: false,
    size: false,
  },
  bar: {
    x: true,
    y: 'many',
    countRows: true,
    series: true,
    seriesRequired: false,
    aggregate: true,
    grouping: true,
    stacked: true,
    scale: true,
    size: false,
  },
  scatter: {
    x: true,
    y: 'many',
    countRows: false,
    series: true,
    seriesRequired: false,
    aggregate: false,
    grouping: false,
    stacked: false,
    scale: true,
    size: false,
  },
  histogram: {
    x: true,
    y: 'none',
    countRows: false,
    series: false,
    seriesRequired: false,
    aggregate: false,
    grouping: false,
    stacked: false,
    scale: false,
    size: false,
  },
  value: {
    x: false,
    y: 'one',
    countRows: true,
    series: false,
    seriesRequired: false,
    aggregate: true,
    grouping: false,
    stacked: false,
    scale: false,
    size: false,
  },
  bubble: {
    x: true,
    y: 'one',
    countRows: false,
    series: true,
    seriesRequired: false,
    aggregate: false,
    grouping: false,
    stacked: false,
    scale: true,
    size: true,
  },
  boxplot: {
    x: true,
    y: 'one',
    countRows: false,
    series: false,
    seriesRequired: false,
    aggregate: false,
    grouping: true,
    stacked: false,
    scale: false,
    size: false,
  },
  heatmap: {
    x: true,
    y: 'one',
    countRows: true,
    series: true,
    seriesRequired: true,
    aggregate: true,
    grouping: true,
    stacked: false,
    scale: false,
    size: false,
  },
  calendar: {
    x: true,
    y: 'one',
    countRows: true,
    series: false,
    seriesRequired: false,
    aggregate: true,
    grouping: false,
    stacked: false,
    scale: false,
    size: false,
  },
  pie: {
    x: true,
    y: 'one',
    countRows: true,
    series: false,
    seriesRequired: false,
    aggregate: true,
    grouping: true,
    stacked: false,
    scale: false,
    size: false,
  },
  funnel: {
    x: true,
    y: 'one',
    countRows: true,
    series: false,
    seriesRequired: false,
    aggregate: true,
    grouping: true,
    stacked: false,
    scale: false,
    size: false,
  },
  treemap: {
    x: true,
    y: 'one',
    countRows: true,
    series: true,
    seriesRequired: false,
    aggregate: true,
    grouping: false,
    stacked: false,
    scale: false,
    size: false,
  },
  sunburst: {
    x: true,
    y: 'one',
    countRows: true,
    series: true,
    seriesRequired: false,
    aggregate: true,
    grouping: false,
    stacked: false,
    scale: false,
    size: false,
  },
  radar: {
    x: true,
    y: 'many',
    countRows: true,
    series: true,
    seriesRequired: false,
    aggregate: true,
    grouping: true,
    stacked: false,
    scale: false,
    size: false,
  },
  parallel: {
    x: false,
    y: 'many',
    countRows: false,
    series: true,
    seriesRequired: false,
    aggregate: false,
    grouping: false,
    stacked: false,
    scale: false,
    size: false,
  },
  sankey: {
    x: true,
    y: 'one',
    countRows: true,
    series: true,
    seriesRequired: true,
    aggregate: true,
    grouping: false,
    stacked: false,
    scale: false,
    size: false,
  },
  candlestick: {
    x: true,
    y: 'many',
    countRows: false,
    series: false,
    seriesRequired: false,
    aggregate: false,
    grouping: false,
    stacked: false,
    scale: false,
    size: false,
  },
}

/** The names of the parts of the settings in the chart settings, where a chart type has its own name. */
export type RoleLabels = { x: string; y: string; series: string }

const DEFAULT_LABELS: RoleLabels = {
  x: 'Horizontal axis',
  y: 'Vertical axis',
  series: 'Series',
}

const OWN_LABELS: Partial<Record<ChartType, Partial<RoleLabels>>> = {
  histogram: { x: 'Column' },
  value: { y: 'Value' },
  bubble: { y: 'Vertical axis' },
  boxplot: { x: 'Category', y: 'Value' },
  heatmap: { x: 'Columns', series: 'Rows', y: 'Value' },
  calendar: { x: 'Date', y: 'Value' },
  pie: { x: 'Category', y: 'Value' },
  funnel: { x: 'Stage', y: 'Value' },
  treemap: { x: 'Group', series: 'Subgroup', y: 'Value' },
  sunburst: { x: 'Group', series: 'Subgroup', y: 'Value' },
  radar: { x: 'Axes', y: 'Values' },
  parallel: { y: 'Axes', series: 'Colour' },
  sankey: { x: 'Source', series: 'Target', y: 'Value' },
  candlestick: { y: 'Open, high, low, close' },
}

export function roleLabels(type: ChartType): RoleLabels {
  return { ...DEFAULT_LABELS, ...OWN_LABELS[type] }
}

/** A candlestick has these four columns on the vertical axis, in this sequence. */
export const CANDLESTICK_COLUMNS = 4
/** Parallel coordinates need a minimum of this number of axes. */
export const MIN_PARALLEL_AXES = 2

/** The chart types that show without a column of the horizontal axis. */
const X_OPTIONAL: ReadonlySet<ChartType> = new Set(['boxplot'])

export function needsX(type: ChartType): boolean {
  return CHART_ROLES[type].x && !X_OPTIONAL.has(type)
}

/**
 * Tells why a chart type cannot show the columns of a result, as a sentence for
 * the user. Returns `null` if the type can show them.
 */
export function typeProblem(type: ChartType, columns: Column[]): string | null {
  const numbers = columns.filter((column) => column.kind === 'number').length
  const dates = columns.filter((column) => column.kind === 'temporal').length
  const label = CHART_TYPE_LABELS[type]
  const article = /^[AEIOU]/.test(label) ? 'An' : 'A'
  // "Parallel coordinates" is a plural.
  const subject =
    type === 'parallel'
      ? `${label} need`
      : `${article} ${label.charAt(0).toLowerCase()}${label.slice(1)} needs`
  const needsNumbers: Partial<Record<ChartType, number>> = {
    histogram: 1,
    scatter: 1,
    boxplot: 1,
    bubble: 2,
    parallel: MIN_PARALLEL_AXES,
    candlestick: CANDLESTICK_COLUMNS,
  }
  const wanted = needsNumbers[type] ?? 0
  if (numbers < wanted) {
    const need = wanted === 1 ? 'a number column' : `${wanted} number columns`
    const has = numbers === 0 ? 'none' : `${numbers}`
    return `${subject} ${need}. This result has ${has}.`
  }
  const needsColumns: Partial<Record<ChartType, number>> = {
    scatter: 2,
    bubble: 3,
    heatmap: 2,
    sankey: 2,
  }
  const columnCount = needsColumns[type] ?? 0
  if (columns.length < columnCount) {
    return `${subject} ${columnCount} columns. This result has ${columns.length}.`
  }
  if (type === 'calendar' && dates === 0) {
    return `${subject} a date column. This result has none.`
  }
  return null
}

import type { Aggregate, TimeUnit } from './chartSettings'

/** The chart colours have this number of steps. A chart never shows more series. */
export const MAX_SERIES = 8
/** The name of the category and of the series that has the rest. */
export const OTHER_NAME = 'Other'
/** The name of the series and of the axis when the chart counts rows. */
export const ROW_COUNT_NAME = 'Number of rows'

export type AxisKind = 'category' | 'value' | 'time'

/** A fact about the chart that the user must know. The chart view shows each note as text. */
export type ChartNote =
  | { id: 'not-numbers'; column: string; count: number }
  | { id: 'not-times'; column: string; count: number }
  | { id: 'empty-x'; count: number }
  | { id: 'series-limit'; shown: number; total: number; hasOther: boolean }
  | { id: 'category-limit'; shown: number; total: number; hasOther: boolean }
  | { id: 'duplicates'; count: number }
  | { id: 'not-positive'; count: number }
  | { id: 'first-row'; rows: number }
  /** The chart shows only the first marks, because more marks are too slow. */
  | { id: 'point-limit'; shown: number; total: number }
  /** A calendar shows only the last years. */
  | { id: 'year-limit'; shown: number; total: number }
  /** Rows that the chart cannot show, because a value is empty or not a number. */
  | { id: 'incomplete-rows'; count: number }
  /** The links of a Sankey diagram go in a circle. */
  | { id: 'cycle' }

export type ChartSeries = {
  name: string
  /** With a category axis: one value for each category. */
  values: (number | null)[]
  /** With a value axis or a time axis: the positions of the marks. */
  points: [number, number][]
  /** In a bubble chart: the size value of each mark of `points`. */
  sizes?: number[]
}

/** The chart types that have series of values for categories or for positions. */
export type SeriesChartType =
  | 'line'
  | 'area'
  | 'bar'
  | 'scatter'
  | 'histogram'
  | 'bubble'
  | 'heatmap'
  | 'calendar'
  | 'pie'
  | 'funnel'
  | 'treemap'
  | 'sunburst'
  | 'radar'
  | 'sankey'
  | 'candlestick'

/**
 * A chart with series of values. The values are for categories, or they are
 * marks at positions. A pie chart, a heat map, and a Sankey diagram also have
 * this form: their categories and series are slices, cells, or links.
 */
export type CartesianChart = {
  kind: 'cartesian'
  type: SeriesChartType
  xAxis: AxisKind
  /** The column of the horizontal axis. */
  xName: string
  /** `null` if the series have different columns. The legend then gives the names. */
  yName: string | null
  /** The columns of the vertical axis. Empty if the chart counts rows. */
  yColumns: string[]
  /** `true` if the vertical axis shows the number of rows. */
  countsRows: boolean
  /** The aggregate of each column of `yColumns`. `null`: each row is one mark. */
  yAggregates: (Aggregate | null)[]
  /** The aggregate that a column without a setting gets. `null`: each row is one mark. */
  automatic: Aggregate | null
  /** `true` if the chart combined the rows of a column that has no aggregate setting. */
  isAutoAggregate: boolean
  /** The time unit that combines the dates of the horizontal axis. */
  timeUnit: TimeUnit | null
  /** The column that divides the rows into series. */
  seriesColumn: string | null
  /** The column that gives the size of the marks of a bubble chart. */
  sizeColumn: string | null
  /** The limit of the categories, if the chart has more categories than the limit. */
  limit: { shown: number; hasOther: boolean } | null
  /** The positions of the series "Other", which have the rest of the series. */
  otherSeries: number[]
  categories: string[]
  series: ChartSeries[]
  /** The number of marks of all series. */
  pointCount: number
  notes: ChartNote[]
}

/** The five numbers of a box: the low whisker, the first quartile, the median, the third quartile, the high whisker. */
export type Box = [number, number, number, number, number]

/** A box plot: the distribution of a number column, for all rows or for each category. */
export type BoxChart = {
  kind: 'box'
  type: 'boxplot'
  /** The column of the categories. `null`: one box for all rows. */
  xName: string | null
  yName: string
  timeUnit: TimeUnit | null
  categories: string[]
  boxes: Box[]
  /** The values outside the whiskers: the position of the category, and the value. */
  outliers: [number, number][]
  /** The number of boxes. */
  pointCount: number
  notes: ChartNote[]
}

/** Parallel coordinates: one line for each row, with one axis for each column. */
export type RowsChart = {
  kind: 'rows'
  type: 'parallel'
  axes: string[]
  seriesColumn: string | null
  groups: { name: string; lines: number[][] }[]
  /** The positions of the groups "Other". */
  otherSeries: number[]
  /** The number of lines. */
  pointCount: number
  notes: ChartNote[]
}

/** A chart that the chart library draws. */
export type DrawnChart = CartesianChart | BoxChart | RowsChart

export type PreparedChart =
  | DrawnChart
  | { kind: 'value'; label: string; text: string; notes: ChartNote[] }
  | { kind: 'empty'; notes: ChartNote[] }

import type { Column, Row } from '../../results/gridModel'
import {
  MAX_SERIES,
  OTHER_NAME,
  ROW_COUNT_NAME,
  type AxisKind,
  type CartesianChart,
  type ChartSeries,
  type PreparedChart,
  type SeriesChartType,
} from './chartModel'
import { Notes } from './chartNotes'
import {
  aggregateOf,
  type Aggregate,
  type ChartSettings,
  type Sort,
  type TimeUnit,
} from './chartSettings'
import {
  accumulate,
  merge,
  newAccumulator,
  result,
  type Accumulator,
} from './chartStats'
import {
  bucketLabel,
  floorToUnit,
  makeTimeScale,
  parseMoment,
  toNumber,
} from './chartValues'

/** The name of the series of the rows that have no value in the series column. */
const EMPTY_SERIES = '(empty)'

export function indexOf(columns: Column[], name: string | undefined): number {
  return name === undefined
    ? -1
    : columns.findIndex((column) => column.name === name)
}

/** A column of the vertical axis. The index -1 is the number of rows, which has no column. */

export type YColumn = {
  index: number
  name: string
  /** The aggregate that the chart uses for the column. `null`: each row is one mark. */
  aggregate: Aggregate | null
}

export const ROW_COUNT: YColumn = {
  index: -1,
  name: ROW_COUNT_NAME,
  aggregate: 'count',
}

/**
 * Reads the value of a row for the vertical axis. With the aggregate `count`,
 * each cell that is not empty counts, also a cell that is not a number.
 */
export function yValue(row: Row, y: YColumn, notes: Notes): number | null {
  if (y.index < 0) return 1
  const cell = row[y.index]
  if (cell === null) return null
  if (y.aggregate === 'count') return 1
  const value = toNumber(cell)
  if (value === null) {
    notes.count({ id: 'not-numbers', column: y.name, count: 1 })
  }
  return value
}

export type SeriesPlan = {
  /** Returns the index of the series of a row and a `y` column. -1: the chart does not show it. */
  seriesOf: (row: Row, yPosition: number) => number
  /** Returns the key of the series group of a row, to find rows that repeat. */
  groupOf: (row: Row) => string
  /** Returns the position of the `y` column of a series. */
  yOf: (series: number) => number
  names: string[]
  /** The positions of the series "Other". */
  other: number[]
}

/** Decides the series of the chart: one for each `y` column and each value of the series column. */
export function planSeries(
  rows: Row[],
  yNames: string[],
  seriesIndex: number,
  notes: Notes,
  /** The largest number of series. */
  max: number = MAX_SERIES,
  /** `true`: one series "Other" has the groups that have no place. */
  canFold = true,
): SeriesPlan {
  const shownY = yNames.slice(0, max)
  if (seriesIndex < 0) {
    if (yNames.length > shownY.length) {
      notes.add({
        id: 'series-limit',
        shown: shownY.length,
        total: yNames.length,
        hasOther: false,
      })
    }
    return {
      seriesOf: (_row, yPosition) =>
        yPosition < shownY.length ? yPosition : -1,
      groupOf: () => '',
      yOf: (series) => series,
      names: shownY,
      other: [],
    }
  }
  const groups = new Map<string, number>()
  for (const row of rows) {
    const key = row[seriesIndex] ?? EMPTY_SERIES
    if (!groups.has(key)) groups.set(key, groups.size)
  }
  const room = Math.max(1, Math.floor(max / shownY.length))
  // The last place is for "Other", which has the rows of the groups without a place.
  const hasOther = canFold && groups.size > room && room > 1
  const kept = hasOther ? room - 1 : Math.min(room, groups.size)
  const groupNames = [...groups.keys()].slice(0, kept)
  if (hasOther) groupNames.push(OTHER_NAME)
  const names = groupNames.flatMap((group) =>
    shownY.length === 1 ? [group] : shownY.map((y) => `${group} · ${y}`),
  )
  const total = groups.size * yNames.length
  const shown = kept * shownY.length
  if (total > shown) {
    notes.add({ id: 'series-limit', shown, total, hasOther })
  }
  const groupOf = (row: Row): number => {
    const group = groups.get(row[seriesIndex] ?? EMPTY_SERIES) ?? -1
    if (group < kept) return group
    return hasOther ? kept : -1
  }
  return {
    seriesOf: (row, yPosition) => {
      const group = groupOf(row)
      if (group < 0 || yPosition >= shownY.length) return -1
      return group * shownY.length + yPosition
    },
    groupOf: (row) => String(groupOf(row)),
    yOf: (series) => series % shownY.length,
    names,
    other: hasOther ? shownY.map((_, y) => kept * shownY.length + y) : [],
  }
}

/** `true` if the cells of the column are dates that a time axis can show. */

export function hasDates(column: Column, rows: Row[], xIndex: number): boolean {
  if (column.kind !== 'temporal') return false
  // A time without a date has no position on a time axis. It is a category.
  const first = rows.find((row) => row[xIndex] !== null)?.[xIndex]
  return first == null || parseMoment(first) !== null
}

/** The position of a row on the horizontal axis. */
type XValue = {
  /** The category, or the position on a value axis or a time axis. */
  key: string | number
  /** The sequence of a category that is a time bucket. */
  order: number
}

/**
 * Returns the function that reads the horizontal position of a cell. It returns
 * `null` for a cell that the axis cannot show, and counts such cells in `notes`.
 */
export function xReader(
  axis: AxisKind,
  column: string,
  unit: TimeUnit | null,
  notes: Notes,
): (cell: string) => XValue | null {
  if (axis === 'value') {
    return (cell) => {
      const x = toNumber(cell)
      if (x === null) notes.count({ id: 'not-numbers', column, count: 1 })
      return x === null ? null : { key: x, order: x }
    }
  }
  if (axis === 'category' && unit === null) {
    return (cell) => ({ key: cell, order: 0 })
  }
  const timeScale = makeTimeScale()
  return (cell) => {
    const moment = parseMoment(cell)
    if (moment === null) {
      notes.count({ id: 'not-times', column, count: 1 })
      return null
    }
    const position = timeScale(moment)
    const start = unit === null ? position : floorToUnit(position, unit)
    // A bar chart shows a time bucket as a category with the name of the bucket.
    return axis === 'category' && unit !== null
      ? { key: bucketLabel(start, unit), order: start }
      : { key: start, order: start }
  }
}

export type Input = {
  settings: ChartSettings
  columns: Column[]
  rows: Row[]
  notes: Notes
}

/** What the chart does with the rows. The functions below share this plan. */
/** The chart types of this module. A histogram has its own preparation. */
export type SeriesType = Exclude<SeriesChartType, 'histogram'>

/** The types whose marks have a position on a value axis or a time axis, if the column gives one. */
const POSITION_TYPES: ReadonlySet<SeriesType> = new Set([
  'line',
  'area',
  'scatter',
  'bubble',
])
/** The types that show each row as one mark and never combine rows. */
const ROW_TYPES: ReadonlySet<SeriesType> = new Set([
  'scatter',
  'bubble',
  'candlestick',
])
/** The types whose series have the chart colours. They show a maximum of `MAX_SERIES` series. */
const COLOUR_TYPES: ReadonlySet<SeriesType> = new Set([
  'line',
  'area',
  'bar',
  'scatter',
  'bubble',
  'radar',
])
/** The largest number of groups of a series column that has no colours, for example the rows of a heat map. */
const MAX_GROUPS = 200
/** The largest number of categories of a chart type. More categories are not readable or too slow. */
const CATEGORY_CAPS: Partial<Record<SeriesType, number>> = {
  pie: 50,
  funnel: 50,
  radar: 30,
  heatmap: 500,
  treemap: 500,
  sunburst: 500,
  sankey: 500,
  candlestick: 5000,
}
/** A bubble chart draws each mark with its own size. More marks than this are too slow. */
const MAX_BUBBLES = 5000

type Layout = {
  type: SeriesType
  axis: AxisKind
  xIndex: number
  xName: string
  unit: TimeUnit | null
  y: YColumn[]
  series: SeriesPlan
  /** The column of the size of a bubble. -1: the chart has no size column. */
  sizeIndex: number
}

/** `true` if two rows of one series have the same horizontal position. */

function hasRepeats(input: Input, layout: Layout): boolean {
  const read = xReader(layout.axis, layout.xName, layout.unit, new Notes())
  const seen = new Set<string>()
  for (const row of input.rows) {
    const cell = row[layout.xIndex]
    const x = cell === null ? null : read(cell)
    if (x === null) continue
    const key = `${layout.series.groupOf(row)}\u0000${x.key}`
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

function prepareCategories(
  input: Input,
  layout: Layout,
): Pick<CartesianChart, 'categories' | 'series' | 'limit'> {
  const { settings, rows, notes } = input
  const { series: plan } = layout
  const read = xReader('category', layout.xName, layout.unit, notes)
  // Without groups, each row is its own category, also when a name repeats.
  const hasGroups =
    settings.series !== undefined || layout.y.some((y) => y.aggregate !== null)
  const categories: string[] = []
  const orders: number[] = []
  const positions = new Map<string, number>()
  const cells: (Accumulator | undefined)[][] = plan.names.map(() => [])

  for (const row of rows) {
    const cell = row[layout.xIndex]
    if (cell === null) {
      notes.count({ id: 'empty-x', count: 1 })
      continue
    }
    const x = read(cell)
    if (x === null) continue
    const label = String(x.key)
    let position = hasGroups ? positions.get(label) : undefined
    if (position === undefined) {
      position = categories.length
      categories.push(label)
      orders.push(x.order)
      positions.set(label, position)
    }
    layout.y.forEach((y, yPosition) => {
      const series = plan.seriesOf(row, yPosition)
      if (series < 0) return
      const value = yValue(row, y, notes)
      if (value === null) return
      const found = cells[series][position]
      if (found && y.aggregate === null) {
        notes.count({ id: 'duplicates', count: 1 })
        return
      }
      const target = found ?? newAccumulator()
      accumulate(target, value)
      cells[series][position] = target
    })
  }
  // A column without an aggregate has one row in each cell. The sum is that row.
  const valueOf = (series: number, cell: Accumulator | undefined) =>
    cell ? result(cell, layout.y[plan.yOf(series)].aggregate ?? 'sum') : null
  const data = {
    categories,
    series: plan.names.map((name, index) => ({
      name,
      values: categories.map((_, position) =>
        valueOf(index, cells[index][position]),
      ),
      points: [],
    })),
  }
  // Time buckets are in the sequence of the time. Other categories use the sort setting.
  if (layout.unit !== null) {
    return { ...reorder(data, byNumber(orders)), limit: null }
  }
  const order =
    settings.sort === undefined
      ? categories.map((_, index) => index)
      : sortOrder(data, settings.sort)
  // A chart type can have a largest number of categories, also without a limit of the settings.
  const cap = CATEGORY_CAPS[layout.type] ?? Infinity
  const limit = Math.min(settings.limit ?? Infinity, cap)
  if (order.length <= limit) {
    return { ...reorder(data, order), limit: null }
  }
  // The category "Other" has the rows of the categories after the limit.
  const shown = reorder(data, order.slice(0, limit))
  const rest = order.slice(limit)
  const hasOther = settings.other === true && settings.limit === limit
  notes.add({
    id: 'category-limit',
    shown: limit,
    total: order.length,
    hasOther,
  })
  if (!hasOther) return { ...shown, limit: { shown: limit, hasOther } }
  return {
    categories: [...shown.categories, OTHER_NAME],
    series: shown.series.map((series, index) => ({
      ...series,
      values: [
        ...series.values,
        valueOf(index, merge(rest.map((position) => cells[index][position]))),
      ],
    })),
    limit: { shown: limit, hasOther },
  }
}

/** Combines the cells of some categories into one cell. */

type Categories = Pick<CartesianChart, 'categories' | 'series'>

export function byNumber(values: number[]): number[] {
  return values.map((_, index) => index).sort((a, b) => values[a] - values[b])
}

const collator = new Intl.Collator('en', { numeric: true })

/** Returns the positions of the categories in the sequence of the sort. */
export function sortOrder(data: Categories, sort: Sort): number[] {
  const indexes = data.categories.map((_, index) => index)
  if (sort === 'name') {
    return indexes.sort(
      (a, b) =>
        collator.compare(data.categories[a], data.categories[b]) || a - b,
    )
  }
  // The value of a category is the total of its series. A category without a value is last.
  const totals = indexes.map((index) => {
    const values = data.series
      .map((series) => series.values[index])
      .filter((value) => value !== null)
    return values.length === 0
      ? null
      : values.reduce((total, value) => total + value, 0)
  })
  const sign = sort === 'value-asc' ? 1 : -1
  return indexes.sort((a, b) => {
    const left = totals[a]
    const right = totals[b]
    if (left === null || right === null) {
      return left === right ? a - b : left === null ? 1 : -1
    }
    return sign * (left - right) || a - b
  })
}

function reorder(data: Categories, order: number[]): Categories {
  return {
    categories: order.map((index) => data.categories[index]),
    series: data.series.map((series) => ({
      ...series,
      values: order.map((index) => series.values[index]),
    })),
  }
}

function preparePoints(
  input: Input,
  layout: Layout,
): Pick<CartesianChart, 'categories' | 'series' | 'limit'> {
  const { rows, notes } = input
  const { series: plan } = layout
  const read = xReader(layout.axis, layout.xName, layout.unit, notes)
  const points: [number, number][][] = plan.names.map(() => [])
  const sizes: number[][] = plan.names.map(() => [])
  const groups: Map<number, Accumulator>[] = plan.names.map(() => new Map())
  const sizeName =
    layout.sizeIndex < 0 ? '' : input.columns[layout.sizeIndex].name
  /** The number of bubbles of the result, also of those after the limit. */
  let bubbles = 0

  for (const row of rows) {
    const cell = row[layout.xIndex]
    if (cell === null) {
      notes.count({ id: 'empty-x', count: 1 })
      continue
    }
    const x = read(cell)
    if (x === null) continue
    const position = x.order
    layout.y.forEach((y, yPosition) => {
      const series = plan.seriesOf(row, yPosition)
      if (series < 0) return
      const value = yValue(row, y, notes)
      if (value === null) return
      if (layout.sizeIndex >= 0) {
        const cell = row[layout.sizeIndex]
        const size = cell === null ? null : toNumber(cell)
        if (size === null) {
          if (cell !== null) {
            notes.count({ id: 'not-numbers', column: sizeName, count: 1 })
          }
          return
        }
        bubbles += 1
        if (bubbles > MAX_BUBBLES) return
        sizes[series].push(size)
      }
      if (y.aggregate === null) {
        points[series].push([position, value])
        return
      }
      let target = groups[series].get(position)
      if (!target) {
        target = newAccumulator()
        groups[series].set(position, target)
      }
      accumulate(target, value)
    })
  }

  if (bubbles > MAX_BUBBLES) {
    notes.add({ id: 'point-limit', shown: MAX_BUBBLES, total: bubbles })
  }
  return {
    limit: null,
    categories: [],
    series: plan.names.map((name, index) => {
      const { aggregate } = layout.y[plan.yOf(index)]
      const marks: [number, number][] =
        aggregate === null
          ? points[index]
          : [...groups[index]].flatMap(([x, group]) => {
              const value = result(group, aggregate)
              return value === null ? [] : [[x, value] as [number, number]]
            })
      // A line goes from the left to the right. A scatter plot keeps the row sequence.
      if (!ROW_TYPES.has(layout.type)) marks.sort((a, b) => a[0] - b[0])
      return layout.sizeIndex < 0
        ? { name, values: [], points: marks }
        : { name, values: [], points: marks, sizes: sizes[index] }
    }),
  }
}

/** A logarithmic axis cannot show zero or a negative value. This removes such values. */

function removeNotPositive(series: ChartSeries[], notes: Notes): ChartSeries[] {
  return series.map((item) => {
    const values = item.values.map((value) => {
      if (value === null || value > 0) return value
      notes.count({ id: 'not-positive', count: 1 })
      return null
    })
    const points = item.points.filter(([, y]) => {
      if (y > 0) return true
      notes.count({ id: 'not-positive', count: 1 })
      return false
    })
    return { ...item, values, points }
  })
}

function countMarks(series: ChartSeries[]): number {
  return series.reduce(
    (total, item) =>
      total +
      item.points.length +
      item.values.filter((value) => value !== null).length,
    0,
  )
}

/** Reads the settings and the columns, and decides the axis and the columns of the chart. */

function planLayout(input: Input, type: Layout['type']): Layout | null {
  const { settings, columns, rows, notes } = input
  const xIndex = indexOf(columns, settings.x)
  // `planAggregates` sets the aggregate of each column.
  const y: YColumn[] = settings.countRows
    ? [ROW_COUNT]
    : settings.y
        .map((name) => indexOf(columns, name))
        .filter((index) => index >= 0)
        .map((index) => ({
          index,
          name: columns[index].name,
          aggregate: null,
        }))
  if (xIndex < 0 || y.length === 0) return null

  // A kind of the settings is a decision of the user. The axis does not fall back to categories.
  const isForcedDate = settings.kinds?.[columns[xIndex].name] === 'temporal'
  const isDate = isForcedDate || hasDates(columns[xIndex], rows, xIndex)
  const isNumber = columns[xIndex].kind === 'number'
  // A line or a point has a position, if the column gives one. A bubble always
  // has one. The other types have categories.
  const hasPosition = POSITION_TYPES.has(type)
  const axis: AxisKind = !hasPosition
    ? 'category'
    : isDate
      ? 'time'
      : isNumber || type === 'bubble'
        ? 'value'
        : 'category'
  const canGroup = isDate && !ROW_TYPES.has(type)
  // A calendar has one cell for each day.
  const unit =
    type === 'calendar' ? 'day' : canGroup ? (settings.timeUnit ?? null) : null
  const hasColours = COLOUR_TYPES.has(type)
  return {
    type,
    axis,
    xIndex,
    xName: columns[xIndex].name,
    unit,
    y,
    series: planSeries(
      rows,
      y.map((item) => item.name),
      indexOf(columns, settings.series),
      notes,
      hasColours ? MAX_SERIES : MAX_GROUPS,
      hasColours,
    ),
    sizeIndex: type === 'bubble' ? indexOf(columns, settings.size) : -1,
  }
}

/**
 * Decides the aggregate of each column. A count of rows is always a count. A
 * column without a setting lets the chart decide: it shows the sum if positions
 * repeat or if the horizontal axis has a time unit.
 */
function planAggregates(
  input: Input,
  layout: Layout,
): { y: YColumn[]; automatic: Aggregate | null; isAuto: boolean } {
  const { settings } = input
  if (settings.countRows || ROW_TYPES.has(layout.type)) {
    return { y: layout.y, automatic: null, isAuto: false }
  }
  // A time unit combines rows, also when each bucket has only one row now.
  const repeats = hasRepeats(input, layout)
  const combines = layout.unit !== null || repeats
  const automatic: Aggregate | null = combines ? 'sum' : null
  // The days of a calendar are not a choice of the user. Without a repeat, the chart tells nothing.
  const tells = layout.type !== 'calendar' || repeats
  let isAuto = false
  const y = layout.y.map((column): YColumn => {
    const setting = aggregateOf(settings, column.name)
    if (setting === undefined) {
      isAuto ||= automatic !== null && tells
      return { ...column, aggregate: automatic }
    }
    return { ...column, aggregate: setting === 'none' ? null : setting }
  })
  return { y, automatic, isAuto }
}

export function prepareCartesian(
  input: Input,
  type: SeriesType,
): PreparedChart {
  const { settings, notes } = input
  const plan = planLayout(input, type)
  if (plan === null) return { kind: 'empty', notes: [] }
  const { y, automatic, isAuto } = planAggregates(input, plan)
  const layout: Layout = { ...plan, y }

  const data =
    layout.axis === 'category'
      ? prepareCategories(input, layout)
      : preparePoints(input, layout)
  const series =
    settings.scale === 'log'
      ? removeNotPositive(data.series, notes)
      : data.series
  const pointCount = countMarks(series)
  if (pointCount === 0) return { kind: 'empty', notes: notes.list() }

  const shown = settings.countRows ? [] : layout.y
  const [first] = shown
  const prefix = first?.aggregate ? `${first.aggregate} of ` : ''
  const yName = settings.countRows
    ? ROW_COUNT_NAME
    : shown.length === 1
      ? `${prefix}${first.name}`
      : null
  return {
    kind: 'cartesian',
    type,
    xAxis: layout.axis,
    xName: layout.xName,
    yName,
    yColumns: shown.map((column) => column.name),
    yAggregates: shown.map((column) => column.aggregate),
    countsRows: settings.countRows === true,
    automatic,
    isAutoAggregate: isAuto,
    timeUnit: layout.unit,
    seriesColumn: settings.series ?? null,
    sizeColumn: layout.sizeIndex < 0 ? null : (settings.size ?? null),
    limit: data.limit,
    otherSeries: layout.series.other,
    categories: data.categories,
    series,
    pointCount,
    notes: notes.list(),
  }
}

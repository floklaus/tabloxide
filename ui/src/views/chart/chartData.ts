import type { Column, Row } from '../../results/gridModel'
import type { Aggregate, ChartSettings, Sort, TimeUnit } from './chartSettings'
import {
  bucketLabel,
  floorToUnit,
  formatNumber,
  makeTimeScale,
  parseMoment,
  toNumber,
} from './chartValues'

/** The chart colours have this number of steps. A chart never shows more series. */
export const MAX_SERIES = 8
/** A histogram has a maximum of this number of bars. */
const MAX_BINS = 60
/** The name of the series of the rows that have no value in the series column. */
const EMPTY_SERIES = '(empty)'
/** The name of the series and of the axis when the chart counts rows. */
export const ROW_COUNT_NAME = 'Number of rows'

export type AxisKind = 'category' | 'value' | 'time'

/** A fact about the chart that the user must know. The chart view shows each note as text. */
export type ChartNote =
  | { id: 'not-numbers'; column: string; count: number }
  | { id: 'not-times'; column: string; count: number }
  | { id: 'empty-x'; count: number }
  | { id: 'series-limit'; shown: number; total: number }
  | { id: 'duplicates'; count: number }
  | { id: 'not-positive'; count: number }
  | { id: 'first-row'; rows: number }

export type ChartSeries = {
  name: string
  /** With a category axis: one value for each category. */
  values: (number | null)[]
  /** With a value axis or a time axis: the positions of the marks. */
  points: [number, number][]
}

export type CartesianChart = {
  kind: 'cartesian'
  type: 'line' | 'area' | 'bar' | 'scatter' | 'histogram'
  xAxis: AxisKind
  /** The column of the horizontal axis. */
  xName: string
  /** `null` if the series have different columns. The legend then gives the names. */
  yName: string | null
  /** The columns of the vertical axis. Empty if the chart counts rows. */
  yColumns: string[]
  /** `true` if the vertical axis shows the number of rows. */
  countsRows: boolean
  /** The aggregate that the chart uses. `null`: each row is one mark. */
  aggregate: Aggregate | null
  /** `true` if the chart set the aggregate, because the settings have none. */
  isAutoAggregate: boolean
  /** The time unit that combines the dates of the horizontal axis. */
  timeUnit: TimeUnit | null
  /** The column that divides the rows into series. */
  seriesColumn: string | null
  categories: string[]
  series: ChartSeries[]
  /** The number of marks of all series. */
  pointCount: number
  notes: ChartNote[]
}

export type PreparedChart =
  | CartesianChart
  | { kind: 'value'; label: string; text: string; notes: ChartNote[] }
  | { kind: 'empty'; notes: ChartNote[] }

class Notes {
  private readonly counts = new Map<string, ChartNote>()

  count(note: Exclude<ChartNote, { id: 'series-limit' | 'first-row' }>): void {
    if (note.count === 0) return
    const key = 'column' in note ? `${note.id}:${note.column}` : note.id
    const found = this.counts.get(key)
    if (found && 'count' in found) found.count += note.count
    else this.counts.set(key, { ...note })
  }

  add(note: ChartNote): void {
    this.counts.set(note.id, note)
  }

  list(): ChartNote[] {
    return [...this.counts.values()]
  }
}

type Accumulator = { sum: number; count: number; min: number; max: number }

function newAccumulator(): Accumulator {
  return { sum: 0, count: 0, min: Infinity, max: -Infinity }
}

function accumulate(target: Accumulator, value: number): void {
  target.sum += value
  target.count += 1
  target.min = Math.min(target.min, value)
  target.max = Math.max(target.max, value)
}

function result(target: Accumulator, aggregate: Aggregate): number | null {
  if (aggregate === 'count') return target.count
  if (target.count === 0) return null
  if (aggregate === 'sum') return target.sum
  if (aggregate === 'mean') return target.sum / target.count
  return aggregate === 'min' ? target.min : target.max
}

function indexOf(columns: Column[], name: string | undefined): number {
  return name === undefined
    ? -1
    : columns.findIndex((column) => column.name === name)
}

/** A column of the vertical axis. The index -1 is the number of rows, which has no column. */
type YColumn = { index: number; name: string }

const ROW_COUNT: YColumn = { index: -1, name: ROW_COUNT_NAME }

/**
 * Reads the value of a row for the vertical axis. With the aggregate `count`,
 * each cell that is not empty counts, also a cell that is not a number.
 */
function yValue(
  row: Row,
  y: YColumn,
  aggregate: Aggregate | null,
  notes: Notes,
): number | null {
  if (y.index < 0) return 1
  const cell = row[y.index]
  if (cell === null) return null
  if (aggregate === 'count') return 1
  const value = toNumber(cell)
  if (value === null) {
    notes.count({ id: 'not-numbers', column: y.name, count: 1 })
  }
  return value
}

type SeriesPlan = {
  /** Returns the index of the series of a row and a `y` column. -1: the chart does not show it. */
  seriesOf: (row: Row, yPosition: number) => number
  /** Returns the key of the series group of a row, to find rows that repeat. */
  groupOf: (row: Row) => string
  names: string[]
}

/** Decides the series of the chart: one for each `y` column and each value of the series column. */
function planSeries(
  rows: Row[],
  yNames: string[],
  seriesIndex: number,
  notes: Notes,
): SeriesPlan {
  const shownY = yNames.slice(0, MAX_SERIES)
  if (seriesIndex < 0) {
    if (yNames.length > shownY.length) {
      notes.add({
        id: 'series-limit',
        shown: shownY.length,
        total: yNames.length,
      })
    }
    return {
      seriesOf: (_row, yPosition) =>
        yPosition < shownY.length ? yPosition : -1,
      groupOf: () => '',
      names: shownY,
    }
  }
  const groups = new Map<string, number>()
  for (const row of rows) {
    const key = row[seriesIndex] ?? EMPTY_SERIES
    if (!groups.has(key)) groups.set(key, groups.size)
  }
  const shownGroups = Math.max(1, Math.floor(MAX_SERIES / shownY.length))
  const total = groups.size * yNames.length
  const groupNames = [...groups.keys()].slice(0, shownGroups)
  const names = groupNames.flatMap((group) =>
    shownY.length === 1 ? [group] : shownY.map((y) => `${group} · ${y}`),
  )
  if (total > names.length) {
    notes.add({ id: 'series-limit', shown: names.length, total })
  }
  return {
    seriesOf: (row, yPosition) => {
      const group = groups.get(row[seriesIndex] ?? EMPTY_SERIES) ?? -1
      if (group < 0 || group >= shownGroups || yPosition >= shownY.length) {
        return -1
      }
      return group * shownY.length + yPosition
    },
    groupOf: (row) => row[seriesIndex] ?? EMPTY_SERIES,
    names,
  }
}

/** `true` if the cells of the column are dates that a time axis can show. */
function hasDates(column: Column, rows: Row[], xIndex: number): boolean {
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
function xReader(
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

type Input = {
  settings: ChartSettings
  columns: Column[]
  rows: Row[]
  notes: Notes
}

/** What the chart does with the rows. The functions below share this plan. */
type Layout = {
  type: 'line' | 'area' | 'bar' | 'scatter'
  axis: AxisKind
  xIndex: number
  xName: string
  unit: TimeUnit | null
  y: YColumn[]
  series: SeriesPlan
  /** `null`: each row is one mark. */
  aggregate: Aggregate | null
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
): Pick<CartesianChart, 'categories' | 'series'> {
  const { settings, rows, notes } = input
  const { aggregate, series: plan } = layout
  const read = xReader('category', layout.xName, layout.unit, notes)
  // Without groups, each row is its own category, also when a name repeats.
  const hasGroups = aggregate !== null || settings.series !== undefined
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
      const value = yValue(row, y, aggregate, notes)
      if (value === null) return
      const found = cells[series][position]
      if (found && aggregate === null) {
        notes.count({ id: 'duplicates', count: 1 })
        return
      }
      const target = found ?? newAccumulator()
      accumulate(target, value)
      cells[series][position] = target
    })
  }
  const data = {
    categories,
    series: plan.names.map((name, index) => ({
      name,
      values: categories.map((_, position) => {
        const cell = cells[index][position]
        return cell ? result(cell, aggregate ?? 'sum') : null
      }),
      points: [],
    })),
  }
  // Time buckets are in the sequence of the time. Other categories use the sort setting.
  if (layout.unit !== null) return reorder(data, byNumber(orders))
  return settings.sort === undefined
    ? data
    : reorder(data, sortOrder(data, settings.sort))
}

type Categories = Pick<CartesianChart, 'categories' | 'series'>

function byNumber(values: number[]): number[] {
  return values.map((_, index) => index).sort((a, b) => values[a] - values[b])
}

const collator = new Intl.Collator('en', { numeric: true })

/** Returns the positions of the categories in the sequence of the sort. */
function sortOrder(data: Categories, sort: Sort): number[] {
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
): Pick<CartesianChart, 'categories' | 'series'> {
  const { rows, notes } = input
  const { aggregate, series: plan } = layout
  const read = xReader(layout.axis, layout.xName, layout.unit, notes)
  const points: [number, number][][] = plan.names.map(() => [])
  const groups: Map<number, Accumulator>[] = plan.names.map(() => new Map())

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
      const value = yValue(row, y, aggregate, notes)
      if (value === null) return
      if (aggregate === null) {
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

  return {
    categories: [],
    series: plan.names.map((name, index) => {
      const marks: [number, number][] =
        aggregate === null
          ? points[index]
          : [...groups[index]].flatMap(([x, group]) => {
              const value = result(group, aggregate)
              return value === null ? [] : [[x, value] as [number, number]]
            })
      // A line goes from the left to the right. A scatter plot keeps the row sequence.
      if (layout.type !== 'scatter') marks.sort((a, b) => a[0] - b[0])
      return { name, values: [], points: marks }
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
function planLayout(
  input: Input,
  type: Layout['type'],
): Omit<Layout, 'aggregate'> | null {
  const { settings, columns, rows, notes } = input
  const xIndex = indexOf(columns, settings.x)
  const y: YColumn[] = settings.countRows
    ? [ROW_COUNT]
    : settings.y
        .map((name) => indexOf(columns, name))
        .filter((index) => index >= 0)
        .map((index) => ({ index, name: columns[index].name }))
  if (xIndex < 0 || y.length === 0) return null

  const isDate = hasDates(columns[xIndex], rows, xIndex)
  const isNumber = columns[xIndex].kind === 'number'
  // A bar always has categories. A line or a point has a position, if the column gives one.
  const axis: AxisKind =
    type === 'bar'
      ? 'category'
      : isDate
        ? 'time'
        : isNumber
          ? 'value'
          : 'category'
  const canGroup = isDate && type !== 'scatter'
  return {
    type,
    axis,
    xIndex,
    xName: columns[xIndex].name,
    unit: canGroup ? (settings.timeUnit ?? null) : null,
    y,
    series: planSeries(
      rows,
      y.map((item) => item.name),
      indexOf(columns, settings.series),
      notes,
    ),
  }
}

/**
 * Decides the aggregate. A count of rows is always a count. Settings without an
 * aggregate let the chart decide: it shows the sum if positions repeat or if
 * the horizontal axis has a time unit.
 */
function planAggregate(
  input: Input,
  layout: Omit<Layout, 'aggregate'>,
): { aggregate: Aggregate | null; isAuto: boolean } {
  const { settings } = input
  if (settings.countRows) return { aggregate: 'count', isAuto: false }
  if (layout.type === 'scatter' || settings.aggregate === 'none') {
    return { aggregate: null, isAuto: false }
  }
  if (settings.aggregate !== undefined) {
    return { aggregate: settings.aggregate, isAuto: false }
  }
  // A time unit combines rows, also when each bucket has only one row now.
  const combines =
    layout.unit !== null || hasRepeats(input, { ...layout, aggregate: null })
  return combines
    ? { aggregate: 'sum', isAuto: true }
    : { aggregate: null, isAuto: false }
}

function prepareCartesian(
  input: Input,
  type: 'line' | 'area' | 'bar' | 'scatter',
): PreparedChart {
  const { settings, notes } = input
  const plan = planLayout(input, type)
  if (plan === null) return { kind: 'empty', notes: [] }
  const { aggregate, isAuto } = planAggregate(input, plan)
  const layout: Layout = { ...plan, aggregate }

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

  const yColumns = settings.countRows ? [] : layout.y.map((y) => y.name)
  const prefix = aggregate === null ? '' : `${aggregate} of `
  const yName = settings.countRows
    ? ROW_COUNT_NAME
    : yColumns.length === 1
      ? `${prefix}${yColumns[0]}`
      : null
  return {
    kind: 'cartesian',
    type,
    xAxis: layout.axis,
    xName: layout.xName,
    yName,
    yColumns,
    countsRows: settings.countRows === true,
    aggregate,
    isAutoAggregate: isAuto,
    timeUnit: layout.unit,
    seriesColumn: settings.series ?? null,
    categories: data.categories,
    series,
    pointCount,
    notes: notes.list(),
  }
}

/** Returns a step of 1, 2, or 5 times a power of 10 that is not smaller than `raw`. */
function niceStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(raw))
  const part = raw / power
  if (part <= 1) return power
  if (part <= 2) return 2 * power
  return part <= 5 ? 5 * power : 10 * power
}

function prepareHistogram(input: Input): PreparedChart {
  const { settings, columns, rows, notes } = input
  const xIndex = indexOf(columns, settings.x)
  if (xIndex < 0) return { kind: 'empty', notes: [] }
  const column = columns[xIndex].name
  const values: number[] = []
  for (const row of rows) {
    const cell = row[xIndex]
    if (cell === null) continue
    const value = toNumber(cell)
    if (value === null) notes.count({ id: 'not-numbers', column, count: 1 })
    else values.push(value)
  }
  if (values.length === 0) return { kind: 'empty', notes: notes.list() }

  let min = Infinity
  let max = -Infinity
  for (const value of values) {
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  // The rule of Sturges gives the number of bars from the number of values.
  const wanted = Math.min(MAX_BINS, Math.ceil(Math.log2(values.length)) + 1)
  const step = max === min ? 1 : niceStep((max - min) / wanted)
  const start = Math.floor(min / step) * step
  const binCount = Math.max(1, Math.floor((max - start) / step) + 1)
  const counts = Array.from({ length: binCount }, () => 0)
  for (const value of values) {
    const bin = Math.min(binCount - 1, Math.floor((value - start) / step))
    counts[bin] += 1
  }
  return {
    kind: 'cartesian',
    type: 'histogram',
    xAxis: 'category',
    xName: column,
    yName: ROW_COUNT_NAME,
    yColumns: [],
    countsRows: true,
    aggregate: 'count',
    isAutoAggregate: false,
    timeUnit: null,
    seriesColumn: null,
    categories: counts.map((_, bin) => {
      const from = start + bin * step
      return `${formatNumber(from)} to ${formatNumber(from + step)}`
    }),
    series: [{ name: ROW_COUNT_NAME, values: counts, points: [] }],
    pointCount: binCount,
    notes: notes.list(),
  }
}

function prepareValue(input: Input): PreparedChart {
  const { settings, columns, rows, notes } = input
  if (settings.countRows) {
    return {
      kind: 'value',
      label: ROW_COUNT_NAME,
      text: formatNumber(rows.length),
      notes: [],
    }
  }
  const yIndex = indexOf(columns, settings.y[0])
  if (yIndex < 0 || rows.length === 0) return { kind: 'empty', notes: [] }
  const y: YColumn = { index: yIndex, name: columns[yIndex].name }
  const { aggregate } = settings
  if (aggregate === undefined || aggregate === 'none') {
    if (rows.length > 1) notes.add({ id: 'first-row', rows: rows.length })
    const cell = rows[0][yIndex]
    const value = cell === null ? null : toNumber(cell)
    const text = value === null ? (cell ?? 'NULL') : formatNumber(value)
    return { kind: 'value', label: y.name, text, notes: notes.list() }
  }
  const target = newAccumulator()
  for (const row of rows) {
    const value = yValue(row, y, aggregate, notes)
    if (value !== null) accumulate(target, value)
  }
  const value = result(target, aggregate)
  return {
    kind: 'value',
    label: `${aggregate} of ${y.name}`,
    text: value === null ? 'NULL' : formatNumber(value),
    notes: notes.list(),
  }
}

/**
 * Makes the data of a chart from the loaded rows of a result. The function does
 * not know the chart library. A cell that it cannot convert is an empty value,
 * and a note gives the number of such cells.
 */
export function prepareChart(
  settings: ChartSettings,
  columns: Column[],
  rows: Row[],
): PreparedChart {
  const input: Input = { settings, columns, rows, notes: new Notes() }
  if (settings.type === 'histogram') return prepareHistogram(input)
  if (settings.type === 'value') return prepareValue(input)
  return prepareCartesian(input, settings.type)
}

const count = new Intl.NumberFormat('en-US')

function cells(value: number): string {
  return value === 1 ? '1 cell' : `${count.format(value)} cells`
}

function rowsText(value: number): string {
  return value === 1 ? '1 row' : `${count.format(value)} rows`
}

/** The sentence that the chart view shows for a note. */
export function noteText(note: ChartNote): string {
  switch (note.id) {
    case 'not-numbers':
      return `${cells(note.count)} of the column ${note.column} ${note.count === 1 ? 'is' : 'are'} not a number. The chart does not show ${note.count === 1 ? 'it' : 'them'}.`
    case 'not-times':
      return `${cells(note.count)} of the column ${note.column} ${note.count === 1 ? 'is' : 'are'} not a date. The chart does not show ${note.count === 1 ? 'it' : 'them'}.`
    case 'empty-x':
      return `${rowsText(note.count)} ${note.count === 1 ? 'has' : 'have'} no value for the horizontal axis. The chart does not show ${note.count === 1 ? 'it' : 'them'}.`
    case 'series-limit':
      return `The chart shows the first ${note.shown} of ${count.format(note.total)} series.`
    case 'duplicates':
      return `${cells(note.count)} ${note.count === 1 ? 'has' : 'have'} the same horizontal value and the same series as an earlier row. The chart does not show ${note.count === 1 ? 'it' : 'them'}. Select an aggregate to combine such rows.`
    case 'not-positive':
      return `${count.format(note.count)} ${note.count === 1 ? 'value is' : 'values are'} zero or negative. A logarithmic axis cannot show ${note.count === 1 ? 'it' : 'them'}.`
    case 'first-row':
      return `The result has ${rowsText(note.rows)}. The view shows the value of the first row. Select an aggregate to combine the rows.`
  }
}

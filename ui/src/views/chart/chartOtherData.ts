/**
 * The data of the chart types that do not have series of values: the box plot
 * and the parallel coordinates. This module also has the checks of a Sankey
 * diagram, a calendar, and a candlestick chart after the series preparation.
 */
import type {
  Box,
  CartesianChart,
  ChartNote,
  PreparedChart,
} from './chartModel'
import {
  byNumber,
  hasDates,
  indexOf,
  planSeries,
  xReader,
  type Input,
} from './chartSeriesData'
import { CANDLESTICK_COLUMNS } from './chartSettings'
import { toNumber } from './chartValues'

/** A box plot shows a maximum of this number of values outside the whiskers. */
const MAX_OUTLIERS = 2000
/** Parallel coordinates draw one line for each row. More lines than this are too slow. */
const MAX_LINES = 5000
/** A calendar shows a maximum of this number of years. */
const MAX_YEARS = 3
/** The length of the factor of the whiskers: 1.5 times the distance of the quartiles (Tukey). */
const WHISKER_FACTOR = 1.5
const LENGTH_OF_YEAR = 4

const collator = new Intl.Collator('en', { numeric: true })

/** Returns the value at the part `p` (0 to 1) of sorted values, with linear interpolation. */
function quantile(sorted: number[], p: number): number {
  const position = (sorted.length - 1) * p
  const low = Math.floor(position)
  const high = Math.ceil(position)
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low)
}

/** The box of some values, and the values outside its whiskers. */
function boxOf(values: number[]): { box: Box; outliers: number[] } {
  const sorted = [...values].sort((a, b) => a - b)
  const q1 = quantile(sorted, 0.25)
  const median = quantile(sorted, 0.5)
  const q3 = quantile(sorted, 0.75)
  const reach = (q3 - q1) * WHISKER_FACTOR
  // A whisker ends at the last value that is not farther than the reach.
  const inside = sorted.filter(
    (value) => value >= q1 - reach && value <= q3 + reach,
  )
  const outliers = sorted.filter(
    (value) => value < q1 - reach || value > q3 + reach,
  )
  return { box: [inside[0], q1, median, q3, inside.at(-1)!], outliers }
}

type BoxGroup = { label: string; order: number; values: number[] }

/** Collects the values of the number column for each category. */
function boxGroups(input: Input, yIndex: number): BoxGroup[] {
  const { settings, columns, rows, notes } = input
  const xIndex = indexOf(columns, settings.x)
  const yName = columns[yIndex].name
  const isDate = xIndex >= 0 && hasDates(columns[xIndex], rows, xIndex)
  const unit = isDate ? (settings.timeUnit ?? null) : null
  const read =
    xIndex < 0 ? null : xReader('category', columns[xIndex].name, unit, notes)
  const groups = new Map<string, BoxGroup>()
  for (const row of rows) {
    const cell = row[yIndex]
    if (cell === null) continue
    const value = toNumber(cell)
    if (value === null) {
      notes.count({ id: 'not-numbers', column: yName, count: 1 })
      continue
    }
    const xCell = xIndex < 0 ? '' : row[xIndex]
    if (xCell === null) {
      notes.count({ id: 'empty-x', count: 1 })
      continue
    }
    const x = read === null ? { key: 'All rows', order: 0 } : read(xCell)
    if (x === null) continue
    const label = String(x.key)
    let group = groups.get(label)
    if (!group) {
      group = { label, order: x.order, values: [] }
      groups.set(label, group)
    }
    group.values.push(value)
  }
  const list = [...groups.values()]
  // Time units are in the sequence of the time. Other categories use the sort setting.
  if (unit !== null) {
    return byNumber(list.map((group) => group.order)).map((i) => list[i])
  }
  if (settings.sort === 'name') {
    return list.sort((a, b) => collator.compare(a.label, b.label))
  }
  return list
}

/** Makes a box plot: the distribution of one number column, for all rows or for each category. */
export function prepareBox(input: Input): PreparedChart {
  const { settings, columns, notes } = input
  const yIndex = indexOf(columns, settings.y[0])
  if (yIndex < 0) return { kind: 'empty', notes: [] }
  let groups = boxGroups(input, yIndex)
  if (groups.length === 0) return { kind: 'empty', notes: notes.list() }

  let stats = groups.map((group) => boxOf(group.values))
  if (settings.sort === 'value-asc' || settings.sort === 'value-desc') {
    // The value of a box is its median.
    const sign = settings.sort === 'value-asc' ? 1 : -1
    const order = stats
      .map((_, index) => index)
      .sort((a, b) => sign * (stats[a].box[2] - stats[b].box[2]) || a - b)
    groups = order.map((index) => groups[index])
    stats = order.map((index) => stats[index])
  }
  const extra: ChartNote[] = []
  const { limit } = settings
  if (limit !== undefined && groups.length > limit) {
    extra.push({
      id: 'category-limit',
      shown: limit,
      total: groups.length,
      hasOther: false,
    })
    groups = groups.slice(0, limit)
    stats = stats.slice(0, limit)
  }
  const outliers = stats.flatMap((item, index) =>
    item.outliers.map((value): [number, number] => [index, value]),
  )
  if (outliers.length > MAX_OUTLIERS) {
    extra.push({
      id: 'point-limit',
      shown: MAX_OUTLIERS,
      total: outliers.length,
    })
  }
  const xIndex = indexOf(columns, settings.x)
  const isDate = xIndex >= 0 && columns[xIndex].kind === 'temporal'
  return {
    kind: 'box',
    type: 'boxplot',
    xName: xIndex < 0 ? null : columns[xIndex].name,
    yName: columns[yIndex].name,
    timeUnit: isDate ? (settings.timeUnit ?? null) : null,
    categories: groups.map((group) => group.label),
    boxes: stats.map((item) => item.box),
    outliers: outliers.slice(0, MAX_OUTLIERS),
    pointCount: groups.length,
    notes: [...notes.list(), ...extra],
  }
}

/** Makes parallel coordinates: one line for each row that has a number in each column. */
export function prepareParallel(input: Input): PreparedChart {
  const { settings, columns, rows, notes } = input
  const axes = settings.y
    .map((name) => indexOf(columns, name))
    .filter((index) => index >= 0)
  if (axes.length < 2) return { kind: 'empty', notes: [] }
  const plan = planSeries(rows, [''], indexOf(columns, settings.series), notes)
  const groups = plan.names.map((name) => ({
    name: settings.series === undefined ? 'Rows' : name,
    lines: [] as number[][],
  }))
  let total = 0
  for (const row of rows) {
    const values = axes.map((index) => {
      const cell = row[index]
      return cell === null ? null : toNumber(cell)
    })
    if (values.some((value) => value === null)) {
      notes.count({ id: 'incomplete-rows', count: 1 })
      continue
    }
    const group = plan.seriesOf(row, 0)
    if (group < 0) continue
    total += 1
    if (total <= MAX_LINES) groups[group].lines.push(values as number[])
  }
  if (total === 0) return { kind: 'empty', notes: notes.list() }
  const limit: ChartNote[] =
    total > MAX_LINES ? [{ id: 'point-limit', shown: MAX_LINES, total }] : []
  return {
    kind: 'rows',
    type: 'parallel',
    axes: axes.map((index) => columns[index].name),
    seriesColumn: settings.series ?? null,
    groups,
    otherSeries: plan.other,
    pointCount: Math.min(total, MAX_LINES),
    notes: [...notes.list(), ...limit],
  }
}

/** The links of a Sankey diagram: from each category to each series, with a value above zero. */
export function sankeyLinks(
  chart: CartesianChart,
): { source: string; target: string; value: number }[] {
  return chart.series.flatMap((series) =>
    series.values.flatMap((value, index) => {
      const source = chart.categories[index]
      // A link from a node to the same node is not a flow.
      return value === null || value <= 0 || source === series.name
        ? []
        : [{ source, target: series.name, value }]
    }),
  )
}

/** `true` if the links go in a circle. */
function hasCycle(links: { source: string; target: string }[]): boolean {
  const targets = new Map<string, string[]>()
  for (const link of links) {
    targets.set(link.source, [...(targets.get(link.source) ?? []), link.target])
  }
  const done = new Set<string>()
  const path = new Set<string>()
  const visit = (node: string): boolean => {
    if (path.has(node)) return true
    if (done.has(node)) return false
    path.add(node)
    const found = (targets.get(node) ?? []).some(visit)
    path.delete(node)
    done.add(node)
    return found
  }
  return [...targets.keys()].some(visit)
}

/** A Sankey diagram cannot show links that go in a circle. This gives a note in place of the chart. */
export function checkSankey(chart: CartesianChart): PreparedChart {
  const links = sankeyLinks(chart)
  if (links.length === 0) return { kind: 'empty', notes: chart.notes }
  if (hasCycle(links)) {
    return { kind: 'empty', notes: [...chart.notes, { id: 'cycle' }] }
  }
  return { ...chart, pointCount: links.length }
}

/** A calendar shows the last years of the data. The categories are days in the sequence of the time. */
export function limitCalendar(chart: CartesianChart): CartesianChart {
  const yearOf = (day: string) => day.slice(0, LENGTH_OF_YEAR)
  const years = [...new Set(chart.categories.map(yearOf))]
  if (years.length <= MAX_YEARS) return chart
  const kept = new Set(years.slice(-MAX_YEARS))
  const first = chart.categories.findIndex((day) => kept.has(yearOf(day)))
  const series = chart.series.map((item) => ({
    ...item,
    values: item.values.slice(first),
  }))
  return {
    ...chart,
    categories: chart.categories.slice(first),
    series,
    pointCount: series.reduce(
      (total, item) =>
        total + item.values.filter((value) => value !== null).length,
      0,
    ),
    notes: [
      ...chart.notes,
      { id: 'year-limit', shown: MAX_YEARS, total: years.length },
    ],
  }
}

/** The candles of a chart: open, high, low, and close of each category that has the four values. */
export function candles(
  chart: CartesianChart,
): { category: string; values: [number, number, number, number] | null }[] {
  return chart.categories.map((category, index) => {
    const values = chart.series
      .slice(0, CANDLESTICK_COLUMNS)
      .map((series) => series.values[index])
    const isComplete =
      values.length === CANDLESTICK_COLUMNS &&
      values.every((value) => value !== null)
    return {
      category,
      values: isComplete ? (values as [number, number, number, number]) : null,
    }
  })
}

/** Counts the candles. A note gives the rows that have no complete candle. */
export function checkCandles(chart: CartesianChart): PreparedChart {
  const all = candles(chart)
  const complete = all.filter((candle) => candle.values !== null).length
  if (complete === 0) return { kind: 'empty', notes: chart.notes }
  const missing = all.length - complete
  return {
    ...chart,
    pointCount: complete,
    notes:
      missing === 0
        ? chart.notes
        : [...chart.notes, { id: 'incomplete-rows', count: missing }],
  }
}

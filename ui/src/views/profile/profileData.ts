import type { Column, Row } from '../../results/gridModel'
import { formatNumber, parseMoment, toNumber } from '../chart/chartValues'

/** A number column and a date column show a histogram with this number of bars. */
const BINS = 10
/** A text column shows its most frequent values. */
const TOP_VALUES = 5
/** A value in the profile shows a maximum of this number of characters. */
const MAX_VALUE_CHARS = 60

/** One bar of the distribution of a column. */
export type ProfileBar = { label: string; count: number }

/** What the loaded rows tell about one column of a result. */
export type ColumnProfile = {
  column: Column
  /** The number of cells that are not empty. */
  filled: number
  /** The number of empty cells (NULL). */
  empty: number
  /** The number of different values of the cells that are not empty. */
  distinct: number
  /** The smallest and the largest value. `null` if the column has no value. */
  min: string | null
  max: string | null
  /** `histogram`: ranges of equal width. `top`: the most frequent values. */
  barsKind: 'histogram' | 'top'
  bars: ProfileBar[]
  /** Cells of a number column or a date column that are not a number or a date. */
  notConverted: number
}

function short(text: string): string {
  return text.length > MAX_VALUE_CHARS
    ? `${text.slice(0, MAX_VALUE_CHARS - 1)}…`
    : text
}

/** Counts the positions in ranges of equal width, from the smallest to the largest position. */
function histogram(
  positions: number[],
  label: (from: number, to: number) => string,
): ProfileBar[] {
  if (positions.length === 0) return []
  let min = Infinity
  let max = -Infinity
  for (const position of positions) {
    min = Math.min(min, position)
    max = Math.max(max, position)
  }
  if (min === max) return [{ label: label(min, max), count: positions.length }]
  const width = (max - min) / BINS
  const counts = Array.from({ length: BINS }, () => 0)
  for (const position of positions) {
    // The largest position is in the last range.
    counts[Math.min(BINS - 1, Math.floor((position - min) / width))] += 1
  }
  return counts.map((count, bin) => ({
    label: label(min + bin * width, min + (bin + 1) * width),
    count,
  }))
}

function dayOf(position: number): string {
  return new Date(position).toISOString().slice(0, '2026-01-01'.length)
}

const collator = new Intl.Collator('en', { numeric: true })

type Values = { texts: Map<string, number>; cells: string[] }

/** The cells of one column that are not empty, and the count of each different value. */
function valuesOf(rows: Row[], index: number): Values {
  const texts = new Map<string, number>()
  const cells: string[] = []
  for (const row of rows) {
    const cell = row[index]
    if (cell === null) continue
    cells.push(cell)
    texts.set(cell, (texts.get(cell) ?? 0) + 1)
  }
  return { texts, cells }
}

type Shape = Pick<
  ColumnProfile,
  'min' | 'max' | 'bars' | 'barsKind' | 'notConverted'
>

function numberShape(cells: string[]): Shape {
  const numbers = cells
    .map(toNumber)
    .filter((value): value is number => value !== null)
  let min = Infinity
  let max = -Infinity
  for (const value of numbers) {
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  const hasValues = numbers.length > 0
  return {
    min: hasValues ? formatNumber(min) : null,
    max: hasValues ? formatNumber(max) : null,
    barsKind: 'histogram',
    bars: histogram(
      numbers,
      (from, to) => `${formatNumber(from)} to ${formatNumber(to)}`,
    ),
    notConverted: cells.length - numbers.length,
  }
}

function dateShape(cells: string[]): Shape {
  // The profile shows the dates as the grid shows them, without a change of the time zone.
  const moments = cells.flatMap((cell) => {
    const moment = parseMoment(cell)
    return moment === null ? [] : [{ cell, wall: moment.wall }]
  })
  let first = moments[0]
  let last = moments[0]
  for (const moment of moments) {
    if (moment.wall < first.wall) first = moment
    if (moment.wall > last.wall) last = moment
  }
  return {
    min: first?.cell ?? null,
    max: last?.cell ?? null,
    barsKind: 'histogram',
    bars: histogram(
      moments.map((moment) => moment.wall),
      (from, to) => `${dayOf(from)} to ${dayOf(to)}`,
    ),
    notConverted: cells.length - moments.length,
  }
}

function textShape(texts: Map<string, number>): Shape {
  const names = [...texts.keys()].sort(collator.compare)
  // The most frequent values are first. Equal counts keep the sequence of the result.
  const top = [...texts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_VALUES)
    .map(([label, count]) => ({ label: short(label), count }))
  return {
    min: names.length === 0 ? null : short(names[0]),
    max: names.length === 0 ? null : short(names.at(-1)!),
    barsKind: 'top',
    bars: top,
    notConverted: 0,
  }
}

/**
 * Makes the profile of each column from the loaded rows of a result. A number
 * column and a date column get a histogram. Each other column gets its most
 * frequent values.
 */
export function profileColumns(
  columns: Column[],
  rows: Row[],
): ColumnProfile[] {
  return columns.map((column, index) => {
    const { texts, cells } = valuesOf(rows, index)
    const shape =
      column.kind === 'number'
        ? numberShape(cells)
        : column.kind === 'temporal'
          ? dateShape(cells)
          : textShape(texts)
    return {
      column,
      filled: cells.length,
      empty: rows.length - cells.length,
      distinct: texts.size,
      ...shape,
    }
  })
}

import type { Column_Serialize, ColumnKind } from '../bindings'

export type Column = Column_Serialize
export type Cell = string | null
export type Row = Cell[]

export type SortState = { column: number; direction: 'asc' | 'desc' } | null

/** The sort sequence of a column header: ascending, descending, no sort. */
export function nextSort(current: SortState, column: number): SortState {
  if (current?.column !== column) return { column, direction: 'asc' }
  return current.direction === 'asc' ? { column, direction: 'desc' } : null
}

function compareText(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

function compareNumbers(a: string, b: string): number {
  const left = Number(a)
  const right = Number(b)
  // Text that is not a plain number (for example money) uses the text sequence.
  if (Number.isNaN(left) || Number.isNaN(right)) return compareText(a, b)
  return left - right
}

/** Compares two values that are not NULL. */
export function compareValues(a: string, b: string, kind: ColumnKind): number {
  return kind === 'number' ? compareNumbers(a, b) : compareText(a, b)
}

/**
 * Returns the row indexes in the display sequence. NULL is last in the two directions.
 * Rows that are equal keep their sequence.
 */
export function sortedIndexes(
  rows: Row[],
  columns: Column[],
  sort: SortState,
): number[] {
  const indexes = rows.map((_, index) => index)
  if (!sort) return indexes
  const kind = columns[sort.column]?.kind ?? 'other'
  const sign = sort.direction === 'asc' ? 1 : -1
  return indexes.sort((left, right) => {
    const a = rows[left][sort.column]
    const b = rows[right][sort.column]
    if (a === null || b === null) {
      if (a === b) return left - right
      return a === null ? 1 : -1
    }
    return sign * compareValues(a, b, kind) || left - right
  })
}

function toTsvField(value: Cell): string {
  // Tabs and line ends would break the columns and the rows of the copied text.
  return (value ?? '').replace(/[\t\r\n]+/g, ' ')
}

/** Converts rows to tab-separated text for the clipboard. NULL is an empty field. */
export function rowsToTsv(rows: Row[], columnIndexes: number[]): string {
  return rows
    .map((row) => columnIndexes.map((i) => toTsvField(row[i])).join('\t'))
    .join('\n')
}

export function isRightAligned(kind: ColumnKind): boolean {
  return kind === 'number'
}

import { useVirtualizer } from '@tanstack/react-virtual'
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  isRightAligned,
  nextSort,
  rowsToTsv,
  sortedIndexes,
  type Column,
  type Row,
  type SortState,
} from './gridModel'

const ROW_HEIGHT = 26
const OVERSCAN_ROWS = 12
const DEFAULT_COLUMN_WIDTH = 160
const MIN_COLUMN_WIDTH = 48
const ROW_NUMBER_WIDTH = 64
/** The grid renders this number of columns on each side of the visible columns. */
const OVERSCAN_COLUMNS = 3
/** One press of a resize key changes the width of a column by this number of pixels. */
const RESIZE_STEP = 16
/** The row number is the first column of the grid. The data columns start after it. */
const FIRST_DATA_COLUMN = 2
/** The grid asks for more rows when the user is this number of rows from the end. */
const FETCH_THRESHOLD_ROWS = 100

type CellPosition = { row: number; column: number }

const PAGE_ROWS = 20

/** The row step and the column step of each navigation key. */
const KEY_STEPS: Record<string, (columns: number) => [number, number]> = {
  ArrowDown: () => [1, 0],
  ArrowUp: () => [-1, 0],
  ArrowRight: () => [0, 1],
  ArrowLeft: () => [0, -1],
  PageDown: () => [PAGE_ROWS, 0],
  PageUp: () => [-PAGE_ROWS, 0],
  Home: (columns) => [0, -columns],
  End: (columns) => [0, columns],
}

type Props = {
  columns: Column[]
  rows: Row[]
  /** `true` if the server has more rows for this result. */
  hasMore: boolean
  onNeedMore: () => void
}

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

function sortLabel(sort: SortState, column: number): string {
  if (sort?.column !== column) return ''
  return sort.direction === 'asc' ? ' ▲' : ' ▼'
}

function ariaSort(sort: SortState, column: number) {
  if (sort?.column !== column) return 'none'
  return sort.direction === 'asc' ? 'ascending' : 'descending'
}

/** Starts a column resize. The width follows the pointer until the user releases it. */
function startResize(
  event: ReactPointerEvent<HTMLElement>,
  startWidth: number,
  onWidth: (width: number) => void,
) {
  event.preventDefault()
  const startX = event.clientX
  const onMove = (move: PointerEvent) =>
    onWidth(Math.max(MIN_COLUMN_WIDTH, startWidth + move.clientX - startX))
  const onEnd = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onEnd)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onEnd)
}

export function ResultGrid({ columns, rows, hasMore, onNeedMore }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [sort, setSort] = useState<SortState>(null)
  const [widths, setWidths] = useState<Record<number, number>>({})
  const [hidden, setHidden] = useState<ReadonlySet<number>>(new Set())
  const [selected, setSelected] = useState<CellPosition | null>(null)

  const order = useMemo(
    () => sortedIndexes(rows, columns, sort),
    [rows, columns, sort],
  )
  const visible = useMemo(
    () => columns.map((_, index) => index).filter((i) => !hidden.has(i)),
    [columns, hidden],
  )
  const widthOf = (column: number) => widths[column] ?? DEFAULT_COLUMN_WIDTH
  const setWidth = (column: number, width: number) =>
    setWidths((current) => ({
      ...current,
      [column]: Math.max(MIN_COLUMN_WIDTH, width),
    }))
  const hintId = useId()

  // The virtual list is not compatible with the React Compiler. This project does not use the compiler.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: order.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN_ROWS,
  })
  const items = virtualizer.getVirtualItems()

  // A result can have hundreds of columns. The grid renders only the columns near
  // the visible area. An empty grid track before and after them keeps their position.
  // oxlint-disable-next-line react/incompatible-library
  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (position) => widthOf(visible[position]),
    overscan: OVERSCAN_COLUMNS,
    paddingStart: ROW_NUMBER_WIDTH,
    scrollPaddingStart: ROW_NUMBER_WIDTH,
  })
  // The virtual list keeps the sizes. It must calculate them again after a change.
  useEffect(() => {
    columnVirtualizer.measure()
  }, [columnVirtualizer, widths, visible])
  const virtualColumns = columnVirtualizer.getVirtualItems()
  const spaceBefore =
    (virtualColumns[0]?.start ?? ROW_NUMBER_WIDTH) - ROW_NUMBER_WIDTH
  const spaceAfter =
    columnVirtualizer.getTotalSize() -
    (virtualColumns.at(-1)?.end ?? ROW_NUMBER_WIDTH)
  const template = [
    `${ROW_NUMBER_WIDTH}px`,
    `${spaceBefore}px`,
    ...virtualColumns.map((item) => `${item.size}px`),
    `${spaceAfter}px`,
  ].join(' ')
  /** The grid track of a rendered column. Track 2 is the empty space before the columns. */
  const trackOf = (renderedPosition: number) => renderedPosition + 3
  const lastVisible = items.at(-1)?.index ?? 0

  useEffect(() => {
    if (hasMore && lastVisible >= order.length - FETCH_THRESHOLD_ROWS) {
      onNeedMore()
    }
  }, [hasMore, lastVisible, order.length, onNeedMore])

  const selectedRow = selected ? rows[selected.row] : undefined
  const copyCell = () => {
    if (selectedRow && selected) {
      void copyText(selectedRow[selected.column] ?? '')
    }
  }
  const copyRow = () => {
    if (selectedRow) void copyText(rowsToTsv([selectedRow], visible))
  }
  /** Moves the selected cell. The grid scrolls so that the cell is visible. */
  const moveSelection = (rowStep: number, columnStep: number) => {
    if (order.length === 0 || visible.length === 0) return
    const row = selected ? order.indexOf(selected.row) : -1
    const column = selected ? visible.indexOf(selected.column) : -1
    const clamp = (value: number, max: number) =>
      Math.min(Math.max(value, 0), max)
    // Without a selection, the first key selects the first cell.
    const nextRow = row < 0 ? 0 : clamp(row + rowStep, order.length - 1)
    const nextColumn =
      column < 0 ? 0 : clamp(column + columnStep, visible.length - 1)
    setSelected({ row: order[nextRow], column: visible[nextColumn] })
    virtualizer.scrollToIndex(nextRow)
    columnVirtualizer.scrollToIndex(nextColumn)
  }
  /** Changes the width of the column of the selected cell. Returns `false` for other keys. */
  const resizeWithKey = (event: KeyboardEvent): boolean => {
    if (!event.altKey || !event.shiftKey || !selected) return false
    const direction = { ArrowRight: 1, ArrowLeft: -1 }[event.key]
    if (!direction) return false
    const { column } = selected
    // The new width comes from the stored width, thus fast key presses add up.
    setWidths((current) => ({
      ...current,
      [column]: Math.max(
        MIN_COLUMN_WIDTH,
        (current[column] ?? DEFAULT_COLUMN_WIDTH) + direction * RESIZE_STEP,
      ),
    }))
    return true
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
      event.preventDefault()
      copyCell()
      return
    }
    if (resizeWithKey(event)) {
      event.preventDefault()
      return
    }
    const step = KEY_STEPS[event.key]
    if (!step) return
    event.preventDefault()
    moveSelection(...step(visible.length))
  }
  const toggleColumn = (index: number) => {
    const next = new Set(hidden)
    if (!next.delete(index)) next.add(index)
    setHidden(next)
  }

  return (
    <div className="grid">
      <div className="grid__tools">
        <details className="grid__columns">
          <summary>Columns</summary>
          <ul>
            {columns.map((column, index) => (
              <li key={index}>
                <label>
                  <input
                    type="checkbox"
                    checked={!hidden.has(index)}
                    onChange={() => toggleColumn(index)}
                  />
                  {column.name}
                </label>
              </li>
            ))}
          </ul>
        </details>
        <button
          type="button"
          className="button button--small"
          disabled={!selectedRow}
          onClick={copyCell}
        >
          Copy cell
        </button>
        <button
          type="button"
          className="button button--small"
          disabled={!selectedRow}
          onClick={copyRow}
        >
          Copy row
        </button>
        {sort && hasMore && (
          <span className="grid__note">
            The sort applies only to the loaded rows.
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        className="grid__scroll"
        role="grid"
        aria-label="Result rows"
        aria-rowcount={order.length + 1}
        aria-colcount={visible.length + 1}
        aria-describedby={hintId}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        <div
          className="grid__row grid__row--header"
          role="row"
          style={{ gridTemplateColumns: template }}
        >
          <div
            className="grid__cell grid__cell--number"
            role="columnheader"
            aria-colindex={1}
          >
            #
          </div>
          {virtualColumns.map((item, rendered) => {
            const index = visible[item.index]
            return (
              <div
                key={index}
                className="grid__cell grid__cell--header"
                role="columnheader"
                aria-colindex={item.index + FIRST_DATA_COLUMN}
                aria-sort={ariaSort(sort, index)}
                style={{ gridColumnStart: trackOf(rendered) }}
              >
                <button
                  type="button"
                  className="grid__sort"
                  title={columns[index].type_name ?? undefined}
                  onClick={() => setSort(nextSort(sort, index))}
                >
                  {columns[index].name}
                  {sortLabel(sort, index)}
                </button>
                <span
                  className="grid__resize"
                  aria-hidden="true"
                  onPointerDown={(event) =>
                    startResize(event, widthOf(index), (width) =>
                      setWidth(index, width),
                    )
                  }
                />
              </div>
            )
          })}
        </div>

        <div
          className="grid__body"
          role="rowgroup"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {items.map((item) => {
            const rowIndex = order[item.index]
            const row = rows[rowIndex]
            return (
              <div
                key={rowIndex}
                className="grid__row"
                role="row"
                aria-rowindex={item.index + 2}
                style={{
                  gridTemplateColumns: template,
                  height: ROW_HEIGHT,
                  transform: `translateY(${item.start}px)`,
                }}
              >
                <div
                  className="grid__cell grid__cell--number"
                  role="rowheader"
                  aria-colindex={1}
                >
                  {item.index + 1}
                </div>
                {virtualColumns.map((virtualColumn, rendered) => {
                  const column = visible[virtualColumn.index]
                  const value = row[column]
                  const isSelected =
                    selected?.row === rowIndex && selected.column === column
                  const classes = [
                    'grid__cell',
                    isRightAligned(columns[column].kind) && 'grid__cell--right',
                    isSelected && 'grid__cell--selected',
                  ]
                  return (
                    <div
                      key={column}
                      className={classes.filter(Boolean).join(' ')}
                      role="gridcell"
                      aria-colindex={virtualColumn.index + FIRST_DATA_COLUMN}
                      aria-selected={isSelected}
                      style={{ gridColumnStart: trackOf(rendered) }}
                      onClick={() => setSelected({ row: rowIndex, column })}
                    >
                      {value === null ? (
                        <span className="grid__null">NULL</span>
                      ) : (
                        value
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      <p id={hintId} className="visually-hidden">
        Use the arrow keys to move between the cells. Press Alt+Shift+Left or
        Alt+Shift+Right to change the width of the column of the selected cell.
      </p>
    </div>
  )
}

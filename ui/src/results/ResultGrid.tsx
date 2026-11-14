import { useVirtualizer } from '@tanstack/react-virtual'
import {
  useEffect,
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
/** The grid asks for more rows when the user is this number of rows from the end. */
const FETCH_THRESHOLD_ROWS = 100

type CellPosition = { row: number; column: number }

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
  const template = [
    `${ROW_NUMBER_WIDTH}px`,
    ...visible.map((i) => `${widths[i] ?? DEFAULT_COLUMN_WIDTH}px`),
  ].join(' ')

  // The virtual list is not compatible with the React Compiler. This project does not use the compiler.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: order.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN_ROWS,
  })
  const items = virtualizer.getVirtualItems()
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
  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
      event.preventDefault()
      copyCell()
    }
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
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        <div
          className="grid__row grid__row--header"
          role="row"
          style={{ gridTemplateColumns: template }}
        >
          <div className="grid__cell grid__cell--number" role="columnheader">
            #
          </div>
          {visible.map((index) => (
            <div
              key={index}
              className="grid__cell grid__cell--header"
              role="columnheader"
              aria-sort={ariaSort(sort, index)}
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
                  startResize(
                    event,
                    widths[index] ?? DEFAULT_COLUMN_WIDTH,
                    (width) =>
                      setWidths((current) => ({ ...current, [index]: width })),
                  )
                }
              />
            </div>
          ))}
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
                <div className="grid__cell grid__cell--number" role="rowheader">
                  {item.index + 1}
                </div>
                {visible.map((column) => {
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
                      aria-selected={isSelected}
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
    </div>
  )
}

import { useVirtualizer } from '@tanstack/react-virtual'
import { useShellStore } from '../shell/shellStore'
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { ContextMenu, type ContextMenuState } from '../view/ContextMenu'
import {
  isRightAligned,
  nextSort,
  rowsToTsv,
  sortedIndexes,
  type Column,
  type ColumnAction,
  type Row,
  type SortState,
} from './gridModel'

/** The height of a row in pixels for each density. The style sheet has the same values. */
const ROW_HEIGHTS = { comfortable: 35, compact: 29 } as const
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
  /**
   * Actions for columns, for example "Chart these columns". With them, the user
   * can select columns, and a column header has a menu.
   */
  columnActions?: ColumnAction[]
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

export function ResultGrid(props: Props) {
  const { columns, rows, hasMore, onNeedMore, columnActions = [] } = props
  const scrollRef = useRef<HTMLDivElement>(null)
  /** The columns that the user selected for a column action. */
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set())
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const canPick = columnActions.length > 0
  const [sort, setSort] = useState<SortState>(null)
  const [widths, setWidths] = useState<Record<number, number>>({})
  const [hidden, setHidden] = useState<ReadonlySet<number>>(new Set())
  const [selected, setSelected] = useState<CellPosition | null>(null)
  const rowHeight = ROW_HEIGHTS[useShellStore((state) => state.density)]

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
    estimateSize: () => rowHeight,
    overscan: OVERSCAN_ROWS,
  })
  // A change of the density changes the height of each row.
  useEffect(() => virtualizer.measure(), [rowHeight, virtualizer])
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
    // The user cannot see a change of a hidden column.
    if (!visible.includes(column)) return true
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
    // Ctrl+Space selects the column of the selected cell, as in a spreadsheet.
    if (canPick && (event.ctrlKey || event.metaKey) && event.key === ' ') {
      event.preventDefault()
      if (selected) togglePicked(selected.column)
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
  const togglePicked = (index: number) => {
    const next = new Set(picked)
    if (!next.delete(index)) next.add(index)
    setPicked(next)
  }
  /** The names of the selected columns, in the sequence of the result. */
  const pickedNames = (indexes: Iterable<number>): string[] => [
    ...new Set(
      [...indexes].sort((a, b) => a - b).map((index) => columns[index].name),
    ),
  ]
  /** Opens the menu of a column header. Its actions apply to the selected columns, if the column is one of them. */
  const openMenu = (index: number, x: number, y: number) => {
    const names = pickedNames(picked.has(index) ? picked : [index])
    setMenu({
      label: `Actions for the column ${columns[index].name}`,
      x,
      y,
      items: columnActions.map((action) => ({
        kind: 'action' as const,
        label: action.label(names),
        run: () => action.run(names),
      })),
    })
  }
  /** The keys of a column header: Ctrl+Space selects the column, and the menu key opens the menu. */
  const onHeaderKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    index: number,
  ) => {
    if (!canPick) return
    const isMenuKey =
      event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)
    const isPickKey = event.key === ' ' && (event.ctrlKey || event.metaKey)
    if (!isMenuKey && !isPickKey) return
    event.preventDefault()
    event.stopPropagation()
    if (isPickKey) return togglePicked(index)
    const box = event.currentTarget.getBoundingClientRect()
    openMenu(index, box.left, box.bottom)
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
        {picked.size > 0 &&
          columnActions.map((action) => {
            const label = action.label(pickedNames(picked))
            return (
              <button
                key={label}
                type="button"
                className="button button--small"
                onClick={() => action.run(pickedNames(picked))}
              >
                {label}
              </button>
            )
          })}
        {picked.size > 0 && (
          <button
            type="button"
            className="link-button"
            onClick={() => setPicked(new Set())}
          >
            Clear the column selection
          </button>
        )}
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
                className={`grid__cell grid__cell--header${picked.has(index) ? ' grid__cell--picked' : ''}`}
                role="columnheader"
                aria-colindex={item.index + FIRST_DATA_COLUMN}
                aria-sort={ariaSort(sort, index)}
                aria-selected={canPick ? picked.has(index) : undefined}
                style={{ gridColumnStart: trackOf(rendered) }}
                onContextMenu={(event) => {
                  if (!canPick) return
                  event.preventDefault()
                  openMenu(index, event.clientX, event.clientY)
                }}
              >
                <button
                  type="button"
                  className={
                    isRightAligned(columns[index].kind)
                      ? 'grid__sort grid__sort--right'
                      : 'grid__sort'
                  }
                  title={columns[index].type_name ?? undefined}
                  onKeyDown={(event) => onHeaderKeyDown(event, index)}
                  onClick={(event) => {
                    // Ctrl and a click select the column. A click without Ctrl sorts.
                    if (canPick && (event.ctrlKey || event.metaKey)) {
                      togglePicked(index)
                      return
                    }
                    setSort(nextSort(sort, index))
                    // A header leaves the DOM when the user scrolls it out of view,
                    // and its focus would go to the page. After a click with the
                    // pointer, the grid gets the focus, thus its keys stay usable.
                    // `detail` is 0 for a click from the keyboard.
                    if (event.detail > 0) scrollRef.current?.focus()
                  }}
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
                className={`grid__row${item.index % 2 === 1 ? ' grid__row--even' : ''}`}
                role="row"
                aria-rowindex={item.index + 2}
                style={{
                  gridTemplateColumns: template,
                  height: rowHeight,
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
                    picked.has(column) && 'grid__cell--picked',
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
        {canPick &&
          ' Press Ctrl+Space to select the column of the selected cell or of a column header. The menu of a column header has the actions for the selected columns.'}
      </p>
      {menu && (
        <ContextMenu
          menu={menu}
          onClose={(restoreFocus) => {
            setMenu(null)
            if (restoreFocus) scrollRef.current?.focus()
          }}
        />
      )}
    </div>
  )
}

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import type { MenuItem } from '../shell/menu/menuModel'
import { ContextMenu, type ContextMenuState } from './ContextMenu'

/** One visible row of a tree or a list, for the keys. */
export type KeyRow = {
  key: string
  /** The text for type-ahead. */
  label: string
  /** The level in a tree, from 1. */
  level?: number
  isExpandable?: boolean
  isExpanded?: boolean
  parentKey?: string | null
}

export type ViewKeysOptions = {
  kind: 'tree' | 'list'
  /** The visible rows, in their sequence. */
  rows: KeyRow[]
  /** The row whose detail shows. It has the selection background. */
  selectedKey?: string | null
  /** Space or a click: show the detail in the preview tab. The focus stays. */
  onSelect?: (key: string) => void
  /**
   * Space in a row with a check box, for example a change in Git: set or clear the
   * check box. Without it, Space is the same as `onSelect`.
   */
  onCheck?: (key: string) => void
  /** Enter or a double click: the primary action of the row. */
  onOpen?: (key: string) => void
  /** Ctrl+Enter: the second action of the row. */
  onSecondary?: (key: string) => void
  /** Right and Left in a tree: open or close a node. */
  onToggle?: (key: string, expand: boolean) => void
  /** F2: rename in place. */
  onRename?: (key: string) => void
  /** Delete: delete or discard the row, after a confirmation. */
  onDelete?: (key: string) => void
  /** F5: read the data of the view again. */
  onRefresh?: () => void
  /** Esc in the list: close the preview tab. */
  onEscape?: () => void
  /** The actions of the context menu. They are the actions of the overflow menu. */
  contextItems?: (key: string) => MenuItem[]
  /** Ctrl+F and `/` move the focus to this filter field. */
  filterRef?: RefObject<HTMLInputElement | null>
  /** A virtual list puts the row into the document before it gets the focus. */
  scrollToIndex?: (index: number) => void
  /** The number of rows of PgUp and PgDn. */
  pageSize?: number
}

/** The time after which the type-ahead text starts again. */
export const TYPE_AHEAD_MS = 500

const DEFAULT_PAGE = 10

/**
 * The keys of a tree or a list after the view standards (part 2). The rows use a
 * roving focus: only the focused row is in the Tab order.
 */
export function useViewKeys(options: ViewKeysOptions) {
  const { rows, kind } = options
  const latest = useRef(options)
  useEffect(() => {
    latest.current = options
  })
  const elements = useRef(new Map<string, HTMLElement>())
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  /** The index of the last focused row. A row that goes away gives the focus to the next row. */
  const [lastIndex, setLastIndex] = useState(0)
  const [menu, setMenu] = useState<(ContextMenuState & { key: string }) | null>(
    null,
  )
  const typed = useRef({ text: '', time: 0 })

  // The row with the focus, or the selected row, or the first row.
  const current =
    (focusedKey && rows.some((row) => row.key === focusedKey) && focusedKey) ||
    (options.selectedKey &&
      rows.some((row) => row.key === options.selectedKey) &&
      options.selectedKey) ||
    rows[Math.min(lastIndex, rows.length - 1)]?.key ||
    null

  const focusKey = useCallback((key: string) => {
    setFocusedKey(key)
    const index = latest.current.rows.findIndex((row) => row.key === key)
    if (index >= 0) setLastIndex(index)
    const element = elements.current.get(key)
    if (element) {
      element.focus()
      return
    }
    // A row of a virtual list needs a render before it gets the focus.
    latest.current.scrollToIndex?.(index)
    let tries = 5
    const retry = () => {
      const later = elements.current.get(key)
      if (later) later.focus()
      else if (--tries > 0) requestAnimationFrame(retry)
    }
    requestAnimationFrame(retry)
  }, [])

  const focusIndex = (index: number) => {
    const all = latest.current.rows
    if (all.length === 0) return
    const bounded = Math.max(0, Math.min(index, all.length - 1))
    focusKey(all[bounded].key)
  }

  const openMenu = (key: string, x: number, y: number) => {
    const items = latest.current.contextItems?.(key)
    if (!items || items.length === 0) return
    const row = latest.current.rows.find((item) => item.key === key)
    setMenu({ key, items, label: `Actions for ${row?.label ?? key}`, x, y })
  }

  const typeAhead = (character: string, index: number) => {
    const now = Date.now()
    const isNew = now - typed.current.time > TYPE_AHEAD_MS
    typed.current = {
      text: (isNew ? '' : typed.current.text) + character.toLowerCase(),
      time: now,
    }
    const { text } = typed.current
    const all = latest.current.rows
    // A new search starts after the focused row. A longer text can stay on it.
    const start = text.length === 1 ? index + 1 : index
    for (let step = 0; step < all.length; step++) {
      const candidate = all[(start + step) % all.length]
      if (candidate.label.toLowerCase().startsWith(text)) {
        focusKey(candidate.key)
        return
      }
    }
  }

  const onKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    row: KeyRow,
    index: number,
  ) => {
    // A control in the row, for example a menu button, keeps its own keys.
    if (event.target !== event.currentTarget) return
    const o = latest.current
    const isModifier = event.ctrlKey || event.metaKey
    const page = o.pageSize ?? DEFAULT_PAGE
    let isHandled = true
    const isTypeAhead =
      event.key.length === 1 &&
      !isModifier &&
      !event.altKey &&
      /\S/.test(event.key)
    // A different key, for example Home, starts the type-ahead text again.
    if (!isTypeAhead) typed.current = { text: '', time: 0 }
    if (event.key === 'ArrowDown') focusIndex(index + 1)
    else if (event.key === 'ArrowUp') focusIndex(index - 1)
    else if (event.key === 'Home') focusIndex(0)
    else if (event.key === 'End') focusIndex(o.rows.length - 1)
    else if (event.key === 'PageDown') focusIndex(index + page)
    else if (event.key === 'PageUp') focusIndex(index - page)
    else if (event.key === 'ArrowRight' && kind === 'tree') {
      if (row.isExpandable && !row.isExpanded) o.onToggle?.(row.key, true)
      // An open node without a visible child keeps the focus.
      else if (row.isExpanded && o.rows[index + 1]?.parentKey === row.key)
        focusIndex(index + 1)
    } else if (event.key === 'ArrowLeft' && kind === 'tree') {
      if (row.isExpanded) o.onToggle?.(row.key, false)
      else if (row.parentKey) focusKey(row.parentKey)
    } else if (event.key === ' ' && !isModifier) {
      if (o.onCheck) o.onCheck(row.key)
      else o.onSelect?.(row.key)
    } else if (event.key === 'Enter' && isModifier) o.onSecondary?.(row.key)
    else if (event.key === 'Enter') o.onOpen?.(row.key)
    else if (event.key === 'F2' && o.onRename) o.onRename(row.key)
    else if (event.key === 'Delete' && o.onDelete) o.onDelete(row.key)
    else if (event.key === 'F5' && o.onRefresh) o.onRefresh()
    else if (event.key === 'Escape' && o.onEscape) o.onEscape()
    else if (
      (event.key === 'F10' && event.shiftKey) ||
      event.key === 'ContextMenu'
    ) {
      const rect = event.currentTarget.getBoundingClientRect()
      openMenu(row.key, rect.left + 16, rect.bottom)
    } else if (
      o.filterRef &&
      ((isModifier && event.key.toLowerCase() === 'f') ||
        (event.key === '/' && !isModifier))
    ) {
      o.filterRef.current?.focus()
    } else if (isTypeAhead) {
      typeAhead(event.key, index)
    } else {
      isHandled = false
    }
    if (isHandled) {
      // A handled key does not reach the shortcuts of the window, for example F5.
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const rowProps = (row: KeyRow, index: number) => {
    const isTree = kind === 'tree'
    return {
      role: isTree ? 'treeitem' : 'option',
      tabIndex: row.key === current ? 0 : -1,
      'aria-selected': row.key === options.selectedKey,
      'aria-level': isTree ? (row.level ?? 1) : undefined,
      'aria-expanded':
        isTree && row.isExpandable ? Boolean(row.isExpanded) : undefined,
      'data-row-key': row.key,
      ref: (element: HTMLElement | null) => {
        if (element) elements.current.set(row.key, element)
        else elements.current.delete(row.key)
      },
      onFocus: (event: FocusEvent<HTMLElement>) => {
        if (event.target !== event.currentTarget) return
        setFocusedKey(row.key)
        setLastIndex(index)
      },
      onClick: (event: MouseEvent<HTMLElement>) => {
        // A click on a control in the row does not select the row.
        if (
          (event.target as HTMLElement).closest('button, input, a') !== null &&
          event.target !== event.currentTarget
        ) {
          return
        }
        setFocusedKey(row.key)
        latest.current.onSelect?.(row.key)
      },
      onDoubleClick: () => latest.current.onOpen?.(row.key),
      onKeyDown: (event: KeyboardEvent<HTMLElement>) =>
        onKeyDown(event, row, index),
      onContextMenu: (event: MouseEvent<HTMLElement>) => {
        if (!latest.current.contextItems) return
        event.preventDefault()
        setFocusedKey(row.key)
        openMenu(row.key, event.clientX, event.clientY)
      },
    }
  }

  const contextMenu: ReactNode = menu ? (
    <ContextMenu
      menu={menu}
      onClose={(restoreFocus) => {
        const { key } = menu
        setMenu(null)
        if (restoreFocus) focusKey(key)
      }}
    />
  ) : null

  return {
    focusedKey: current,
    /** Moves the focus to a row, for example after the second Esc in the filter. */
    focusRow: (key?: string | null) => {
      const target = key ?? current
      if (target) focusKey(target)
    },
    rowProps,
    contextMenu,
  }
}

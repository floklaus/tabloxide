import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { isFocusable, type MenuItem } from './menuModel'

/** Why a menu closes. The parent restores the focus only after `escape`. */
export type CloseReason = 'escape' | 'activate' | 'tab'

type MenuListProps = {
  label: string
  items: MenuItem[]
  onClose: (reason: CloseReason) => void
  /** The menu bar moves to the menu on the left or on the right. */
  onNavigate?: (direction: -1 | 1) => void
  /** The item that gets the focus when the menu opens. */
  initialFocus?: 'first' | 'last' | 'none'
  isSubmenu?: boolean
  className?: string
}

const ROLES = {
  action: 'menuitem',
  check: 'menuitemcheckbox',
  radio: 'menuitemradio',
  submenu: 'menuitem',
} as const

function Mark({ item }: { item: MenuItem }) {
  if (item.kind !== 'check' && item.kind !== 'radio') {
    return <span className="menu__mark" aria-hidden="true" />
  }
  return (
    <span className="menu__mark" aria-hidden="true">
      {item.checked ? (item.kind === 'check' ? '✓' : '●') : ''}
    </span>
  )
}

function ItemContent({ item }: { item: MenuItem }): ReactNode {
  if (item.kind === 'separator' || item.kind === 'heading') return null
  const detail =
    item.kind === 'action' || item.kind === 'radio' ? item.detail : undefined
  const shortcut =
    item.kind === 'action' || item.kind === 'check' ? item.shortcut : undefined
  return (
    <>
      <Mark item={item} />
      <span className="menu__label">
        {item.label}
        {detail && <span className="menu__detail">{detail}</span>}
      </span>
      {shortcut && (
        <span className="menu__shortcut" aria-hidden="true">
          {shortcut}
        </span>
      )}
      {item.kind === 'submenu' && (
        <span className="menu__arrow" aria-hidden="true">
          ›
        </span>
      )}
    </>
  )
}

/** A menu with keyboard navigation. A submenu opens to the right of its item. */
export function MenuList({
  label,
  items,
  onClose,
  onNavigate,
  initialFocus = 'first',
  isSubmenu = false,
  className = '',
}: MenuListProps) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null)
  const [submenuFocus, setSubmenuFocus] = useState<'first' | 'none'>('none')
  const focusable = items
    .map((item, index) => (isFocusable(item) ? index : -1))
    .filter((index) => index !== -1)

  const focusIndex = (index: number | undefined) => {
    if (index !== undefined) buttons.current[index]?.focus()
  }

  useEffect(() => {
    if (initialFocus === 'first') focusIndex(focusable[0])
    if (initialFocus === 'last') focusIndex(focusable[focusable.length - 1])
    // The focus moves only when the menu opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const current = () =>
    buttons.current.findIndex((button) => button === document.activeElement)

  const move = (step: 1 | -1) => {
    const position = focusable.indexOf(current())
    const next =
      position === -1
        ? step === 1
          ? 0
          : focusable.length - 1
        : (position + step + focusable.length) % focusable.length
    focusIndex(focusable[next])
  }

  const openSubmenuAt = (index: number, focus: 'first' | 'none') => {
    setSubmenuFocus(focus)
    setOpenSubmenu(index)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    // A key in an open submenu belongs to the submenu.
    if (event.defaultPrevented) return
    const index = current()
    const item = items[index]
    const handled = (() => {
      switch (event.key) {
        case 'ArrowDown':
          move(1)
          return true
        case 'ArrowUp':
          move(-1)
          return true
        case 'Home':
          focusIndex(focusable[0])
          return true
        case 'End':
          focusIndex(focusable[focusable.length - 1])
          return true
        case 'ArrowRight':
          if (item?.kind === 'submenu' && !item.disabled)
            openSubmenuAt(index, 'first')
          else onNavigate?.(1)
          return item?.kind === 'submenu' || onNavigate !== undefined
        case 'ArrowLeft':
          if (isSubmenu) onClose('escape')
          else onNavigate?.(-1)
          return isSubmenu || onNavigate !== undefined
        case 'Escape':
          onClose('escape')
          return true
        case 'Tab':
          onClose('tab')
          return false
        default:
          return false
      }
    })()
    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const activate = (item: MenuItem, index: number) => {
    if (item.kind === 'submenu') {
      openSubmenuAt(index, 'first')
      return
    }
    if (item.kind === 'separator' || item.kind === 'heading' || item.disabled)
      return
    // Close first. A dialog that the item opens then gets the focus.
    onClose('activate')
    item.run()
  }

  return (
    <ul
      role="menu"
      aria-label={label}
      className={`menu ${isSubmenu ? 'menu--submenu' : ''} ${className}`.trim()}
      onKeyDown={onKeyDown}
    >
      {items.map((item, index) => {
        if (item.kind === 'separator') {
          return <li key={index} role="separator" className="menu__separator" />
        }
        if (item.kind === 'heading') {
          return (
            <li key={index} role="presentation" className="menu__heading">
              {item.label}
            </li>
          )
        }
        const isOpen = openSubmenu === index
        return (
          <li key={index} role="none" className="menu__entry">
            <button
              ref={(element) => {
                buttons.current[index] = element
              }}
              type="button"
              tabIndex={-1}
              role={ROLES[item.kind]}
              className="menu__item"
              aria-disabled={item.disabled || undefined}
              aria-checked={
                item.kind === 'check' || item.kind === 'radio'
                  ? item.checked
                  : undefined
              }
              aria-haspopup={item.kind === 'submenu' ? 'menu' : undefined}
              aria-expanded={item.kind === 'submenu' ? isOpen : undefined}
              aria-keyshortcuts={
                'shortcut' in item && item.shortcut
                  ? item.shortcut.replace('Ctrl', 'Control')
                  : undefined
              }
              onClick={() => activate(item, index)}
              onMouseEnter={() => {
                buttons.current[index]?.focus()
                setOpenSubmenu(
                  item.kind === 'submenu' && !item.disabled ? index : null,
                )
                setSubmenuFocus('none')
              }}
            >
              <ItemContent item={item} />
            </button>
            {item.kind === 'submenu' && isOpen && (
              <MenuList
                label={item.label}
                items={item.items}
                isSubmenu
                initialFocus={submenuFocus}
                onClose={(reason) => {
                  setOpenSubmenu(null)
                  if (reason === 'escape') focusIndex(index)
                  else onClose(reason)
                }}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}

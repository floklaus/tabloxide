import { useCallback, useRef, useState, type ReactNode } from 'react'
import { MenuList } from './MenuList'
import type { MenuItem } from './menuModel'
import { useDismiss } from './useDismiss'

type MenuButtonProps = {
  /** The accessible name of the button. */
  label: string
  /** The accessible name of the menu. */
  menuLabel: string
  className?: string
  children: ReactNode
  /** The items. The function runs when the menu opens, so the items are current. */
  items: () => MenuItem[]
  /** Content above the items, for example a search field or a summary. */
  header?: (close: () => void) => ReactNode
}

/** A button that opens a menu. The title bar widgets use it. */
export function MenuButton({
  label,
  menuLabel,
  className = '',
  children,
  items,
  header,
}: MenuButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dismiss = useCallback(() => setIsOpen(false), [])
  useDismiss(ref, isOpen, dismiss)
  const close = () => setIsOpen(false)

  return (
    <div ref={ref} className="menu-button">
      <button
        ref={buttonRef}
        type="button"
        className={`title-widget ${className}`.trim()}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !isOpen) {
            event.preventDefault()
            setIsOpen(true)
          }
        }}
      >
        {children}
      </button>
      {isOpen && (
        <div
          className="menu-popup"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              close()
              buttonRef.current?.focus()
            }
          }}
        >
          {header?.(close)}
          <MenuList
            label={menuLabel}
            items={items()}
            initialFocus={header ? 'none' : 'first'}
            onClose={(reason) => {
              close()
              if (reason === 'escape') buttonRef.current?.focus()
            }}
          />
        </div>
      )}
    </div>
  )
}

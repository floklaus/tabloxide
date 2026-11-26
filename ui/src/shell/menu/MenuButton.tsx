import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
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
  /**
   * `true` puts the popup at the end of the document, at the position of the
   * button. Use it for a button in a container that cuts its content, for example a
   * row of a virtual list.
   */
  isFloating?: boolean
}

/** The width of a floating popup. It stays in the window. */
const FLOATING_WIDTH = 256

function floatingStyle(button: HTMLElement | null): CSSProperties {
  const rect = button?.getBoundingClientRect()
  if (!rect) return { position: 'fixed' }
  const left = Math.max(
    4,
    Math.min(rect.left, window.innerWidth - FLOATING_WIDTH - 4),
  )
  return {
    position: 'fixed',
    top: rect.bottom + 2,
    left,
    width: FLOATING_WIDTH,
  }
}

/** A button that opens a menu. The title bar widgets use it. */
export function MenuButton({
  label,
  menuLabel,
  className = '',
  children,
  items,
  header,
  isFloating = false,
}: MenuButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const dismiss = useCallback(() => setIsOpen(false), [])
  useDismiss(ref, isOpen, dismiss, popupRef)
  const close = () => setIsOpen(false)
  const [position, setPosition] = useState<CSSProperties>({})
  // A floating popup gets its position when it opens, from the place of the button.
  const open = () => {
    if (isFloating) setPosition(floatingStyle(buttonRef.current))
    setIsOpen(true)
  }
  const popup = (content: ReactNode) =>
    isFloating ? createPortal(content, document.body) : content

  return (
    <div ref={ref} className="menu-button">
      <button
        ref={buttonRef}
        type="button"
        className={`title-widget ${className}`.trim()}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => (isOpen ? setIsOpen(false) : open())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !isOpen) {
            event.preventDefault()
            open()
          }
        }}
      >
        {children}
      </button>
      {isOpen &&
        popup(
          <div
            ref={popupRef}
            className={`menu-popup ${isFloating ? 'menu-popup--floating' : ''}`.trim()}
            style={isFloating ? position : undefined}
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
          </div>,
        )}
    </div>
  )
}

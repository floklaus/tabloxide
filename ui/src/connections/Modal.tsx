import { createPortal } from 'react-dom'
import { Icon } from '../shell/icons'
import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

type ModalProps = {
  title: string
  onClose: () => void
  children: ReactNode
  /** A wide dialog has space for two columns of content. */
  isWide?: boolean
  /** Shows a close button (×) in the header. The Escape key closes each dialog. */
  hasCloseButton?: boolean
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/**
 * Keeps the focus in `panel` when the user presses Tab on its last control, or
 * Shift+Tab on its first control. The content behind a modal dialog is not usable.
 */
function keepFocusInside(event: KeyboardEvent, panel: HTMLElement) {
  const controls = panel.querySelectorAll<HTMLElement>(FOCUSABLE)
  if (controls.length === 0) {
    event.preventDefault()
    return
  }
  const first = controls[0]
  const last = controls[controls.length - 1]
  const current = document.activeElement
  if (event.shiftKey && (current === first || current === panel)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && current === last) {
    event.preventDefault()
    first.focus()
  }
}

/**
 * A modal dialog. The Escape key closes it. Focus moves into it when it opens,
 * and the Tab key does not move the focus out of it.
 */
export function Modal({
  title,
  onClose,
  children,
  isWide = false,
  hasCloseButton = false,
}: ModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement
    const panel = panelRef.current
    const firstField = panel?.querySelector<HTMLElement>(
      // In a radio group, the focus goes to the selected option.
      'input:not([type="radio"]), input[type="radio"]:checked, select, textarea, button:not(.modal__close)',
    )
    ;(firstField ?? panel)?.focus()
    return () => {
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])

  // The dialog is a child of the body. Thus a dialog that opens from a different
  // dialog is not inside the box of that dialog.
  return createPortal(
    <div
      className="modal__backdrop"
      // A click on the area around the dialog must not take the focus out of the
      // dialog. If it did, the Tab key would go to the content behind the dialog.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) event.preventDefault()
      }}
    >
      <div
        ref={panelRef}
        className={isWide ? 'modal modal--wide' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          } else if (event.key === 'Tab') {
            // Only the innermost dialog keeps the focus.
            event.stopPropagation()
            keepFocusInside(event, event.currentTarget)
          }
        }}
      >
        <div className="modal__header">
          <h2 id={titleId} className="modal__title">
            {title}
          </h2>
          {hasCloseButton && (
            <button
              type="button"
              className="icon-link modal__close"
              aria-label="Close the dialog"
              title="Close (Escape)"
              onClick={onClose}
            >
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

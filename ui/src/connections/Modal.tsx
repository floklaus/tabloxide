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
export function Modal({ title, onClose, children }: ModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement
    const panel = panelRef.current
    const firstField = panel?.querySelector<HTMLElement>(
      'input, select, textarea, button',
    )
    ;(firstField ?? panel)?.focus()
    return () => {
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])

  return (
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
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          } else if (event.key === 'Tab') {
            keepFocusInside(event, event.currentTarget)
          }
        }}
      >
        <h2 id={titleId} className="modal__title">
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}

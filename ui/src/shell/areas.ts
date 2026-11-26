/**
 * F6 and Shift+F6 move the focus between the areas of the window: the side view,
 * the editor, the lower panel, and the assistant (view standards, part 2). An area
 * gets back the element that had the focus last in it.
 */

/** The areas in their sequence. An element of an area has `data-area`. */
export const AREAS = ['side', 'editor', 'results', 'assistant'] as const

const FOCUSABLE =
  '[tabindex="0"], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [contenteditable="true"]'

const lastFocus = new WeakMap<Element, HTMLElement>()

function areasInWindow(): HTMLElement[] {
  return AREAS.flatMap((name) =>
    Array.from(document.querySelectorAll<HTMLElement>(`[data-area="${name}"]`)),
  ).filter((area) => area.getClientRects().length > 0 || !area.hidden)
}

/** Records the last focused element of each area. */
export function rememberFocus(event: FocusEvent): void {
  const target = event.target as HTMLElement | null
  const area = target?.closest('[data-area]')
  if (area && target) lastFocus.set(area, target)
}

/** Moves the focus to the next area, or to the area before with `backward`. */
export function focusNextArea(backward: boolean): boolean {
  const areas = areasInWindow()
  if (areas.length === 0) return false
  const current = areas.findIndex((area) =>
    area.contains(document.activeElement),
  )
  const step = backward ? -1 : 1
  const next = areas[(current + step + areas.length) % areas.length]
  const remembered = lastFocus.get(next)
  const target =
    remembered && next.contains(remembered) && remembered.isConnected
      ? remembered
      : next.querySelector<HTMLElement>(FOCUSABLE)
  ;(target ?? next).focus()
  return true
}

/** The key handler of the window for F6 and Shift+F6. */
export function handleAreaKey(event: KeyboardEvent): void {
  if (event.key !== 'F6' || event.defaultPrevented) return
  if (focusNextArea(event.shiftKey)) event.preventDefault()
}

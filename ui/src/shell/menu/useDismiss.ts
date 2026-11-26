import { useEffect, type RefObject } from 'react'

/**
 * Calls `onDismiss` when the user presses the pointer outside `ref`. A popup in a
 * portal is not in `ref`. Its element is `extra`, and a press in it does not dismiss.
 */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  isOpen: boolean,
  onDismiss: () => void,
  extra?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (extra?.current?.contains(target)) return
      if (ref.current && !ref.current.contains(target)) onDismiss()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [ref, isOpen, onDismiss, extra])
}

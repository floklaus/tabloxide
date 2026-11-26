import { useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { MenuList } from '../shell/menu/MenuList'
import type { MenuItem } from '../shell/menu/menuModel'
import { useDismiss } from '../shell/menu/useDismiss'

export type ContextMenuState = {
  items: MenuItem[]
  label: string
  /** The position of the menu in the window. */
  x: number
  y: number
}

/**
 * The context menu of a row. It has the same actions as the overflow menu. It opens
 * at the end of the document, so a list that cuts its content does not cut it.
 */
export function ContextMenu({
  menu,
  onClose,
}: {
  menu: ContextMenuState
  /** `true` if the user closed the menu with Esc or with an item. */
  onClose: (restoreFocus: boolean) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const dismiss = useCallback(() => onClose(false), [onClose])
  useDismiss(ref, true, dismiss)
  const left = Math.max(4, Math.min(menu.x, window.innerWidth - 260))
  return createPortal(
    <div
      ref={ref}
      className="menu-popup menu-popup--floating"
      style={{ position: 'fixed', top: menu.y, left, width: 256 }}
    >
      <MenuList
        label={menu.label}
        items={menu.items}
        onClose={() => onClose(true)}
      />
    </div>,
    document.body,
  )
}

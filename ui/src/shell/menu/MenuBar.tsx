import { useCallback, useRef, useState, type KeyboardEvent } from 'react'
import { MenuList, type CloseReason } from './MenuList'
import type { Menu } from './menuModel'
import { useDismiss } from './useDismiss'

type Open = { index: number; focus: 'first' | 'last' | 'none' }

/** The menu bar: File, Connections, Git, and View. */
export function MenuBar({ buildMenus }: { buildMenus: () => Menu[] }) {
  const [open, setOpen] = useState<Open | null>(null)
  const ref = useRef<HTMLElement>(null)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const dismiss = useCallback(() => setOpen(null), [])
  // The items show the current state. The menus are new at each render.
  const menus = buildMenus()
  useDismiss(ref, open !== null, dismiss)

  const close = (index: number, reason: CloseReason) => {
    setOpen(null)
    if (reason === 'escape') buttons.current[index]?.focus()
  }

  const navigate = (index: number, direction: -1 | 1) => {
    const next = (index + direction + menus.length) % menus.length
    buttons.current[next]?.focus()
    setOpen({ index: next, focus: 'first' })
  }

  const onButtonKeyDown = (event: KeyboardEvent, index: number) => {
    const actions: Record<string, () => void> = {
      ArrowDown: () => setOpen({ index, focus: 'first' }),
      ArrowUp: () => setOpen({ index, focus: 'last' }),
      ArrowRight: () => buttons.current[(index + 1) % menus.length]?.focus(),
      ArrowLeft: () =>
        buttons.current[(index - 1 + menus.length) % menus.length]?.focus(),
    }
    const action = actions[event.key]
    if (!action) return
    event.preventDefault()
    action()
  }

  return (
    <nav ref={ref} className="menu-bar" aria-label="Menu bar">
      {menus.map((menu, index) => {
        const isOpen = open?.index === index
        return (
          <div key={menu.label} className="menu-bar__entry">
            <button
              ref={(element) => {
                buttons.current[index] = element
              }}
              type="button"
              className="menu-bar__button"
              aria-haspopup="menu"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : { index, focus: 'first' })}
              onKeyDown={(event) => onButtonKeyDown(event, index)}
              onMouseEnter={() => {
                // While a menu is open, the pointer moves the open menu.
                if (open && !isOpen) setOpen({ index, focus: 'none' })
              }}
            >
              {menu.label}
            </button>
            {isOpen && (
              <MenuList
                key={index}
                label={menu.label}
                items={menu.items}
                initialFocus={open.focus}
                className="menu--dropdown"
                onClose={(reason) => close(index, reason)}
                onNavigate={(direction) => navigate(index, direction)}
              />
            )}
          </div>
        )
      })}
    </nav>
  )
}

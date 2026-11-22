/** The items of a menu. The menu bar, the title bar widgets, and the submenus use them. */
export type MenuItem =
  | {
      kind: 'action'
      label: string
      /** A second text after the label, for example a path or a server version. */
      detail?: string
      shortcut?: string
      disabled?: boolean
      run: () => void
    }
  | {
      kind: 'check'
      label: string
      shortcut?: string
      checked: boolean
      disabled?: boolean
      run: () => void
    }
  | {
      kind: 'radio'
      label: string
      detail?: string
      checked: boolean
      disabled?: boolean
      run: () => void
    }
  | { kind: 'submenu'; label: string; items: MenuItem[]; disabled?: boolean }
  | { kind: 'separator' }
  | { kind: 'heading'; label: string }

export type Menu = { label: string; items: MenuItem[] }

/** Returns `true` if the user can move the focus to the item. */
export function isFocusable(item: MenuItem): boolean {
  return item.kind !== 'separator' && item.kind !== 'heading' && !item.disabled
}

/** Removes separators at the start, at the end, and next to each other. */
export function tidy(items: MenuItem[]): MenuItem[] {
  const result: MenuItem[] = []
  for (const item of items) {
    const previous = result[result.length - 1]
    if (
      item.kind === 'separator' &&
      (!previous || previous.kind === 'separator')
    ) {
      continue
    }
    result.push(item)
  }
  while (result[result.length - 1]?.kind === 'separator') result.pop()
  return result
}

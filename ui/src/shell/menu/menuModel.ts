import type { Environment } from '../../bindings'

/** Optional parts of an action or a radio item. */
type ItemExtras = {
  /** A second line below the label, for example a path. */
  detail?: string
  /** A short text at the right side, for example a server version or a time. */
  aside?: string
  /** A coloured dot before the label, for the environment of a connection. */
  dot?: Environment
  /** `true` if the label is code, for example a branch name. */
  isCode?: boolean
}

/** The items of a menu. The menu bar, the title bar widgets, and the submenus use them. */
export type MenuItem =
  | ({
      kind: 'action'
      label: string
      shortcut?: string
      disabled?: boolean
      run: () => void
    } & ItemExtras)
  | {
      kind: 'check'
      label: string
      shortcut?: string
      checked: boolean
      disabled?: boolean
      run: () => void
    }
  | ({
      kind: 'radio'
      label: string
      checked: boolean
      disabled?: boolean
      run: () => void
    } & ItemExtras)
  | { kind: 'submenu'; label: string; items: MenuItem[]; disabled?: boolean }
  | { kind: 'separator' }
  /** A heading. With `tone`, the heading is an environment badge. */
  | { kind: 'heading'; label: string; tone?: Environment }

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

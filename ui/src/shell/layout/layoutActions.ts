import { allLayouts, settingsOf, useShellStore } from '../shellStore'
import { unusedName, type SavedLayout } from './layoutModel'

/** The layout that the layout editor selects when it opens. */
let requestedLayoutId: string | null = null

/** Returns the layout that the editor must select, once. */
export function takeRequestedLayout(): string | null {
  const id = requestedLayoutId
  requestedLayoutId = null
  return id
}

/** Makes a new identifier for a custom layout. */
export function newLayoutId(): string {
  return `custom-${crypto.randomUUID()}`
}

/** Saves the current window as a new custom layout, then opens the editor to rename it. */
export function saveCurrentLayout(): void {
  const shell = useShellStore.getState()
  const layout: SavedLayout = {
    id: newLayoutId(),
    name: unusedName(allLayouts(shell.customLayouts), 'My layout'),
    settings: settingsOf(shell),
    isBuiltIn: false,
  }
  shell.saveLayout(layout)
  requestedLayoutId = layout.id
  shell.openDialog('layout')
}

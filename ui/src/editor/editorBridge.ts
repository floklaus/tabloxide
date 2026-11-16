import type { RefObject } from 'react'
import type { CodeEditorHandle } from './CodeEditor'

let active: RefObject<CodeEditorHandle | null> | null = null

/**
 * Records the SQL editor that the user sees. A panel that is not a parent of the
 * editor uses it to read the selection and to insert text.
 */
export function setActiveEditor(
  editor: RefObject<CodeEditorHandle | null> | null,
): void {
  active = editor
}

/** Returns the SQL editor that the user sees, or `null` if no tab is open. */
export function activeEditor(): CodeEditorHandle | null {
  return active?.current ?? null
}

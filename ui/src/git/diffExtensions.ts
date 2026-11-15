import { PostgreSQL, sql } from '@codemirror/lang-sql'
import { syntaxHighlighting } from '@codemirror/language'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { classHighlighter } from '@lezer/highlight'

/** Extensions for each side of a diff: line numbers and SQL colours. */
export const DIFF_BASE: Extension[] = [
  lineNumbers(),
  sql({ dialect: PostgreSQL }),
  syntaxHighlighting(classHighlighter),
]

/** Gives the text of a side a name for a screen reader. */
export function sideLabel(label: string): Extension {
  return EditorView.contentAttributes.of({ 'aria-label': label })
}

/** Extensions for a side that the user cannot change. `label` is its accessible name. */
export function readOnlySide(label: string): Extension[] {
  return [
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    sideLabel(label),
    ...DIFF_BASE,
  ]
}

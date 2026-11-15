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

/** Extensions for a side that the user cannot change. */
export const READ_ONLY: Extension[] = [
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
  ...DIFF_BASE,
]

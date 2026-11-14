import { PostgreSQL, sql } from '@codemirror/lang-sql'
import { syntaxHighlighting } from '@codemirror/language'
import { MergeView } from '@codemirror/merge'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { classHighlighter } from '@lezer/highlight'
import { useEffect, useRef } from 'react'
import type { FileDiff } from '../bindings'
import { useGitStore } from './gitStore'

const READ_ONLY: Extension[] = [
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
  lineNumbers(),
  sql({ dialect: PostgreSQL }),
  syntaxHighlighting(classHighlighter),
]

function Sides({ diff }: { diff: FileDiff }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const view = new MergeView({
      parent: hostRef.current ?? undefined,
      a: { doc: diff.original, extensions: READ_ONLY },
      b: { doc: diff.modified, extensions: READ_ONLY },
      collapseUnchanged: { margin: 3, minSize: 6 },
    })
    return () => view.destroy()
  }, [diff])

  return <div ref={hostRef} className="diff__sides code-editor" />
}

/** The two sides of the diff of the file that the user selected in the Git panel. */
export function DiffView() {
  const diff = useGitStore((state) => state.diff)
  if (!diff) {
    return (
      <p className="pane__hint">
        Select a changed file in the Git panel to see its diff here.
      </p>
    )
  }
  const sides = diff.isStaged
    ? 'Left: last commit. Right: staged.'
    : 'Left: staged or last commit. Right: file on disk.'

  return (
    <div className="diff">
      <h3 className="table-detail__title">{diff.path}</h3>
      <p className="results__status">{sides}</p>
      {diff.load.status === 'loading' && <p role="status">Loading the diff…</p>}
      {diff.load.status === 'failed' && (
        <p className="message message--error" role="alert">
          {diff.load.message}
        </p>
      )}
      {diff.load.status === 'loaded' && <Sides diff={diff.load.diff} />}
    </div>
  )
}

import { MergeView } from '@codemirror/merge'
import { useEffect, useRef } from 'react'
import type { FileDiff } from '../bindings'
import { ConflictView } from './ConflictView'
import { READ_ONLY } from './diffExtensions'
import { useGitStore } from './gitStore'

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

/** The diff or the conflict of the file that the user selected in the Git panel. */
export function DiffView() {
  const diff = useGitStore((state) => state.diff)
  const conflict = useGitStore((state) => state.conflict)
  if (conflict) return <ConflictView key={conflict.path} conflict={conflict} />
  if (!diff) {
    return (
      <p className="pane__hint">
        Select a changed file or a commit in the Git panel to see its diff here.
      </p>
    )
  }

  return (
    <div className="diff">
      <h3 className="table-detail__title">{diff.title}</h3>
      <p className="results__status">{diff.sides}</p>
      {diff.load.status === 'loading' && <p role="status">Loading the diff…</p>}
      {diff.load.status === 'failed' && (
        <p className="message message--error" role="alert">
          {diff.load.message}
        </p>
      )}
      {diff.load.status === 'loaded' && <Sides diff={diff.load.data} />}
    </div>
  )
}

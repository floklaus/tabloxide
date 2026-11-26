import { MergeView } from '@codemirror/merge'
import { useEffect, useRef } from 'react'
import { AiAction } from '../assistant/AiAction'
import { commands, type FileDiff } from '../bindings'
import { readOnlySide } from './diffExtensions'
import { useLoad, type Load } from './gitLoad'
import { useGitStore } from './gitStore'

/** The two sides of a diff, next to each other. */
export function DiffSides({ diff }: { diff: FileDiff }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const view = new MergeView({
      parent: hostRef.current ?? undefined,
      a: { doc: diff.original, extensions: readOnlySide('Original version') },
      b: { doc: diff.modified, extensions: readOnlySide('Changed version') },
      collapseUnchanged: { margin: 3, minSize: 6 },
    })
    return () => view.destroy()
  }, [diff])

  return <div ref={hostRef} className="diff__sides code-editor" />
}

/** The load state of a diff: a status, an error, or the two sides. */
export function DiffLoad({ load }: { load: Load<FileDiff> }) {
  if (load.status === 'loading') return <p role="status">Loading the diff…</p>
  if (load.status === 'failed') {
    return (
      <p className="message message--error" role="alert">
        {load.message}
      </p>
    )
  }
  return <DiffSides diff={load.data} />
}

/**
 * The detail tab of a changed file: the staged changes, or the changes on disk. It
 * reads the diff again after each read of the status.
 */
export function DiffView({ path, staged }: { path: string; staged: boolean }) {
  const revision = useGitStore((state) => state.revision)
  const busy = useGitStore((state) => state.busy)
  const load = useLoad(`${staged}:${path}:${revision}`, () =>
    commands.gitDiff(path, staged),
  )
  const move = () => {
    const { stage, unstage } = useGitStore.getState()
    void (staged ? unstage([path]) : stage([path]))
  }

  return (
    <div className="diff">
      <div className="table-detail__header">
        <h3 className="table-detail__title">{path}</h3>
        {load.status === 'loaded' && (
          <AiAction
            label="Explain the changes"
            title="The AI explains the effect of the changes. The request sends the diff of this file."
            request={() => ({
              task: 'explain-diff',
              text: `Explain the changes in ${path}.`,
              context: { type: 'file-diff', path, staged },
            })}
          />
        )}
        <button
          type="button"
          className="button button--small"
          disabled={busy !== null}
          onClick={move}
        >
          {staged ? 'Unstage' : 'Stage'}
        </button>
      </div>
      <p className="results__status">
        {staged
          ? 'Staged changes. Left: last commit. Right: staged.'
          : 'Changes on disk. Left: staged or last commit. Right: file on disk.'}
      </p>
      <DiffLoad load={load} />
    </div>
  )
}

import { useState } from 'react'
import {
  commands,
  type CommitFile_Serialize as CommitFile,
  type CommitInfo,
} from '../bindings'
import { dayName, timeText } from '../history/historyStore'
import { StatusMark } from '../view/StatusMark'
import { CHANGE_LABELS } from './changeLabels'
import { DiffLoad } from './DiffView'
import { useLoad } from './gitLoad'
import {
  baseName,
  commitSeconds,
  fileCount,
  folderName,
  isPushed,
} from './gitModel'
import { useGitStore } from './gitStore'

const KIND_LETTERS: Record<CommitFile['kind'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  'type-changed': 'T',
}

/** The diff of one file of a commit. */
function CommitFileDiff({ id, file }: { id: string; file: CommitFile }) {
  const load = useLoad(`${id}:${file.path}`, () =>
    commands.gitCommitDiff(id, file.path, file.original_path),
  )
  return (
    <section className="diff" aria-label={`Diff of ${file.path}`}>
      <p className="results__status">
        {file.path} · {CHANGE_LABELS[file.kind]}. Left: before the commit.
        Right: the commit.
      </p>
      <DiffLoad load={load} />
    </section>
  )
}

/** The files of a commit. A click shows the diff of the file below the list. */
function CommitFiles({ commit }: { commit: CommitInfo }) {
  const load = useLoad(commit.id, () => commands.gitCommitFiles(commit.id))
  const [selected, setSelected] = useState<string | null>(null)
  if (load.status === 'loading') return <p role="status">Loading the files…</p>
  if (load.status === 'failed') {
    return (
      <p className="message message--error" role="alert">
        {load.message}
      </p>
    )
  }
  const files = load.data
  if (files.length === 0)
    return <p className="pane__hint">The commit changed no file.</p>
  const shown = files.find((file) => file.path === selected) ?? files[0]
  return (
    <>
      <ul
        className="commit-detail__files"
        aria-label={`Files of ${commit.short_id}`}
      >
        {files.map((file) => (
          <li key={file.path}>
            <button
              type="button"
              className="commit-detail__file"
              aria-pressed={file.path === shown.path}
              title={file.path}
              onClick={() => setSelected(file.path)}
            >
              <span
                className={`git-kind git-kind--${file.kind}`}
                aria-label={CHANGE_LABELS[file.kind]}
              >
                {KIND_LETTERS[file.kind]}
              </span>
              <span className="view-row__label">{baseName(file.path)}</span>
              <span className="view-row__muted">{folderName(file.path)}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="results__status">{fileCount(files.length)}</p>
      <CommitFileDiff key={shown.path} id={commit.id} file={shown} />
    </>
  )
}

/**
 * The detail tab of a commit: the subject, the author, the time, the short name,
 * whether the remote has it, the files, and the diff of each file.
 */
export function CommitDetail({ id }: { id: string }) {
  const commits = useGitStore((state) => state.history?.commits)
  const overview = useGitStore((state) => state.overview)
  const index = commits?.findIndex((commit) => commit.id === id) ?? -1
  const commit = index >= 0 ? commits?.[index] : undefined
  if (!commit) {
    return (
      <p className="pane__hint">
        The history of the current branch has no commit with this name now.
      </p>
    )
  }
  const status = overview?.state === 'repository' ? overview.status : null
  const pushed = status !== null && isPushed(index, status)
  const seconds = commitSeconds(commit)
  return (
    <div className="commit-detail">
      <div className="table-detail__header">
        <h3 className="table-detail__title">{commit.subject}</h3>
      </div>
      <p className="results__status">
        {commit.author} · {dayName(seconds).toLowerCase()} {timeText(seconds)}
        {' · '}
        <code className="table-detail__code">{commit.short_id}</code>
        {' · '}
        <StatusMark
          status={pushed ? 'ok' : 'warning'}
          label={pushed ? 'Pushed' : 'Not pushed'}
        />{' '}
        {pushed ? 'pushed' : 'not pushed'}
      </p>
      <CommitFiles commit={commit} />
    </div>
  )
}

import type {
  CommitFile_Serialize as CommitFile,
  CommitInfo,
} from '../bindings'
import { CHANGE_LABELS } from './changeLabels'
import { useGitStore } from './gitStore'

function CommitFiles({ commit }: { commit: CommitInfo }) {
  const load = useGitStore((state) => state.commitFiles?.load)
  const showCommitDiff = useGitStore((state) => state.showCommitDiff)
  if (!load || load.status === 'loading') {
    return <p role="status">Loading the files…</p>
  }
  if (load.status === 'failed') {
    return (
      <p className="message message--error" role="alert">
        {load.message}
      </p>
    )
  }
  if (load.data.length === 0) {
    return <p className="pane__hint">The commit changed no file.</p>
  }

  return (
    <ul className="git__files" aria-label={`Files of ${commit.short_id}`}>
      {load.data.map((file: CommitFile) => (
        <li key={file.path} className="git__file">
          <button
            type="button"
            className="git__path"
            title={`Show the diff of ${file.path} in ${commit.short_id}`}
            onClick={() => void showCommitDiff(commit, file)}
          >
            {file.path}{' '}
            <span className="schema__detail">{CHANGE_LABELS[file.kind]}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** The commits of the current branch. A commit opens to show its files. */
export function CommitHistory() {
  const history = useGitStore((state) => state.history)
  const openId = useGitStore((state) => state.commitFiles?.id)
  const loadHistory = useGitStore((state) => state.loadHistory)
  const loadMoreHistory = useGitStore((state) => state.loadMoreHistory)
  const closeHistory = useGitStore((state) => state.closeHistory)
  const toggleCommit = useGitStore((state) => state.toggleCommit)

  return (
    <section aria-label="Commit history">
      <div className="connections__header">
        <h3 className="git__subtitle">History</h3>
        <button
          type="button"
          className="link-button"
          aria-expanded={history !== null}
          onClick={() => (history ? closeHistory() : void loadHistory())}
        >
          {history ? 'Hide the history' : 'Show the history'}
        </button>
      </div>
      {history && history.commits.length === 0 && !history.isLoading && (
        <p className="pane__hint">The branch has no commits.</p>
      )}
      {history && (
        <ul className="git__files">
          {history.commits.map((commit) => (
            <li key={commit.id}>
              <button
                type="button"
                className="git__path git__commit-row"
                aria-expanded={openId === commit.id}
                onClick={() => void toggleCommit(commit.id)}
              >
                <span className="git__commit-subject">{commit.subject}</span>
                <span className="schema__detail">
                  {commit.short_id} · {commit.author} ·{' '}
                  {commit.date.slice(0, 10)}
                </span>
              </button>
              {openId === commit.id && <CommitFiles commit={commit} />}
            </li>
          ))}
        </ul>
      )}
      {history?.isLoading && <p role="status">Loading the history…</p>}
      {history?.hasMore && !history.isLoading && (
        <button
          type="button"
          className="link-button"
          onClick={() => void loadMoreHistory()}
        >
          Load more commits
        </button>
      )}
    </section>
  )
}

import { useEffect, useState, type FormEvent } from 'react'
import type { FileStatus_Serialize as FileStatus } from '../bindings'
import { ConfirmDialog } from '../connections/ConfirmDialog'
import { Branches } from './Branches'
import { CHANGE_LABELS } from './changeLabels'
import { CommitHistory } from './CommitHistory'
import { CommitMessageAi } from './CommitMessageAi'
import { useGitStore, type GitOverview } from './gitStore'
import { useRemoteStore } from './remoteStore'

type Repository = Extract<GitOverview, { state: 'repository' }>

function changeLabel(file: FileStatus, isStagedList: boolean): string {
  if (file.is_conflicted) return 'conflict'
  if (file.is_untracked) return 'new'
  const kind = isStagedList ? file.staged : file.unstaged
  return kind ? CHANGE_LABELS[kind] : ''
}

type FileListProps = {
  title: string
  files: FileStatus[]
  isStagedList: boolean
  onDiscard: (file: FileStatus) => void
}

function FileList({ title, files, isStagedList, onDiscard }: FileListProps) {
  const busy = useGitStore((state) => state.busy)
  const stage = useGitStore((state) => state.stage)
  const unstage = useGitStore((state) => state.unstage)
  const showDiff = useGitStore((state) => state.showDiff)
  const showConflict = useGitStore((state) => state.showConflict)
  if (files.length === 0) return null
  const paths = files.map((file) => file.path)
  const moveAll = isStagedList ? unstage : stage

  return (
    <section aria-label={title}>
      <div className="connections__header">
        <h3 className="git__subtitle">
          {title} ({files.length})
        </h3>
        {!files[0].is_conflicted && (
          <button
            type="button"
            className="link-button"
            disabled={busy !== null}
            onClick={() => void moveAll(paths)}
          >
            {isStagedList ? 'Unstage all' : 'Stage all'}
          </button>
        )}
      </div>
      <ul className="git__files">
        {files.map((file) => (
          <li key={file.path} className="git__file">
            <button
              type="button"
              className="git__path"
              title={
                file.is_conflicted
                  ? `Resolve the conflict in ${file.path}`
                  : `Show the diff of ${file.path}`
              }
              onClick={() =>
                void (file.is_conflicted
                  ? showConflict(file.path)
                  : showDiff(file.path, isStagedList))
              }
            >
              {file.path}{' '}
              <span className="schema__detail">
                {changeLabel(file, isStagedList)}
              </span>
            </button>
            {file.is_conflicted ? (
              <button
                type="button"
                className="link-button"
                aria-label={`Resolve ${file.path}`}
                onClick={() => void showConflict(file.path)}
              >
                Resolve
              </button>
            ) : (
              <button
                type="button"
                className="link-button"
                disabled={busy !== null}
                aria-label={`${isStagedList ? 'Unstage' : 'Stage'} ${file.path}`}
                onClick={() => void moveAll([file.path])}
              >
                {isStagedList ? 'Unstage' : 'Stage'}
              </button>
            )}
            {!isStagedList && !file.is_conflicted && (
              <button
                type="button"
                className="link-button link-button--danger"
                disabled={busy !== null}
                aria-label={`Discard ${file.path}`}
                onClick={() => onDiscard(file)}
              >
                Discard
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function RepositoryView({ repository }: { repository: Repository }) {
  const busy = useGitStore((state) => state.busy)
  const commit = useGitStore((state) => state.commit)
  const discard = useGitStore((state) => state.discard)
  const fetch = useGitStore((state) => state.fetch)
  const pull = useGitStore((state) => state.pull)
  const push = useGitStore((state) => state.push)
  const abortMerge = useGitStore((state) => state.abortMerge)
  const [isAborting, setIsAborting] = useState(false)
  const [message, setMessage] = useState('')
  const [discarding, setDiscarding] = useState<FileStatus | null>(null)
  const { files } = repository.status
  const mergeMessage = repository.merge_message
  const isMerging = mergeMessage !== null

  const conflicted = files.filter((file) => file.is_conflicted)
  const staged = files.filter((file) => file.staged !== null)
  const changed = files.filter(
    (file) =>
      !file.is_conflicted && (file.unstaged !== null || file.is_untracked),
  )
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (await commit(effectiveMessage)) setMessage('')
  }
  // A merge has a prepared message. The user can replace it.
  const effectiveMessage = message.trim() ? message : (mergeMessage ?? '')
  // A merge without a staged change still needs its commit.
  const canCommit = isMerging ? conflicted.length === 0 : staged.length > 0

  return (
    <>
      <Branches repository={repository} />
      <div className="git__row">
        {[
          { label: 'Fetch', run: fetch },
          { label: 'Pull', run: pull },
          { label: 'Push', run: push },
        ].map((action) => (
          <button
            key={action.label}
            type="button"
            className="button button--small"
            disabled={busy !== null}
            onClick={() => void action.run()}
          >
            {action.label}
          </button>
        ))}
      </div>
      {isMerging && (
        <div
          className={`message ${conflicted.length > 0 ? 'message--error' : ''}`}
          role={conflicted.length > 0 ? 'alert' : 'status'}
        >
          <p className="message__title">
            {conflicted.length > 0 ? 'Merge conflict' : 'Merge in progress'}
          </p>
          <p className="message__detail">
            {conflicted.length > 0
              ? 'Select each file in the Conflicts list and resolve it. Then commit to complete the merge.'
              : 'All conflicts are resolved. Commit to complete the merge.'}
          </p>
          <button
            type="button"
            className="link-button link-button--danger"
            disabled={busy !== null}
            onClick={() => setIsAborting(true)}
          >
            Abort the merge
          </button>
        </div>
      )}
      <FileList
        title="Conflicts"
        files={conflicted}
        isStagedList={false}
        onDiscard={setDiscarding}
      />
      <FileList
        title="Staged"
        files={staged}
        isStagedList
        onDiscard={setDiscarding}
      />
      <FileList
        title="Changes"
        files={changed}
        isStagedList={false}
        onDiscard={setDiscarding}
      />
      {files.length === 0 && (
        <p className="pane__hint">No changes in the working tree.</p>
      )}
      <form className="git__commit" onSubmit={(event) => void submit(event)}>
        <label className="git__message-field">
          <span className="git__message-label">Message</span>
          <textarea
            className="git__message"
            aria-label="Commit message"
            placeholder={mergeMessage || 'Commit message'}
            rows={3}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
        <CommitMessageAi
          message={message}
          onMessage={setMessage}
          disabled={busy !== null || staged.length === 0}
          commitButton={
            <button
              type="submit"
              className="button button--small button--primary"
              disabled={busy !== null || !canCommit || !effectiveMessage.trim()}
            >
              {isMerging ? 'Commit the merge' : 'Commit'}{' '}
              {staged.length > 0 ? `(${staged.length})` : ''}
            </button>
          }
        />
      </form>
      <CommitHistory />
      {isAborting && (
        <ConfirmDialog
          title="Abort the merge?"
          message="This restores the files to their state before the merge. You lose the conflicts that you resolved."
          confirmLabel="Abort the merge"
          onConfirm={() => {
            void abortMerge()
            setIsAborting(false)
          }}
          onCancel={() => setIsAborting(false)}
        />
      )}
      {discarding && (
        <ConfirmDialog
          title="Discard the changes?"
          message={
            discarding.is_untracked
              ? `This deletes the file "${discarding.path}". You cannot undo this.`
              : `This removes your changes in "${discarding.path}". You cannot undo this.`
          }
          confirmLabel="Discard"
          onConfirm={() => {
            void discard(discarding)
            setDiscarding(null)
          }}
          onCancel={() => setDiscarding(null)}
        />
      )}
    </>
  )
}

/** The Git state of the workspace and the Git operations. */
export function GitPanel() {
  const overview = useGitStore((state) => state.overview)
  const busy = useGitStore((state) => state.busy)
  const progress = useRemoteStore((state) => state.progress)
  const output = useGitStore((state) => state.output)
  const error = useGitStore((state) => state.error)
  const refresh = useGitStore((state) => state.refresh)
  const init = useGitStore((state) => state.init)
  const setEnabled = useGitStore((state) => state.setEnabled)
  const clearMessages = useGitStore((state) => state.clearMessages)

  // The status can change outside the application. Read it when the window gets the focus.
  useEffect(() => {
    void refresh()
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  return (
    <section className="git" aria-label="Git">
      <div className="connections__header">
        <h2 className="pane__title">Git</h2>
        <button
          type="button"
          className="link-button"
          onClick={() => void refresh()}
        >
          Refresh
        </button>
      </div>
      {busy && (
        <p role="status">
          {busy}…{progress && <span className="git__progress">{progress}</span>}
        </p>
      )}
      {error && (
        <div className="message message--error" role="alert">
          <p className="message__detail git__output">{error}</p>
          <button type="button" className="link-button" onClick={clearMessages}>
            Dismiss
          </button>
        </div>
      )}
      {output && !error && (
        <div className="message" role="status">
          <p className="message__detail git__output">{output}</p>
          <button type="button" className="link-button" onClick={clearMessages}>
            Dismiss
          </button>
        </div>
      )}
      {overview?.state === 'disabled' && (
        <>
          <p className="pane__hint">Git is disabled for this workspace.</p>
          <button
            type="button"
            className="button button--small"
            onClick={() => void setEnabled(true)}
          >
            Enable Git
          </button>
        </>
      )}
      {overview?.state === 'not-installed' && (
        <p className="message message--error" role="alert">
          {overview.message}
        </p>
      )}
      {overview?.state === 'no-repository' && (
        <>
          <p className="pane__hint">
            The workspace folder is not in a Git repository.
          </p>
          <button
            type="button"
            className="button button--small button--primary"
            disabled={busy !== null}
            onClick={() => void init()}
          >
            Initialise a repository
          </button>
        </>
      )}
      {overview?.state === 'repository' && (
        <RepositoryView repository={overview} />
      )}
      {overview && overview.state !== 'disabled' && (
        <button
          type="button"
          className="link-button git__disable"
          onClick={() => void setEnabled(false)}
        >
          Disable Git for this workspace
        </button>
      )}
    </section>
  )
}

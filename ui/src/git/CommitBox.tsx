import { CommitMessageAi } from './CommitMessageAi'
import { commitNow, commitPlan } from './gitActions'
import type { Repository } from './gitModel'
import { useGitStore } from './gitStore'

/**
 * The commit box at the bottom of the Git view: the message field, the AI action
 * that writes the message, and Commit. Ctrl+Enter in the field commits.
 */
export function CommitBox({ repository }: { repository: Repository }) {
  const busy = useGitStore((state) => state.busy)
  const message = useGitStore((state) => state.message)
  const setMessage = useGitStore((state) => state.setMessage)
  const plan = commitPlan(repository, message)
  const isDisabled = busy !== null || !plan.canCommit

  return (
    <form
      className="git-commit"
      aria-label="Commit"
      onSubmit={(event) => {
        event.preventDefault()
        void commitNow()
      }}
    >
      <textarea
        className="git__message"
        aria-label="Commit message"
        aria-keyshortcuts="Control+Enter"
        placeholder={repository.merge_message || 'Commit message'}
        rows={3}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
          event.preventDefault()
          void commitNow()
        }}
      />
      <CommitMessageAi
        message={message}
        onMessage={setMessage}
        disabled={busy !== null || plan.staged === 0}
        commitButton={
          <button
            type="submit"
            className="button button--small button--primary"
            aria-keyshortcuts="Control+Enter"
            title={`${plan.label} (Ctrl+Enter)`}
            disabled={isDisabled}
          >
            {plan.label}
            <span className="git-commit__key" aria-hidden="true">
              Ctrl+Enter
            </span>
          </button>
        }
      />
    </form>
  )
}

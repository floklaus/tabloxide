import { useState, type FormEvent } from 'react'
import { ConfirmDialog } from '../connections/ConfirmDialog'
import { useGitStore, type GitOverview } from './gitStore'

type Repository = Extract<GitOverview, { state: 'repository' }>

type Form =
  { mode: 'create' | 'rename'; name: string } | { mode: 'delete'; name: string }

/** A branch that the user wants to delete. `isForced` is for the second question. */
type Deletion = { name: string; isForced: boolean }

const FORM_LABELS = {
  create: { field: 'Name of the new branch', submit: 'Create' },
  rename: { field: 'New name of the branch', submit: 'Rename' },
}

/** The branch selector and the branch operations: create, rename, and delete. */
export function Branches({ repository }: { repository: Repository }) {
  const busy = useGitStore((state) => state.busy)
  const switchBranch = useGitStore((state) => state.switchBranch)
  const createBranch = useGitStore((state) => state.createBranch)
  const renameBranch = useGitStore((state) => state.renameBranch)
  const deleteBranch = useGitStore((state) => state.deleteBranch)
  const [form, setForm] = useState<Form | null>(null)
  const [deletion, setDeletion] = useState<Deletion | null>(null)
  const { status, branches } = repository
  const current = status.branch
  const others = branches.filter((branch) => branch.name !== current)
  const isIdle = busy === null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!form) return
    const name = form.name.trim()
    if (form.mode === 'delete') {
      setDeletion({ name, isForced: false })
      return
    }
    const isDone =
      form.mode === 'create'
        ? await createBranch(name)
        : current !== null && (await renameBranch(current, name))
    if (isDone) setForm(null)
  }

  const confirmDeletion = async () => {
    if (!deletion) return
    setDeletion(null)
    const result = await deleteBranch(deletion.name, deletion.isForced)
    if (result === 'not-merged') setDeletion({ ...deletion, isForced: true })
    if (result === 'deleted') setForm(null)
  }

  return (
    <>
      <div className="git__row">
        <label className="git__branch">
          <span className="visually-hidden">Branch</span>
          <select
            value={current ?? ''}
            disabled={!isIdle}
            onChange={(event) => void switchBranch(event.target.value)}
          >
            {current === null && <option value="">Detached HEAD</option>}
            {current !== null &&
              !branches.some((branch) => branch.name === current) && (
                <option value={current}>{current}</option>
              )}
            {branches.map((branch) => (
              <option key={branch.name} value={branch.name}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="link-button"
          disabled={!isIdle || !status.has_commits}
          onClick={() => setForm({ mode: 'create', name: '' })}
        >
          New branch
        </button>
        <button
          type="button"
          className="link-button"
          disabled={!isIdle || current === null}
          onClick={() => setForm({ mode: 'rename', name: current ?? '' })}
        >
          Rename the branch
        </button>
        <button
          type="button"
          className="link-button link-button--danger"
          disabled={!isIdle || others.length === 0}
          onClick={() => setForm({ mode: 'delete', name: others[0].name })}
        >
          Delete a branch
        </button>
      </div>
      {form && (
        <form className="git__row" onSubmit={(event) => void submit(event)}>
          {form.mode === 'delete' ? (
            <select
              aria-label="Branch to delete"
              autoFocus
              value={form.name}
              onChange={(event) =>
                setForm({ mode: 'delete', name: event.target.value })
              }
            >
              {others.map((branch) => (
                <option key={branch.name} value={branch.name}>
                  {branch.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="history__search"
              aria-label={FORM_LABELS[form.mode].field}
              placeholder={FORM_LABELS[form.mode].field}
              autoFocus
              value={form.name}
              onChange={(event) =>
                setForm({ mode: form.mode, name: event.target.value })
              }
            />
          )}
          <button
            type="submit"
            className="button button--small"
            disabled={!form.name.trim() || !isIdle}
          >
            {form.mode === 'delete' ? 'Delete' : FORM_LABELS[form.mode].submit}
          </button>
          <button
            type="button"
            className="link-button"
            onClick={() => setForm(null)}
          >
            Cancel
          </button>
        </form>
      )}
      <p className="git__upstream">
        {status.upstream
          ? `${status.upstream}: ${status.ahead} to push, ${status.behind} to pull`
          : 'The branch has no upstream. The first push sets it to origin.'}
      </p>
      {deletion && (
        <ConfirmDialog
          title={
            deletion.isForced
              ? 'Delete the branch and lose its commits?'
              : 'Delete the branch?'
          }
          message={
            deletion.isForced
              ? `The branch "${deletion.name}" has commits that are in no other branch. If you delete it, these commits are hard to get back.`
              : `This deletes the local branch "${deletion.name}". The branch on the remote does not change.`
          }
          confirmLabel={deletion.isForced ? 'Delete anyway' : 'Delete'}
          onConfirm={() => void confirmDeletion()}
          onCancel={() => setDeletion(null)}
        />
      )}
    </>
  )
}

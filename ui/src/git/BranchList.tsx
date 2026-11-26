import { useEffect, useState, type FormEvent, type RefObject } from 'react'
import { ConfirmDialog } from '../connections/ConfirmDialog'
import { relativeTime } from '../lib/relativeTime'
import { aheadBehind } from '../shell/menus'
import type { MenuItem } from '../shell/menu/menuModel'
import { StatusMark } from '../view/StatusMark'
import { useViewKeys, type KeyRow } from '../view/useViewKeys'
import { NoMatch } from '../view/ViewState'
import {
  branchGroups,
  type BranchForm,
  type BranchRow,
  type Repository,
} from './gitModel'
import { useGitStore } from './gitStore'

/** A branch that the user wants to delete. `isForced` is for the second question. */
type Deletion = { name: string; isForced: boolean }

type Props = {
  repository: Repository
  filter: string
  filterRef: RefObject<HTMLInputElement | null>
  focusRef: { current: () => void }
  onClearFilter: () => void
  form: BranchForm | null
  onForm: (form: BranchForm | null) => void
}

const FORM_LABELS = {
  create: { field: 'Name of the new branch', submit: 'Create' },
  rename: { field: 'New name of the branch', submit: 'Rename' },
}

function NameForm({
  form,
  onForm,
  onDone,
}: {
  form: BranchForm
  onForm: (form: BranchForm | null) => void
  onDone: () => void
}) {
  const busy = useGitStore((state) => state.busy)
  const labels = FORM_LABELS[form.mode]
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const name = form.name.trim()
    const git = useGitStore.getState()
    const isDone =
      form.mode === 'create'
        ? await git.createBranch(name)
        : await git.renameBranch(form.from, name)
    if (isDone) {
      onForm(null)
      onDone()
    }
  }
  return (
    <form className="git-form" onSubmit={(event) => void submit(event)}>
      <input
        className="view__filter"
        aria-label={labels.field}
        placeholder={labels.field}
        autoFocus
        value={form.name}
        onChange={(event) => onForm({ ...form, name: event.target.value })}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          onForm(null)
          onDone()
        }}
      />
      <button
        type="submit"
        className="button button--small"
        disabled={!form.name.trim() || busy !== null}
      >
        {labels.submit}
      </button>
      <button
        type="button"
        className="link-button"
        onClick={() => {
          onForm(null)
          onDone()
        }}
      >
        Cancel
      </button>
    </form>
  )
}

function branchLine(row: BranchRow, repository: Repository): string {
  if (row.isCurrent) {
    const { status } = repository
    const counts = aheadBehind(status.ahead, status.behind)
    if (!status.upstream) return 'current · no upstream'
    return counts ? `current · ${counts}` : 'current · in sync'
  }
  return row.lastCommit === null ? '' : relativeTime(row.lastCommit)
}

/**
 * The Branches mode of the Git view: the local and the remote branches. Enter
 * switches to a branch, F2 renames it, and Delete deletes it after a confirmation.
 */
export function BranchList({
  repository,
  filter,
  filterRef,
  focusRef,
  onClearFilter,
  form,
  onForm,
}: Props) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [deletion, setDeletion] = useState<Deletion | null>(null)
  const groups = branchGroups(repository, filter)
  const rows = groups.flatMap((group) => group.rows)
  const keyRows: KeyRow[] = rows.map((row) => ({
    key: row.key,
    label: row.name,
  }))
  const byKey = new Map(rows.map((row) => [row.key, row]))
  const git = useGitStore.getState
  const canSwitch = (row: BranchRow) => !row.isCurrent
  const canChange = (row: BranchRow) => !row.isRemote
  const canDelete = (row: BranchRow) => !row.isRemote && !row.isCurrent

  const switchTo = (row: BranchRow) => {
    if (canSwitch(row)) void git().switchBranch(row.target)
  }
  const rename = (row: BranchRow) => {
    if (canChange(row))
      onForm({ mode: 'rename', from: row.name, name: row.name })
  }
  const remove = (row: BranchRow) => {
    if (canDelete(row)) setDeletion({ name: row.name, isForced: false })
  }

  const contextItems = (key: string): MenuItem[] => {
    const row = byKey.get(key)
    if (!row) return []
    return [
      {
        kind: 'action',
        label: 'Switch to the branch',
        shortcut: 'Enter',
        disabled: !canSwitch(row),
        run: () => switchTo(row),
      },
      {
        kind: 'action',
        label: 'Rename…',
        shortcut: 'F2',
        disabled: !canChange(row),
        run: () => rename(row),
      },
      {
        kind: 'action',
        label: 'Delete…',
        shortcut: 'Delete',
        disabled: !canDelete(row),
        run: () => remove(row),
      },
      { kind: 'separator' },
      {
        kind: 'action',
        label: 'New branch…',
        disabled: !repository.status.has_commits,
        run: () => onForm({ mode: 'create', name: '' }),
      },
    ]
  }

  const withRow = (key: string, action: (row: BranchRow) => void) => {
    const row = byKey.get(key)
    if (row) action(row)
  }
  const keys = useViewKeys({
    kind: 'list',
    rows: keyRows,
    selectedKey,
    filterRef,
    onSelect: setSelectedKey,
    onOpen: (key) => withRow(key, switchTo),
    onRename: (key) => withRow(key, rename),
    onDelete: (key) => withRow(key, remove),
    onRefresh: () => void git().refresh(),
    contextItems,
  })
  useEffect(() => {
    focusRef.current = () => keys.focusRow()
  })

  const confirmDeletion = async () => {
    if (!deletion) return
    setDeletion(null)
    const result = await git().deleteBranch(deletion.name, deletion.isForced)
    if (result === 'not-merged') setDeletion({ ...deletion, isForced: true })
    if (result === 'deleted') keys.focusRow()
  }

  return (
    <>
      {form && (
        <NameForm form={form} onForm={onForm} onDone={() => keys.focusRow()} />
      )}
      {rows.length === 0 && (
        <NoMatch noun="branches" filter={filter} onClear={onClearFilter} />
      )}
      {rows.length > 0 && (
        <div role="listbox" aria-label="Branches" className="view-list">
          {groups.map((group) => (
            <div key={group.label} role="group" aria-label={group.label}>
              <div className="view-group" aria-hidden="true">
                <span>{group.label}</span>
                <span>{group.rows.length}</span>
              </div>
              {group.rows.map((row) => {
                const index = keyRows.findIndex((item) => item.key === row.key)
                const line = branchLine(row, repository)
                return (
                  <div
                    key={row.key}
                    {...keys.rowProps(keyRows[index], index)}
                    className="view-row"
                    aria-label={
                      row.isCurrent ? `${row.name}, current branch` : row.name
                    }
                    title={row.name}
                  >
                    {row.isCurrent ? (
                      <StatusMark status="ok" label="Current branch" />
                    ) : (
                      <span className="git-branch__space" aria-hidden="true" />
                    )}
                    <span className="view-row__label">{row.name}</span>
                    {line && <span className="view-row__muted">{line}</span>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
      {keys.contextMenu}
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

import { useEffect, useState, type RefObject } from 'react'
import type { FileStatus_Serialize as FileStatus } from '../bindings'
import { ConfirmDialog } from '../connections/ConfirmDialog'
import { Icon } from '../shell/icons'
import type { MenuItem } from '../shell/menu/menuModel'
import { useTabsStore } from '../tabs/tabsStore'
import { StatusMark } from '../view/StatusMark'
import { useViewKeys, type KeyRow } from '../view/useViewKeys'
import { EmptyState, NoMatch } from '../view/ViewState'
import { commitNow, showChange, toggleStage } from './gitActions'
import {
  GROUP_LABELS,
  baseName,
  changeGroups,
  changeKind,
  folderName,
  rowKey,
  type ChangeRow,
  type Repository,
} from './gitModel'
import { useGitStore } from './gitStore'

type Props = {
  repository: Repository
  filter: string
  filterRef: RefObject<HTMLInputElement | null>
  /** The view sets it, so the second Esc in the filter moves the focus to the list. */
  focusRef: { current: () => void }
  onClearFilter: () => void
  onAbortMerge: () => void
}

/** The key of the row whose detail the active tab shows. */
function useSelectedKey(): string | null {
  return useTabsStore((state) => {
    const detail = state.tabs.find((tab) => tab.id === state.activeId)?.detail
    if (detail?.kind === 'diff')
      return rowKey(detail.staged ? 'staged' : 'changes', detail.path)
    if (detail?.kind === 'conflict') return rowKey('conflicts', detail.path)
    return null
  })
}

function rowLabel(row: ChangeRow): string {
  const kind = changeKind(row).text
  if (row.group === 'conflicts') return `${row.file.path}, conflict`
  return `${row.file.path}, ${kind}, ${row.group === 'staged' ? 'staged' : 'not staged'}`
}

/** The merge state above the list, with "Abort the merge". */
function MergeNote({
  conflicts,
  onAbort,
}: {
  conflicts: number
  onAbort: () => void
}) {
  const busy = useGitStore((state) => state.busy)
  return (
    <div
      className={`view-state ${conflicts > 0 ? 'view-state--error' : ''} git-merge`}
      role={conflicts > 0 ? 'alert' : 'status'}
    >
      <p>{conflicts > 0 ? 'Merge conflict' : 'Merge in progress'}</p>
      <p className="view-state__detail">
        {conflicts > 0
          ? 'Open each file in the Conflicts group and resolve it. Then commit to complete the merge.'
          : 'All conflicts are resolved. Commit to complete the merge.'}
      </p>
      <button
        type="button"
        className="button button--small button--danger"
        disabled={busy !== null}
        onClick={onAbort}
      >
        Abort the merge
      </button>
    </div>
  )
}

/**
 * The Changes mode of the Git view: a list of the changed files in the groups
 * Conflicts, Staged, and Changes. Space stages or unstages a file. Enter opens its
 * diff. Ctrl+Enter commits.
 */
export function ChangesList({
  repository,
  filter,
  filterRef,
  focusRef,
  onClearFilter,
  onAbortMerge,
}: Props) {
  const selectedKey = useSelectedKey()
  const [discarding, setDiscarding] = useState<FileStatus | null>(null)
  const { files } = repository.status
  const groups = changeGroups(files, filter)
  const rows = groups.flatMap((group) => group.rows)
  const keyRows: KeyRow[] = rows.map((row) => ({
    key: row.key,
    label: baseName(row.file.path),
  }))
  const byKey = new Map(rows.map((row) => [row.key, row]))
  const withRow = (key: string, action: (row: ChangeRow) => void) => {
    const row = byKey.get(key)
    if (row) action(row)
  }

  const toggle = (row: ChangeRow) => {
    if (row.group === 'conflicts') return
    const target = rowKey(
      row.group === 'staged' ? 'changes' : 'staged',
      row.file.path,
    )
    // The row moves to the other group. The focus goes with it.
    void toggleStage(row).then(() => keys.focusRow(target))
  }

  const contextItems = (key: string): MenuItem[] => {
    const row = byKey.get(key)
    if (!row) return []
    if (row.group === 'conflicts') {
      return [
        {
          kind: 'action',
          label: 'Resolve the conflict',
          shortcut: 'Enter',
          run: () => showChange(row, true),
        },
      ]
    }
    return [
      {
        kind: 'action',
        label: 'Open the diff',
        shortcut: 'Enter',
        run: () => showChange(row, true),
      },
      {
        kind: 'action',
        label: row.group === 'staged' ? 'Unstage' : 'Stage',
        shortcut: 'Space',
        run: () => toggle(row),
      },
      {
        kind: 'action',
        label: 'Discard the changes…',
        shortcut: 'Delete',
        disabled: row.group !== 'changes',
        run: () => setDiscarding(row.file),
      },
      { kind: 'separator' },
      {
        kind: 'action',
        label: 'Commit',
        shortcut: 'Ctrl+Enter',
        run: () => void commitNow(),
      },
    ]
  }

  const keys = useViewKeys({
    kind: 'list',
    rows: keyRows,
    selectedKey,
    filterRef,
    onSelect: (key) => withRow(key, (row) => showChange(row, false)),
    onCheck: (key) => withRow(key, toggle),
    onOpen: (key) => withRow(key, (row) => showChange(row, true)),
    onSecondary: () => void commitNow(),
    onDelete: (key) =>
      withRow(key, (row) => row.group === 'changes' && setDiscarding(row.file)),
    onRefresh: () => void useGitStore.getState().refresh(),
    onEscape: () => useTabsStore.getState().closePreview(),
    contextItems,
  })
  useEffect(() => {
    focusRef.current = () => keys.focusRow()
  })

  const isMerging = repository.merge_message !== null
  const conflicts = files.filter((file) => file.is_conflicted).length

  return (
    <>
      {isMerging && <MergeNote conflicts={conflicts} onAbort={onAbortMerge} />}
      {files.length === 0 && (
        <EmptyState text="No changes in the working tree." />
      )}
      {files.length > 0 && rows.length === 0 && (
        <NoMatch noun="changed files" filter={filter} onClear={onClearFilter} />
      )}
      {rows.length > 0 && (
        <div role="listbox" aria-label="Changed files" className="view-list">
          {groups.map((group) => (
            <div
              key={group.group}
              role="group"
              aria-label={GROUP_LABELS[group.group]}
            >
              <div className="view-group" aria-hidden="true">
                <span>{GROUP_LABELS[group.group]}</span>
                <span>{group.rows.length}</span>
              </div>
              {group.rows.map((row) => {
                const index = keyRows.findIndex((item) => item.key === row.key)
                const kind = changeKind(row)
                return (
                  <div
                    key={row.key}
                    {...keys.rowProps(keyRows[index], index)}
                    className="view-row git-change"
                    aria-label={rowLabel(row)}
                    title={row.file.path}
                  >
                    {row.group === 'conflicts' ? (
                      <StatusMark status="error" label="Conflict" />
                    ) : (
                      // The check box is part of the option. Space and a click on
                      // it stage or unstage the file.
                      <span
                        className="git-check"
                        data-checked={row.group === 'staged'}
                        aria-hidden="true"
                        onClick={(event) => {
                          event.stopPropagation()
                          toggle(row)
                        }}
                      >
                        {row.group === 'staged' && (
                          <Icon name="check" size={12} />
                        )}
                      </span>
                    )}
                    <span
                      className={`git-kind git-kind--${kind.text.replace(' ', '-')}`}
                      aria-hidden="true"
                    >
                      {kind.letter}
                    </span>
                    <span className="view-row__label">
                      {baseName(row.file.path)}
                    </span>
                    <span className="view-row__muted git-change__folder">
                      {folderName(row.file.path)}
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
      {keys.contextMenu}
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
            void useGitStore.getState().discard(discarding)
            setDiscarding(null)
          }}
          onCancel={() => setDiscarding(null)}
        />
      )}
    </>
  )
}

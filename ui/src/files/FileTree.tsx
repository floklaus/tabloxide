import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { commands } from '../bindings'
import { toMessage } from '../lib/errors'
import { Icon } from '../shell/icons'
import type { MenuItem } from '../shell/menu/menuModel'
import { useTabsStore } from '../tabs/tabsStore'
import { SideView } from '../view/SideView'
import { useViewKeys, type KeyRow } from '../view/useViewKeys'
import { EmptyState, Loading, NoMatch, ViewError } from '../view/ViewState'
import { useWorkspaceChangeStore } from '../workspace/watch'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import {
  buildFileRows,
  fileStatus,
  ROOT,
  type FileRow,
  type Listing,
} from './fileModel'

const INDENT_PX = 16

type EntryRow = Extract<FileRow, { type: 'entry' }>

async function list(directory: string): Promise<Listing> {
  try {
    const result = await commands.fileList(directory)
    return result.status === 'ok'
      ? { status: 'loaded', entries: result.data }
      : { status: 'failed', message: result.error.message }
  } catch (error) {
    return { status: 'failed', message: toMessage(error) }
  }
}

function copyPath(path: string): void {
  void navigator.clipboard.writeText(path).catch(() => {})
}

function RowContent({
  row,
  onToggle,
}: {
  row: FileRow
  /** Opens or closes the folder. A click on the chevron does only this. */
  onToggle: () => void
}) {
  if (row.type === 'note') {
    return (
      // A tree can contain only tree items. The error also shows at the top of the body.
      <span
        className={
          row.isError ? 'schema__note schema__note--error' : 'schema__note'
        }
      >
        {row.text}
      </span>
    )
  }
  const { entry } = row
  return (
    <>
      {entry.is_directory ? (
        <span
          className="view-row__chevron"
          aria-hidden="true"
          onClick={(event) => {
            event.stopPropagation()
            onToggle()
          }}
        >
          <Icon name={row.isOpen ? 'chevron' : 'chevron-right'} size={16} />
        </span>
      ) : (
        <span className="files__spacer" aria-hidden="true" />
      )}
      <Icon name={entry.is_directory ? 'folder' : 'files'} size={16} />
      <span className="view-row__label" title={entry.path}>
        {entry.name}
      </span>
    </>
  )
}

/**
 * The Files view after the view standards: the files of the workspace as a tree.
 * The tree loads a folder only when the user opens it.
 */
export function FileTree() {
  const [listings, setListings] = useState<Record<string, Listing>>({})
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set([ROOT]))
  const [filter, setFilter] = useState('')
  const filterRef = useRef<HTMLInputElement>(null)
  const workspaceName = useWorkspaceStore(
    (state) => state.workspace?.name ?? '',
  )
  const openFile = useTabsStore((state) => state.openFile)
  const activePath = useTabsStore(
    (state) => state.tabs.find((tab) => tab.id === state.activeId)?.path,
  )

  // A folder without a listing shows as "Loading…".
  const load = useCallback(async (directory: string) => {
    const listing = await list(directory)
    setListings((current) => ({ ...current, [directory]: listing }))
  }, [])

  useEffect(() => {
    let isActive = true
    void list(ROOT).then((listing) => {
      if (isActive) setListings((current) => ({ ...current, [ROOT]: listing }))
    })
    return () => {
      isActive = false
    }
  }, [])

  const expandedRef = useRef(expanded)
  useEffect(() => {
    expandedRef.current = expanded
  }, [expanded])
  const refresh = useCallback(() => {
    for (const directory of expandedRef.current) void load(directory)
  }, [load])
  // A different program changed files. Read the open folders again.
  const changeCount = useWorkspaceChangeStore((state) => state.count)
  useEffect(() => {
    if (changeCount > 0) refresh()
  }, [changeCount, refresh])

  const toggle = (directory: string) => {
    const next = new Set(expanded)
    if (!next.delete(directory)) {
      next.add(directory)
      void load(directory)
    }
    setExpanded(next)
  }

  const rows = useMemo(
    () => buildFileRows({ listings, expanded, filter }),
    [listings, expanded, filter],
  )
  const keyRows: KeyRow[] = useMemo(
    () =>
      rows.flatMap((row) =>
        row.type === 'entry'
          ? [
              {
                key: row.key,
                label: row.entry.name,
                level: row.level,
                isExpandable: row.entry.is_directory,
                isExpanded: row.isOpen,
                parentKey: row.parentKey,
              },
            ]
          : [],
      ),
    [rows],
  )
  const byKey = new Map<string, EntryRow>()
  for (const row of rows) if (row.type === 'entry') byKey.set(row.key, row)

  /** A folder opens or closes. A file opens in a tab, or its tab shows. */
  const activate = (key: string) => {
    const row = byKey.get(key)
    if (!row) return
    if (row.entry.is_directory) toggle(key)
    else void openFile(key)
  }

  const itemsOf = (key: string): MenuItem[] => {
    const row = byKey.get(key)
    if (!row) return []
    const first: MenuItem = row.entry.is_directory
      ? {
          kind: 'action',
          label: row.isOpen ? 'Close the folder' : 'Open the folder',
          shortcut: row.isOpen ? 'Left' : 'Right',
          run: () => toggle(key),
        }
      : {
          kind: 'action',
          label: 'Open the file',
          shortcut: 'Enter',
          run: () => void openFile(key),
        }
    return [
      first,
      { kind: 'action', label: 'Copy the path', run: () => copyPath(key) },
    ]
  }

  const keys = useViewKeys({
    kind: 'tree',
    rows: keyRows,
    selectedKey: activePath ?? null,
    filterRef,
    onToggle: (key, expand) => {
      const row = byKey.get(key)
      if (row?.entry.is_directory && expanded.has(key) !== expand) toggle(key)
    },
    // Tabloxide has no preview tab for a file. Space and a click open the file in
    // a tab, as Enter does. The focus stays in the view.
    onSelect: activate,
    onOpen: activate,
    onRefresh: refresh,
    onEscape: () => useTabsStore.getState().closePreview(),
    contextItems: itemsOf,
  })

  const root = listings[ROOT]
  const body = () => {
    if (!root || root.status === 'loading') {
      return <Loading text="Reading the files of the workspace…" />
    }
    if (root.status === 'failed') {
      return (
        <ViewError
          title="Cannot read the workspace folder."
          detail={root.message}
          onRetry={() => void load(ROOT)}
        />
      )
    }
    if (root.entries.length === 0) {
      return (
        <EmptyState
          text="The workspace folder is empty."
          action={{ label: 'Read the files again', run: refresh }}
        />
      )
    }
    if (keyRows.length === 0) {
      return (
        <NoMatch noun="files" filter={filter} onClear={() => setFilter('')} />
      )
    }
    const failed = [...expanded].find(
      (directory) =>
        directory !== ROOT && listings[directory]?.status === 'failed',
    )
    const failure = failed === undefined ? undefined : listings[failed]
    return (
      <>
        {failed !== undefined && failure?.status === 'failed' && (
          <ViewError
            title={`Cannot read the folder ${failed}.`}
            detail={failure.message}
            onRetry={() => void load(failed)}
          />
        )}
        <div
          role="tree"
          aria-label={`Files of ${workspaceName || 'the workspace'}`}
          className="view-list"
        >
          {rows.map((row) => {
            const index = keyRows.findIndex((keyRow) => keyRow.key === row.key)
            const props =
              index >= 0
                ? keys.rowProps(keyRows[index], index)
                : { role: 'none' }
            return (
              <div
                key={row.key}
                {...props}
                className="view-row"
                style={{ paddingLeft: `${6 + (row.level - 1) * INDENT_PX}px` }}
              >
                <RowContent row={row} onToggle={() => toggle(row.key)} />
              </div>
            )
          })}
        </div>
      </>
    )
  }

  const hasEntries = root?.status === 'loaded' && root.entries.length > 0
  return (
    <SideView
      title="Files"
      scope={
        workspaceName
          ? { text: workspaceName, label: `Workspace ${workspaceName}` }
          : undefined
      }
      primary={{
        icon: 'refresh',
        label: 'Read the files again',
        shortcut: 'F5',
        run: refresh,
      }}
      overflow={() => [
        {
          kind: 'action',
          label: 'Read the files again',
          shortcut: 'F5',
          run: refresh,
        },
        {
          kind: 'action',
          label: 'Close all folders',
          disabled: expanded.size <= 1,
          run: () => setExpanded(new Set([ROOT])),
        },
      ]}
      filter={
        hasEntries
          ? {
              value: filter,
              onChange: setFilter,
              label: 'Filter the files',
              placeholder: 'Filter  /',
              inputRef: filterRef,
              onLeave: () => keys.focusRow(),
            }
          : undefined
      }
      status={hasEntries ? fileStatus(rows) : null}
    >
      {body()}
      {keys.contextMenu}
    </SideView>
  )
}

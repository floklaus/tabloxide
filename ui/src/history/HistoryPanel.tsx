import { useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '../connections/ConfirmDialog'
import { Icon } from '../shell/icons'
import { MenuButton } from '../shell/menu/MenuButton'
import { useTabsStore } from '../tabs/tabsStore'
import { SideView } from '../view/SideView'
import { StatusMark } from '../view/StatusMark'
import { useViewKeys, type KeyRow } from '../view/useViewKeys'
import { EmptyState, NoMatch, ViewError } from '../view/ViewState'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import {
  HISTORY_STATUS,
  showEntry,
  durationText,
  groupByDay,
  hasText,
  openInTab,
  runAgain,
  timeText,
  useHistoryStore,
  visibleEntries,
  type HistoryEntry,
  type ResultFilter,
} from './historyStore'

/** Time without a key press before the search starts. */
const SEARCH_DELAY_MS = 250

const RESULT_LABELS: Record<ResultFilter, string> = {
  all: 'All results',
  ok: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

/** The first line of the statement, for the row. */
function firstLine(sql: string): string {
  return sql.trim().split('\n')[0] ?? ''
}

type Props = {
  /** Shows the results pane after a run starts from the history. */
  onRun: () => void
}

/**
 * The History view after the view standards: the statements that ran, in groups by
 * day, with the status of each run.
 */
export function HistoryPanel({ onRun }: Props) {
  const query = useHistoryStore((state) => state.query)
  const connectionId = useHistoryStore((state) => state.connectionId)
  const results = useHistoryStore((state) => state.results)
  const allEntries = useHistoryStore((state) => state.entries)
  const error = useHistoryStore((state) => state.error)
  const connections = useWorkspaceStore((state) => state.workspace?.connections)
  const selectedKey = useTabsStore((state) => {
    const detail = state.tabs.find((tab) => tab.id === state.activeId)?.detail
    return detail?.kind === 'history' ? String(detail.id) : null
  })
  const [isConfirming, setIsConfirming] = useState(false)
  const filterRef = useRef<HTMLInputElement>(null)
  const store = useHistoryStore.getState

  useEffect(() => {
    const timer = setTimeout(() => void store().search(), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [query, store])

  const entries = visibleEntries({
    ...store(),
    entries: allEntries,
    connectionId,
    results,
  })
  const groups = groupByDay(entries)
  const keyRows: KeyRow[] = entries.map((entry) => ({
    key: String(entry.id),
    label: firstLine(entry.sql),
  }))
  const byKey = new Map(entries.map((entry) => [String(entry.id), entry]))
  const withEntry = (key: string, action: (entry: HistoryEntry) => void) => {
    const entry = byKey.get(key)
    if (entry) action(entry)
  }
  const keys = useViewKeys({
    kind: 'list',
    rows: keyRows,
    selectedKey,
    filterRef,
    onSelect: (key) => withEntry(key, (entry) => showEntry(entry, false)),
    onOpen: (key) =>
      withEntry(key, (entry) => hasText(entry) && openInTab(entry)),
    onSecondary: (key) =>
      withEntry(key, (entry) => {
        if (!hasText(entry)) return
        runAgain(entry)
        onRun()
      }),
    onRefresh: () => void store().search(),
    onEscape: () => useTabsStore.getState().closePreview(),
    contextItems: (key) => {
      const entry = byKey.get(key)
      if (!entry || !hasText(entry)) return []
      return [
        {
          kind: 'action',
          label: 'Open in a new tab',
          shortcut: 'Enter',
          run: () => openInTab(entry),
        },
        {
          kind: 'action',
          label: 'Run again',
          shortcut: 'Ctrl+Enter',
          run: () => {
            runAgain(entry)
            onRun()
          },
        },
        {
          kind: 'action',
          label: 'Copy the statement',
          run: () =>
            void navigator.clipboard.writeText(entry.sql).catch(() => {}),
        },
      ]
    },
  })

  const scopeName =
    connectionId === null
      ? 'All connections'
      : (connections?.find((item) => item.id === connectionId)?.name ??
        'One connection')
  const isFiltered =
    query.trim() !== '' || connectionId !== null || results !== 'all'

  return (
    <SideView
      title="History"
      scope={{
        text: scopeName,
        label: `Scope: ${scopeName.toLowerCase()}. Change the scope`,
        items: () => [
          {
            kind: 'radio',
            label: 'All connections',
            checked: connectionId === null,
            run: () => store().setConnection(null),
          },
          ...(connections ?? []).map((item) => ({
            kind: 'radio' as const,
            label: item.name,
            checked: item.id === connectionId,
            run: () => store().setConnection(item.id),
          })),
        ],
      }}
      overflow={() => [
        {
          kind: 'action',
          label: 'Read the history again',
          shortcut: 'F5',
          run: () => void store().search(),
        },
        { kind: 'separator' },
        {
          kind: 'action',
          label: 'Clear the history…',
          disabled: allEntries.length === 0,
          run: () => setIsConfirming(true),
        },
      ]}
      filter={{
        value: query,
        onChange: (value) => store().setQuery(value),
        label: 'Search the history',
        placeholder: 'Search  /',
        inputRef: filterRef,
        onLeave: () => keys.focusRow(),
        extra: (
          <MenuButton
            label={`Show: ${RESULT_LABELS[results].toLowerCase()}`}
            menuLabel="Results to show"
            className="view__scope history__results"
            items={() =>
              (Object.keys(RESULT_LABELS) as ResultFilter[]).map((value) => ({
                kind: 'radio',
                label: RESULT_LABELS[value],
                checked: value === results,
                run: () => store().setResults(value),
              }))
            }
          >
            <span className="view__scope-text">
              {results === 'all' ? 'All' : RESULT_LABELS[results]}
            </span>
            <Icon name="chevron" size={14} />
          </MenuButton>
        ),
      }}
      status={`${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`}
    >
      {error && (
        <ViewError
          title="Cannot read the history."
          detail={error}
          onRetry={() => void store().search()}
        />
      )}
      {!error && allEntries.length === 0 && !query && (
        <EmptyState text="The history is empty. The text of each statement that you run goes here." />
      )}
      {entries.length === 0 &&
        isFiltered &&
        (allEntries.length > 0 || query) && (
          <NoMatch
            noun="entries"
            filter={query || scopeName}
            onClear={() => {
              store().setQuery('')
              store().setConnection(null)
              store().setResults('all')
            }}
          />
        )}
      {entries.length > 0 && (
        <div role="listbox" aria-label="Query history" className="view-list">
          {groups.map((group) => (
            <div key={group.day} role="group" aria-label={group.day}>
              <div className="view-group" aria-hidden="true">
                <span>{group.day}</span>
                <span>{group.entries.length}</span>
              </div>
              {group.entries.map((entry) => {
                const key = String(entry.id)
                const index = keyRows.findIndex((row) => row.key === key)
                const state = HISTORY_STATUS[entry.status]
                return (
                  <div
                    key={key}
                    {...keys.rowProps(keyRows[index], index)}
                    className="view-row view-row--two"
                    aria-label={`${firstLine(entry.sql)}, ${state.label}`}
                  >
                    <StatusMark status={state.status} label={state.label} />
                    <span className="view-row__lines">
                      <span className="view-row__label history__sql-line">
                        {firstLine(entry.sql)}
                      </span>
                      <span className="view-row__line">
                        {[
                          entry.connection_name,
                          timeText(entry.executed_at_secs),
                          durationText(entry),
                          entry.rows === null ? null : `${entry.rows} rows`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
      {keys.contextMenu}
      {isConfirming && (
        <ConfirmDialog
          title="Clear the history?"
          message="This deletes all history entries of this workspace. You cannot undo this."
          confirmLabel="Clear history"
          onConfirm={() => {
            setIsConfirming(false)
            void store().clear()
          }}
          onCancel={() => setIsConfirming(false)}
        />
      )}
    </SideView>
  )
}

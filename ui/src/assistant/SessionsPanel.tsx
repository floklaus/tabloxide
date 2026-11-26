import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { MenuItem } from '../shell/menu/menuModel'
import { useShellStore } from '../shell/shellStore'
import { useTabsStore } from '../tabs/tabsStore'
import { SideView } from '../view/SideView'
import { StatusMark } from '../view/StatusMark'
import { useViewKeys, type KeyRow } from '../view/useViewKeys'
import { EmptyState, NoMatch } from '../view/ViewState'
import { labelOf, useAssistantStore, type SessionEntry } from './assistantStore'
import {
  DEFAULT_TITLE,
  LABEL_STATUS,
  LABEL_TEXT,
  sessionDetail,
} from './sessionLabels'
import { useRunningSessions, useSessionTitles } from './useSessions'

/** The time between two updates of the relative times. */
const CLOCK_MS = 30_000

type RowProps = ReturnType<ReturnType<typeof useViewKeys>['rowProps']>

function newSession(): void {
  const id = useAssistantStore.getState().newSession()
  useAssistantStore.getState().openInTab(id)
}

/** Shows the session in the assistant panel and opens its tab. */
function openSession(id: string): void {
  useAssistantStore.getState().select(id)
  useAssistantStore.getState().openInTab(id)
}

/** Shows the session in the assistant panel. The panel opens if it is closed. */
function showInPanel(id: string): void {
  useAssistantStore.getState().select(id)
  const shell = useShellStore.getState()
  if (!shell.panels.assistant) shell.togglePanel('assistant')
}

function SessionRow({
  entry,
  now,
  rowProps,
}: {
  entry: SessionEntry
  now: number
  rowProps: RowProps
}) {
  const state = useStore(entry.store)
  const label = labelOf(state)
  const title = state.title ?? DEFAULT_TITLE
  return (
    <div
      {...rowProps}
      className="view-row view-row--two"
      aria-label={`${title}, ${LABEL_TEXT[label]}`}
    >
      <StatusMark status={LABEL_STATUS[label]} label={LABEL_TEXT[label]} />
      <span className="view-row__lines">
        <span className="view-row__label" title={title}>
          {title}
        </span>
        <span
          className={`view-row__line ${
            label === 'failed' ? 'view-row__line--error' : ''
          }`}
        >
          {sessionDetail(state, now)}
        </span>
      </span>
    </div>
  )
}

/**
 * The sessions view after the view standards: the assistant sessions, the newest
 * first, each with its state.
 */
export function SessionsPanel() {
  const sessions = useAssistantStore((state) => state.sessions)
  const activeId = useAssistantStore((state) => state.activeId)
  const titles = useSessionTitles()
  const running = useRunningSessions()
  const [now, setNow] = useState(() => Date.now())
  const [filter, setFilter] = useState('')
  const filterRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS)
    return () => clearInterval(timer)
  }, [])

  const text = filter.trim().toLowerCase()
  const visible = sessions
    .map((entry, index) => ({ entry, title: titles[index] || DEFAULT_TITLE }))
    .filter(({ title }) => title.toLowerCase().includes(text))
    .reverse()
  const keyRows: KeyRow[] = visible.map(({ entry, title }) => ({
    key: entry.id,
    label: title,
  }))

  const itemsOf = (key: string): MenuItem[] => {
    const entry = sessions.find((item) => item.id === key)
    if (!entry) return []
    const isRunning = entry.store.getState().status !== 'idle'
    return [
      {
        kind: 'action',
        label: 'Open in a tab',
        shortcut: 'Enter',
        run: () => openSession(key),
      },
      {
        kind: 'action',
        label: 'Show in the assistant panel',
        shortcut: 'Ctrl+Enter',
        run: () => showInPanel(key),
      },
      { kind: 'separator' },
      {
        kind: 'action',
        label: 'Stop the request',
        disabled: !isRunning,
        run: () => void entry.store.getState().stop(),
      },
    ]
  }

  const keys = useViewKeys({
    kind: 'list',
    rows: keyRows,
    selectedKey: activeId,
    filterRef,
    // A session has no preview tab. Space and a click open its tab, as Enter does.
    onSelect: openSession,
    onOpen: openSession,
    onSecondary: showInPanel,
    onEscape: () => useTabsStore.getState().closePreview(),
    contextItems: itemsOf,
  })

  const count = `${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}`

  return (
    <SideView
      title="Sessions"
      primary={{ icon: 'plus', label: 'New session', run: newSession }}
      overflow={() => [
        { kind: 'action', label: 'New session', run: newSession },
        {
          kind: 'action',
          label: 'Show the assistant panel',
          run: () => showInPanel(activeId),
        },
      ]}
      filter={
        sessions.length > 0
          ? {
              value: filter,
              onChange: setFilter,
              label: 'Filter the sessions',
              placeholder: 'Filter  /',
              inputRef: filterRef,
              onLeave: () => keys.focusRow(),
            }
          : undefined
      }
      status={sessions.length > 0 ? `${count} · ${running} running` : null}
    >
      {sessions.length === 0 && (
        <EmptyState
          text="No assistant session is open."
          action={{ label: 'New session', run: newSession }}
        />
      )}
      {sessions.length > 0 && visible.length === 0 && (
        <NoMatch
          noun="sessions"
          filter={filter}
          onClear={() => setFilter('')}
        />
      )}
      {visible.length > 0 && (
        <div
          role="listbox"
          aria-label="Assistant sessions"
          className="view-list"
        >
          {visible.map(({ entry }, index) => (
            <SessionRow
              key={entry.id}
              entry={entry}
              now={now}
              rowProps={keys.rowProps(keyRows[index], index)}
            />
          ))}
        </div>
      )}
      {keys.contextMenu}
    </SideView>
  )
}

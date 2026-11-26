import { useMemo, useRef, useState } from 'react'
import { newConnection, switchConnection } from '../shell/commands'
import { Icon } from '../shell/icons'
import { useShellStore } from '../shell/shellStore'
import { useTabsStore } from '../tabs/tabsStore'
import { SideView } from '../view/SideView'
import { StatusMark } from '../view/StatusMark'
import { useViewKeys, type KeyRow } from '../view/useViewKeys'
import { EmptyState, NoMatch } from '../view/ViewState'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { ConfirmDialog } from './ConfirmDialog'
import { connectionItems, showConnection } from './connectionActions'
import { connectionStatus, groupConnections } from './connectionModel'
import { useConnectionStore } from './connectionStore'
import type { ConnectionProfile } from './formModel'

// A stable value. A new array on each call makes the store selector loop.
const NO_CONNECTIONS: ConnectionProfile[] = []

/**
 * The Connections view after the view standards: the connections of the workspace
 * in groups by environment, each with the status of its last test.
 */
export function ConnectionList() {
  const connections = useWorkspaceStore(
    (state) => state.workspace?.connections ?? NO_CONNECTIONS,
  )
  const workspaceName = useWorkspaceStore(
    (state) => state.workspace?.name ?? '',
  )
  const tests = useConnectionStore((state) => state.tests)
  const selectedKey = useTabsStore((state) => {
    const detail = state.tabs.find((tab) => tab.id === state.activeId)?.detail
    return detail?.kind === 'connection' ? detail.id : null
  })
  const [filter, setFilter] = useState('')
  const [deleting, setDeleting] = useState<ConnectionProfile | null>(null)
  const filterRef = useRef<HTMLInputElement>(null)

  const groups = useMemo(
    () => groupConnections(connections, filter),
    [connections, filter],
  )
  const visible = groups.flatMap((group) => group.connections)
  const keyRows: KeyRow[] = visible.map((profile) => ({
    key: profile.id,
    label: profile.name,
  }))
  const byId = new Map(visible.map((profile) => [profile.id, profile]))
  const withProfile = (
    key: string,
    action: (profile: ConnectionProfile) => void,
  ) => {
    const profile = byId.get(key)
    if (profile) action(profile)
  }

  const keys = useViewKeys({
    kind: 'list',
    rows: keyRows,
    selectedKey,
    filterRef,
    onSelect: (key) =>
      withProfile(key, (profile) => showConnection(profile, false)),
    // Enter connects the current tab to the connection.
    onOpen: (key) =>
      withProfile(key, (profile) => switchConnection(profile.id)),
    onSecondary: (key) =>
      withProfile(
        key,
        (profile) => void useConnectionStore.getState().test(profile),
      ),
    onRename: (key) =>
      withProfile(key, (profile) =>
        useShellStore.getState().editConnection({ profile, isNew: false }),
      ),
    onDelete: (key) => withProfile(key, setDeleting),
    onEscape: () => useTabsStore.getState().closePreview(),
    contextItems: (key) => {
      const profile = byId.get(key)
      return profile ? connectionItems(profile, setDeleting) : []
    },
  })

  const connected = connections.filter(
    (profile) => tests[profile.id]?.status === 'connected',
  )
  const count = `${connections.length} ${connections.length === 1 ? 'connection' : 'connections'}`

  return (
    <SideView
      title="Connections"
      scope={{ text: workspaceName, label: `Workspace ${workspaceName}` }}
      primary={{
        icon: 'plus',
        label: 'New connection',
        shortcut: 'Ctrl+Shift+N',
        run: () => void newConnection(),
      }}
      overflow={() => [
        {
          kind: 'action',
          label: 'New connection…',
          run: () => void newConnection(),
        },
        {
          kind: 'action',
          label: 'Test all connections',
          disabled: connections.length === 0,
          run: () => {
            for (const profile of connections)
              void useConnectionStore.getState().test(profile)
          },
        },
      ]}
      filter={
        connections.length > 0
          ? {
              value: filter,
              onChange: setFilter,
              label: 'Filter the connections',
              placeholder: 'Filter  /',
              inputRef: filterRef,
              onLeave: () => keys.focusRow(),
            }
          : undefined
      }
      status={
        connections.length > 0
          ? `${count} · ${connected.length} connected`
          : null
      }
    >
      {connections.length === 0 && (
        <EmptyState
          text="This workspace has no connections."
          action={{ label: 'New connection', run: () => void newConnection() }}
        />
      )}
      {connections.length > 0 && visible.length === 0 && (
        <NoMatch
          noun="connections"
          filter={filter}
          onClear={() => setFilter('')}
        />
      )}
      {visible.length > 0 && (
        <div
          role="listbox"
          aria-label={`Connections of ${workspaceName}`}
          className="view-list"
        >
          {groups.map((group) => (
            <div key={group.environment} role="group" aria-label={group.label}>
              <div className="view-group" aria-hidden="true">
                <span className={`badge badge--${group.environment}`}>
                  {group.label}
                </span>
                <span>{group.connections.length}</span>
              </div>
              {group.connections.map((profile) => {
                const index = keyRows.findIndex((row) => row.key === profile.id)
                const state = connectionStatus(profile, tests[profile.id])
                return (
                  <div key={profile.id} role="none" className="view-row-wrap">
                    <div
                      {...keys.rowProps(keyRows[index], index)}
                      className="view-row view-row--two"
                      aria-label={`${profile.name}, ${state.label}`}
                    >
                      <StatusMark status={state.status} label={state.label} />
                      <span className="view-row__lines">
                        <span className="view-row__label">{profile.name}</span>
                        <span
                          className={`view-row__line ${
                            state.status === 'error'
                              ? 'view-row__line--error'
                              : ''
                          }`}
                        >
                          {state.line}
                        </span>
                      </span>
                    </div>
                    {/* An option cannot contain buttons. These buttons are for the
                        pointer only. The keys and the context menu have the same
                        actions: Ctrl+Enter tests, and F2 edits. */}
                    <span className="view-row__actions" aria-hidden="true">
                      <button
                        type="button"
                        className="view__icon-button"
                        aria-label={`Test ${profile.name}`}
                        title="Test (Ctrl+Enter)"
                        tabIndex={-1}
                        disabled={state.status === 'busy'}
                        onClick={() =>
                          void useConnectionStore.getState().test(profile)
                        }
                      >
                        <Icon name="play" size={14} />
                      </button>
                      <button
                        type="button"
                        className="view__icon-button"
                        aria-label={`Edit ${profile.name}`}
                        title="Edit (F2)"
                        tabIndex={-1}
                        onClick={() =>
                          useShellStore
                            .getState()
                            .editConnection({ profile, isNew: false })
                        }
                      >
                        <Icon name="pencil" size={14} />
                      </button>
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
      {keys.contextMenu}
      {deleting && (
        <ConfirmDialog
          title="Delete connection"
          message={`Delete the connection "${deleting.name}"? This also removes its stored password.`}
          confirmLabel="Delete"
          onConfirm={() => {
            void useConnectionStore.getState().remove(deleting.id)
            setDeleting(null)
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </SideView>
  )
}

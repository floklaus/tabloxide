import { useState, type KeyboardEvent } from 'react'
import { useGitStore } from '../git/gitStore'
import { useQuery } from '../query/queryStore'
import { useTabsStore } from '../tabs/tabsStore'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { newConnection, switchConnection } from './commands'
import { Icon } from './icons'
import { MenuButton } from './menu/MenuButton'
import { tidy, type MenuItem } from './menu/menuModel'
import { branchItems, connectionItems, recentItems } from './menus'
import { useShellStore } from './shellStore'

const separator: MenuItem = { kind: 'separator' }
const NO_CONNECTIONS: never[] = []

function action(label: string, run: () => void, shortcut?: string): MenuItem {
  return { kind: 'action', label, run, shortcut }
}

/** Moves the focus from the search field to the first item of the menu. */
function focusFirstItem(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key !== 'ArrowDown') return
  event.preventDefault()
  const popup = event.currentTarget.closest('.menu-popup')
  popup
    ?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled])')
    ?.focus()
}

/** The workspace, with the recent workspaces and the workspace actions. */
export function ProjectWidget() {
  const name = useWorkspaceStore((state) => state.workspace?.name ?? '')
  return (
    <MenuButton
      label={`Project: ${name}`}
      menuLabel="Project"
      className="title-widget--project"
      items={() => {
        const recent = recentItems()
        const workspace = useWorkspaceStore.getState()
        return tidy([
          ...(recent.length > 0
            ? [
                { kind: 'heading', label: 'Recent workspaces' } as MenuItem,
                ...recent,
              ]
            : []),
          separator,
          action('Open folder…', () => void workspace.openFolder()),
          action('Clone a repository…', () =>
            useShellStore.getState().openDialog('clone'),
          ),
          action('Close workspace', () => void workspace.close()),
        ])
      }}
    >
      <span className="title-widget__text">{name}</span>
      <Icon name="chevron" size={14} />
    </MenuButton>
  )
}

/** The connection of the active tab. The menu switches the connection. */
export function ConnectionWidget() {
  const connections = useWorkspaceStore(
    (state) => state.workspace?.connections ?? NO_CONNECTIONS,
  )
  const connectionId = useTabsStore(
    (state) =>
      state.tabs.find((tab) => tab.id === state.activeId)?.connectionId,
  )
  const hasSession = useQuery((state) => state.session !== null)
  const [filter, setFilter] = useState('')
  const active = connections.find(
    (connection) => connection.id === connectionId,
  )
  const label = active
    ? `Connection: ${active.name}, ${active.environment}`
    : 'Connection: none'

  return (
    <MenuButton
      label={label}
      menuLabel="Connection"
      className="title-widget--connection"
      header={() => (
        <div className="menu-popup__search">
          <input
            type="search"
            aria-label="Find a connection"
            placeholder="Find a connection"
            autoFocus
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={focusFirstItem}
          />
        </div>
      )}
      items={() => {
        const shell = useShellStore.getState()
        const found = connectionItems(filter)
        return tidy([
          ...(found.length > 0
            ? found
            : [
                {
                  kind: 'heading',
                  label: 'No connection matches.',
                } as MenuItem,
              ]),
          separator,
          {
            kind: 'action',
            label: 'Disconnect',
            disabled: !active,
            run: () => switchConnection(null),
          },
          action('New connection…', () => void newConnection(), 'Ctrl+Shift+N'),
          action('Manage connections…', () => shell.showSidebar('connections')),
        ])
      }}
    >
      <span
        className={`status-dot ${hasSession ? 'status-dot--on' : ''}`}
        aria-hidden="true"
      />
      <span className="title-widget__text">
        {active?.name ?? 'No connection'}
      </span>
      {active && (
        <span className={`badge badge--${active.environment}`}>
          {active.environment}
        </span>
      )}
      <Icon name="chevron" size={14} />
    </MenuButton>
  )
}

function aheadBehind(ahead: number, behind: number): string {
  return [ahead > 0 ? `↑${ahead}` : null, behind > 0 ? `↓${behind}` : null]
    .filter(Boolean)
    .join(' ')
}

/** The Git branch of the workspace. Hidden if the workspace has no repository. */
export function BranchWidget() {
  const overview = useGitStore((state) => state.overview)
  if (overview?.state !== 'repository') return null
  const { branch, ahead, behind, files } = overview.status
  const name = branch ?? 'detached HEAD'
  const counts = aheadBehind(ahead, behind)
  const git = useGitStore.getState()
  const shell = useShellStore.getState()

  return (
    <MenuButton
      label={`Git branch: ${name}${counts ? ` ${counts}` : ''}`}
      menuLabel="Git branch"
      className="title-widget--branch"
      header={(close) => (
        <div className="menu-popup__summary">
          <p className="menu-popup__title">{name}</p>
          <p className="field__hint">
            {`${ahead} ${ahead === 1 ? 'commit' : 'commits'} to push · ${files.length} changed ${files.length === 1 ? 'file' : 'files'}`}
          </p>
          <div className="git__row">
            {[
              { label: 'Commit…', run: () => shell.showSidebar('git') },
              {
                label: `Push${ahead > 0 ? ` ↑${ahead}` : ''}`,
                run: () => void git.push(),
              },
              { label: 'Pull', run: () => void git.pull() },
            ].map((button) => (
              <button
                key={button.label}
                type="button"
                className="button button--small"
                onClick={() => {
                  close()
                  button.run()
                }}
              >
                {button.label}
              </button>
            ))}
          </div>
        </div>
      )}
      items={() =>
        tidy([
          { kind: 'heading', label: 'Local branches' },
          ...branchItems(),
          separator,
          action('New branch…', () => shell.showSidebar('git')),
          action('Show changes', () => shell.showSidebar('git'), 'Ctrl+D'),
        ])
      }
    >
      <Icon name="git" size={16} />
      <span className="title-widget__text">{name}</span>
      {counts && <span className="title-widget__counts">{counts}</span>}
      <Icon name="chevron" size={14} />
    </MenuButton>
  )
}

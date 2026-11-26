import { useState } from 'react'
import { engineLabel } from '../engines/engineStore'
import { relativeTime } from '../lib/relativeTime'
import { Icon } from '../shell/icons'
import { MenuButton } from '../shell/menu/MenuButton'
import { useShellStore } from '../shell/shellStore'
import { useTabsStore } from '../tabs/tabsStore'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { ConfirmDialog } from './ConfirmDialog'
import { connectionItems } from './connectionActions'
import { useConnectionStore } from './connectionStore'
import { isFileEngine, type ConnectionProfile } from './formModel'
import { environmentLabel, SECRET_OPTIONS, TLS_OPTIONS } from './options'

function passwordText(profile: ConnectionProfile): string {
  if (profile.secret.type === 'env-var') {
    return `Environment variable ${profile.secret.name}`
  }
  return (
    SECRET_OPTIONS.find((option) => option.value === profile.secret.type)
      ?.label ?? ''
  )
}

/** The facts of a connection. It shows no password. */
function Facts({ profile }: { profile: ConnectionProfile }) {
  const engine = profile.engine ?? 'postgres'
  const tabs = useTabsStore((state) => state.tabs)
  const usedBy = tabs
    .filter((tab) => tab.connectionId === profile.id)
    .map((tab) => tab.title)
  const isFile = isFileEngine(engine)
  const facts: [string, string][] = [
    ['Engine', engineLabel(engine)],
    ...(isFile
      ? ([['File', profile.database]] as [string, string][])
      : ([
          ['Server', profile.socket_path ?? `${profile.host}:${profile.port}`],
          ['Database', profile.database],
          ['User', profile.user ?? ''],
          ['Password', passwordText(profile)],
          [
            'TLS',
            TLS_OPTIONS.find((option) => option.value === profile.tls_mode)
              ?.label ?? '',
          ],
        ] as [string, string][])),
    ['Read-only', profile.read_only ? 'yes' : 'no'],
    ['Used by', usedBy.length > 0 ? usedBy.join(', ') : 'No open tab'],
  ]
  return (
    <dl className="detail-facts">
      {facts.map(([term, value]) => (
        <div key={term} className="detail-facts__row">
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The detail tab of a connection: its facts and the result of its last test. */
export function ConnectionDetail({ id }: { id: string }) {
  const profile = useWorkspaceStore((state) =>
    state.workspace?.connections.find((item) => item.id === id),
  )
  const test = useConnectionStore((state) => state.tests[id])
  const [deleting, setDeleting] = useState<ConnectionProfile | null>(null)
  if (!profile) {
    return (
      <p className="pane__hint">
        The workspace has no connection with this name now.
      </p>
    )
  }
  return (
    <div className="table-detail">
      <div className="table-detail__header">
        <h3 className="table-detail__title">{profile.name}</h3>
        <span className={`badge badge--${profile.environment}`}>
          {environmentLabel(profile.environment)}
        </span>
        <span className="view__spacer" />
        <button
          type="button"
          className="button button--small"
          onClick={() =>
            useShellStore.getState().editConnection({ profile, isNew: false })
          }
        >
          <Icon name="pencil" size={14} />
          Edit
        </button>
        <button
          type="button"
          className="button button--small"
          disabled={test?.status === 'testing'}
          onClick={() => void useConnectionStore.getState().test(profile)}
        >
          <Icon name="play" size={14} />
          {test ? 'Test again' : 'Test'}
        </button>
        <MenuButton
          label={`More actions for ${profile.name}`}
          menuLabel={`Actions for ${profile.name}`}
          className="view__icon-button"
          items={() => connectionItems(profile, setDeleting)}
        >
          <Icon name="more" size={16} />
        </MenuButton>
      </div>
      {test?.status === 'testing' && (
        <p role="status">Testing the connection…</p>
      )}
      {test?.status === 'failed' && (
        <div className="view-state view-state--error" role="alert">
          <p>
            The test failed{test.at ? ` ${relativeTime(test.at)}` : ''}.{' '}
            {test.error.advice}
          </p>
          {test.error.detail && (
            <p className="view-state__detail">{test.error.detail}</p>
          )}
        </div>
      )}
      {test?.status === 'connected' && (
        <p className="results__status" role="status">
          Connected{test.at ? ` ${relativeTime(test.at)}` : ''}. Server{' '}
          {test.version}.
        </p>
      )}
      <Facts profile={profile} />
      <p className="results__status">
        Enter in the list connects the current tab to the selected connection.
        Ctrl+Enter tests it. Delete asks before it removes the connection and
        its stored password.
      </p>
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
    </div>
  )
}

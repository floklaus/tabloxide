import type { TestState } from './connectionStore'
import type { ConnectionProfile } from './formModel'
import { environmentLabel } from './options'

type ConnectionItemProps = {
  profile: ConnectionProfile
  testState: TestState | undefined
  onTest: () => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}

function target(profile: ConnectionProfile): string {
  if (profile.engine === 'duckdb') return `DuckDB: ${profile.database}`
  const server = profile.socket_path ?? `${profile.host}:${profile.port}`
  return `${profile.user ?? ''}@${server}/${profile.database}`
}

function statusText(state: TestState | undefined): string {
  switch (state?.status) {
    case undefined:
      return 'Not tested'
    case 'testing':
      return 'Testing…'
    case 'connected':
      return `Connected (server ${state.version})`
    case 'failed':
      return `Failed. ${state.error.advice} ${state.error.detail}`.trim()
  }
}

export function ConnectionItem({
  profile,
  testState,
  onTest,
  onEdit,
  onDuplicate,
  onDelete,
}: ConnectionItemProps) {
  const status = testState?.status ?? 'untested'

  return (
    <li className="connection" aria-label={profile.name}>
      <div className="connection__header">
        <span
          className={`status-dot status-dot--${status}`}
          aria-hidden="true"
        />
        <span className="connection__name">{profile.name}</span>
        <span className={`badge badge--${profile.environment}`}>
          {environmentLabel(profile.environment)}
        </span>
      </div>
      <div className="connection__target">{target(profile)}</div>
      <div
        className={`connection__status connection__status--${status}`}
        role="status"
      >
        {statusText(testState)}
      </div>
      <div className="connection__actions">
        <button
          type="button"
          className="link-button"
          onClick={onTest}
          disabled={status === 'testing'}
        >
          Test
        </button>
        <button type="button" className="link-button" onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="link-button" onClick={onDuplicate}>
          Duplicate
        </button>
        <button
          type="button"
          className="link-button link-button--danger"
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </li>
  )
}

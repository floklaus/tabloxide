import type { Environment } from '../bindings'
import { engineLabel } from '../engines/engineStore'
import type { Status } from '../view/StatusMark'
import type { TestState } from './connectionStore'
import { isFileEngine, type ConnectionProfile } from './formModel'
import { environmentLabel } from './options'

/** The groups of the Connections view: the risky connections first. */
export const ENVIRONMENT_ORDER: Environment[] = [
  'production',
  'staging',
  'development',
]

/** The address of a connection, for example `PostgreSQL · db-prod.internal/shop`. */
export function connectionTarget(profile: ConnectionProfile): string {
  const engine = profile.engine ?? 'postgres'
  if (isFileEngine(engine))
    return `${engineLabel(engine)} · ${profile.database}`
  const server = profile.socket_path ?? profile.host
  return `${engineLabel(engine)} · ${server}/${profile.database}`
}

export type ConnectionStatus = {
  status: Status
  /** The state for the user and for a screen reader, for example "Connected". */
  label: string
  /** The second line of the row. */
  line: string
}

/** The status mark and the second line of a connection, from its last test. */
export function connectionStatus(
  profile: ConnectionProfile,
  test: TestState | undefined,
): ConnectionStatus {
  const engine = engineLabel(profile.engine ?? 'postgres')
  const target = connectionTarget(profile)
  switch (test?.status) {
    case undefined:
      return { status: 'neutral', label: 'Not tested', line: target }
    case 'testing':
      return { status: 'busy', label: 'Testing', line: `${engine} · testing…` }
    case 'connected':
      return {
        status: 'ok',
        label: 'Connected',
        line: target.replace(engine, `${engine} ${test.version}`),
      }
    case 'failed':
      return {
        status: 'error',
        label: 'Failed',
        line: `Failed: ${test.error.detail || test.error.advice}`,
      }
  }
}

export type ConnectionGroup = {
  environment: Environment
  label: string
  connections: ConnectionProfile[]
}

/** The connections in groups by environment, Production first, each in name order. */
export function groupConnections(
  connections: ConnectionProfile[],
  filter: string,
): ConnectionGroup[] {
  const text = filter.trim().toLowerCase()
  const matches = connections.filter(
    (profile) =>
      !text ||
      profile.name.toLowerCase().includes(text) ||
      connectionTarget(profile).toLowerCase().includes(text),
  )
  return ENVIRONMENT_ORDER.map((environment) => ({
    environment,
    label: environmentLabel(environment),
    connections: matches
      .filter((profile) => profile.environment === environment)
      .sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((group) => group.connections.length > 0)
}

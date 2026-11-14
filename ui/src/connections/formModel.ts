import type {
  ConnectionProfile_Serialize,
  Environment,
  TlsMode,
  ValidationIssue,
} from '../bindings'

export type ConnectionProfile = ConnectionProfile_Serialize

export type SecretKind = 'keychain' | 'env-var' | 'none'

/** The form state. Number fields are text, so the user can type freely. */
export type ConnectionDraft = {
  id: string
  name: string
  environment: Environment
  host: string
  port: string
  database: string
  user: string
  tlsMode: TlsMode
  socketPath: string
  connectTimeoutSecs: string
  queryTimeoutSecs: string
  params: string
  secretKind: SecretKind
  envVarName: string
}

export type DraftResult =
  | { ok: true; profile: ConnectionProfile }
  | { ok: false; issues: ValidationIssue[] }

function paramsToText(params: ConnectionProfile['params']): string {
  return Object.entries(params ?? {})
    .map(([name, value]) => `${name}=${value}`)
    .join('\n')
}

export function toDraft(profile: ConnectionProfile): ConnectionDraft {
  return {
    id: profile.id,
    name: profile.name,
    environment: profile.environment,
    host: profile.host,
    port: String(profile.port),
    database: profile.database,
    user: profile.user,
    tlsMode: profile.tls_mode,
    socketPath: profile.socket_path ?? '',
    connectTimeoutSecs: String(profile.connect_timeout_secs),
    queryTimeoutSecs:
      profile.query_timeout_secs === undefined
        ? ''
        : String(profile.query_timeout_secs),
    params: paramsToText(profile.params),
    secretKind: profile.secret.type,
    envVarName: profile.secret.type === 'env-var' ? profile.secret.name : '',
  }
}

function parseInteger(text: string): number | null {
  const trimmed = text.trim()
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null
}

function parseParams(text: string): Record<string, string> | null {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  const pairs = lines.map((line) => {
    const index = line.indexOf('=')
    return index <= 0
      ? null
      : ([line.slice(0, index).trim(), line.slice(index + 1).trim()] as const)
  })
  if (pairs.some((pair) => pair === null)) return null
  return Object.fromEntries(pairs.filter((pair) => pair !== null))
}

function toSecret(draft: ConnectionDraft): ConnectionProfile['secret'] {
  switch (draft.secretKind) {
    case 'keychain':
      return { type: 'keychain' }
    case 'none':
      return { type: 'none' }
    case 'env-var':
      return { type: 'env-var', name: draft.envVarName.trim() }
  }
}

/**
 * Converts the form state to a profile. This function checks only what the form itself can
 * get wrong (numbers and the parameter syntax). The backend validates all other rules.
 */
export function toProfile(draft: ConnectionDraft): DraftResult {
  const port = parseInteger(draft.port)
  const connectTimeout = parseInteger(draft.connectTimeoutSecs)
  const queryTimeout =
    draft.queryTimeoutSecs.trim() === ''
      ? undefined
      : parseInteger(draft.queryTimeoutSecs)
  const params = parseParams(draft.params)

  const issues: ValidationIssue[] = [
    port === null ? { field: 'port', message: 'Enter a number.' } : null,
    connectTimeout === null
      ? { field: 'connect_timeout_secs', message: 'Enter a number of seconds.' }
      : null,
    queryTimeout === null
      ? {
          field: 'query_timeout_secs',
          message: 'Enter a number of seconds, or leave it empty.',
        }
      : null,
    params === null
      ? {
          field: 'params',
          message: 'Write one parameter on each line as name=value.',
        }
      : null,
  ].filter((issue) => issue !== null)

  if (
    issues.length > 0 ||
    port === null ||
    connectTimeout === null ||
    queryTimeout === null ||
    params === null
  ) {
    return { ok: false, issues }
  }

  const socketPath = draft.socketPath.trim()
  return {
    ok: true,
    profile: {
      id: draft.id,
      name: draft.name.trim(),
      environment: draft.environment,
      host: draft.host.trim(),
      port,
      database: draft.database.trim(),
      user: draft.user.trim(),
      tls_mode: draft.tlsMode,
      connect_timeout_secs: connectTimeout,
      secret: toSecret(draft),
      ...(socketPath === '' ? {} : { socket_path: socketPath }),
      ...(queryTimeout === undefined
        ? {}
        : { query_timeout_secs: queryTimeout }),
      ...(Object.keys(params).length === 0 ? {} : { params }),
    },
  }
}

/** Returns the message for one field, or `undefined` if the field has no problem. */
export function issueFor(
  issues: ValidationIssue[],
  field: string,
): string | undefined {
  return issues.find((issue) => issue.field === field)?.message
}

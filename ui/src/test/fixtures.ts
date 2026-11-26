import type { ConnectionProfile } from '../connections/formModel'
import type { Workspace } from '../workspace/workspaceStore'

export function makeProfile(
  overrides: Partial<ConnectionProfile> = {},
): ConnectionProfile {
  return {
    id: 'id-1',
    name: 'Local',
    engine: 'postgres',
    environment: 'development',
    host: 'localhost',
    port: 5432,
    database: 'app',
    user: 'app_user',
    tls_mode: 'prefer',
    connect_timeout_secs: 10,
    secret: { type: 'keychain' },
    ...overrides,
  }
}

export function makeWorkspace(
  connections: ConnectionProfile[] = [],
): Workspace {
  return { path: '/work/sql-project', name: 'sql-project', connections }
}

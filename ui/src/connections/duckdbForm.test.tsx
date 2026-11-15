import { open } from '@tauri-apps/plugin-dialog'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { makeProfile, makeWorkspace } from '../test/fixtures'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { ConnectionForm } from './ConnectionForm'
import { ConnectionItem } from './ConnectionItem'
import { toDraft, toProfile, withEngine } from './formModel'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

const connectionSave = vi.mocked(commands.connectionSave)
const fileRelativePath = vi.mocked(commands.fileRelativePath)
const initialWorkspaceState = useWorkspaceStore.getState()

const DUCKDB_PROFILE = makeProfile({
  engine: 'duckdb',
  name: 'Analytics',
  host: '',
  database: 'data/analytics.duckdb',
  user: undefined,
  tls_mode: 'disable',
  secret: { type: 'none' },
})

function renderForm(profile = makeProfile({ name: '' }), isNew = true) {
  const onClose = vi.fn()
  render(<ConnectionForm profile={profile} isNew={isNew} onClose={onClose} />)
  return { user: userEvent.setup(), onClose }
}

beforeEach(() => {
  vi.clearAllMocks()
  useWorkspaceStore.setState(initialWorkspaceState, true)
  connectionSave.mockResolvedValue({
    status: 'ok',
    data: makeWorkspace([DUCKDB_PROFILE]),
  })
})

describe('form model for DuckDB', () => {
  test('a DuckDB profile has the file and no server settings of the user', () => {
    const draft = {
      ...withEngine(toDraft(makeProfile()), 'duckdb'),
      name: ' Analytics ',
      database: ' data/analytics.duckdb ',
      port: 'not a number',
      params: 'not valid',
      readOnly: true,
      queryTimeoutSecs: '30',
    }

    const result = toProfile(draft)

    expect(result).toEqual({
      ok: true,
      profile: {
        id: 'id-1',
        name: 'Analytics',
        engine: 'duckdb',
        environment: 'development',
        host: '',
        port: 5432,
        database: 'data/analytics.duckdb',
        tls_mode: 'disable',
        connect_timeout_secs: 10,
        secret: { type: 'none' },
        query_timeout_secs: 30,
        read_only: true,
      },
    })
  })

  test('reports a query timeout that is not a number', () => {
    const draft = {
      ...withEngine(toDraft(makeProfile()), 'duckdb'),
      queryTimeoutSecs: 'soon',
    }

    const result = toProfile(draft)

    expect(!result.ok && result.issues[0].field).toBe('query_timeout_secs')
  })

  test('a change back to PostgreSQL uses the credential store again', () => {
    const duckdb = withEngine(toDraft(makeProfile()), 'duckdb')

    expect(duckdb.secretKind).toBe('none')
    expect(withEngine(duckdb, 'postgres').secretKind).toBe('keychain')
  })

  test('a profile without an engine is a PostgreSQL profile', () => {
    expect(toDraft(makeProfile()).engine).toBe('postgres')
  })
})

describe('ConnectionForm for DuckDB', () => {
  test('shows the file field and hides the server fields', async () => {
    const { user } = renderForm()
    expect(screen.getByLabelText('Host')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Database engine'), 'duckdb')

    expect(screen.getByLabelText('Database file')).toBeInTheDocument()
    for (const label of ['Host', 'Port', 'User', 'TLS mode', 'Password']) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument()
    }
    expect(screen.getByLabelText(/Query timeout/)).toBeInTheDocument()
  })

  test('saves a DuckDB connection without a password', async () => {
    const { user, onClose } = renderForm()

    await user.selectOptions(screen.getByLabelText('Database engine'), 'duckdb')
    await user.type(screen.getByLabelText('Name'), 'Analytics')
    await user.clear(screen.getByLabelText('Database file'))
    await user.type(screen.getByLabelText('Database file'), ':memory:')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(connectionSave).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: 'duckdb',
        name: 'Analytics',
        database: ':memory:',
        secret: { type: 'none' },
      }),
      null,
    )
    expect(onClose).toHaveBeenCalledOnce()
  })

  test('opens a saved DuckDB connection with its file', () => {
    renderForm(DUCKDB_PROFILE, false)

    expect(screen.getByLabelText('Database engine')).toHaveValue('duckdb')
    expect(screen.getByLabelText('Database file')).toHaveValue(
      'data/analytics.duckdb',
    )
  })

  test('a selected file in the workspace gets a relative path', async () => {
    vi.mocked(open).mockResolvedValue('/work/sql-project/data/new.duckdb')
    fileRelativePath.mockResolvedValue({
      status: 'ok',
      data: 'data/new.duckdb',
    })
    const { user } = renderForm(DUCKDB_PROFILE, false)

    await user.click(screen.getByRole('button', { name: 'Select file…' }))

    expect(fileRelativePath).toHaveBeenCalledWith(
      '/work/sql-project/data/new.duckdb',
    )
    expect(await screen.findByDisplayValue('data/new.duckdb')).toBeVisible()
  })

  test('a selected file outside the workspace keeps its absolute path', async () => {
    vi.mocked(open).mockResolvedValue('/other/place.duckdb')
    fileRelativePath.mockResolvedValue({
      status: 'error',
      error: { kind: 'workspace', message: 'outside', issues: [] },
    })
    const { user } = renderForm(DUCKDB_PROFILE, false)

    await user.click(screen.getByRole('button', { name: 'Select file…' }))

    expect(await screen.findByDisplayValue('/other/place.duckdb')).toBeVisible()
  })
})

describe('ConnectionItem for DuckDB', () => {
  test('shows the engine and the file in place of the server', () => {
    const noop = vi.fn()
    render(
      <ul>
        <ConnectionItem
          profile={DUCKDB_PROFILE}
          testState={undefined}
          onTest={noop}
          onEdit={noop}
          onDuplicate={noop}
          onDelete={noop}
        />
      </ul>,
    )

    expect(
      screen.getByText('DuckDB: data/analytics.duckdb'),
    ).toBeInTheDocument()
  })
})

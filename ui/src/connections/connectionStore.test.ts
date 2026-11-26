import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { makeProfile, makeWorkspace } from '../test/fixtures'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { runConnectionTest, useConnectionStore } from './connectionStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

const initialWorkspaceState = useWorkspaceStore.getState()
const store = () => useConnectionStore.getState()
const invalid = {
  status: 'error' as const,
  error: {
    kind: 'invalid-profile' as const,
    message: 'The connection settings are not valid.',
    issues: [{ field: 'name', message: 'Enter a name.' }],
  },
}

describe('connectionStore', () => {
  beforeEach(() => {
    useWorkspaceStore.setState(initialWorkspaceState, true)
    useConnectionStore.setState({ tests: {} })
  })

  test('save stores the changed workspace', async () => {
    const profile = makeProfile()
    vi.mocked(commands.connectionSave).mockResolvedValue({
      status: 'ok',
      data: makeWorkspace([profile]),
    })

    const error = await store().save(profile, 'pw')

    expect(error).toBeNull()
    expect(commands.connectionSave).toHaveBeenCalledWith(profile, 'pw')
    expect(useWorkspaceStore.getState().workspace?.connections).toEqual([
      profile,
    ])
  })

  test('save returns the error and does not change the workspace', async () => {
    vi.mocked(commands.connectionSave).mockResolvedValue(invalid)

    const error = await store().save(makeProfile({ name: '' }), null)

    expect(error?.issues).toEqual(invalid.error.issues)
    expect(useWorkspaceStore.getState().workspace).toBeNull()
  })

  test('save removes the last test result of the connection', async () => {
    const profile = makeProfile()
    useConnectionStore.setState({
      tests: { [profile.id]: { status: 'connected', version: '17' } },
    })
    vi.mocked(commands.connectionSave).mockResolvedValue({
      status: 'ok',
      data: makeWorkspace([profile]),
    })

    await store().save(profile, null)

    expect(store().tests).toEqual({})
  })

  test('remove shows the error message when the backend fails', async () => {
    vi.mocked(commands.connectionDelete).mockResolvedValue({
      status: 'error',
      error: {
        kind: 'workspace',
        message: 'Cannot write the file.',
        issues: [],
      },
    })

    await store().remove('id-1')

    expect(useWorkspaceStore.getState().error).toBe('Cannot write the file.')
  })

  test('test stores the server version of a successful test', async () => {
    vi.mocked(commands.connectionTest).mockResolvedValue({
      status: 'ok',
      data: { status: 'connected', server: { version: '17.2' } },
    })

    await store().test(makeProfile())

    expect(store().tests['id-1']).toMatchObject({
      status: 'connected',
      version: '17.2',
    })
    // The detail tab tells the age of the test.
    expect(store().tests['id-1']).toHaveProperty('at')
    expect(commands.connectionTest).toHaveBeenCalledWith(makeProfile(), null)
  })

  test('runConnectionTest returns the connection error of a failed test', async () => {
    const error = {
      kind: 'authentication' as const,
      advice: 'Check the password.',
      detail: 'x',
    }
    vi.mocked(commands.connectionTest).mockResolvedValue({
      status: 'ok',
      data: { status: 'failed', error },
    })

    const state = await runConnectionTest(makeProfile(), 'pw')

    expect(state).toEqual({ status: 'failed', error })
  })

  test('runConnectionTest reports validation problems as a failed test', async () => {
    vi.mocked(commands.connectionTest).mockResolvedValue(invalid)

    const state = await runConnectionTest(makeProfile(), null)

    expect(state.status === 'failed' && state.error.detail).toBe(
      'The connection settings are not valid. Enter a name.',
    )
  })

  test('runConnectionTest reports a thrown error as a failed test', async () => {
    vi.mocked(commands.connectionTest).mockRejectedValue(
      new Error('no backend'),
    )

    const state = await runConnectionTest(makeProfile(), null)

    expect(state.status === 'failed' && state.error.detail).toBe('no backend')
  })
})

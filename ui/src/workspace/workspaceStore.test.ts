import { open } from '@tauri-apps/plugin-dialog'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { makeWorkspace } from '../test/fixtures'
import { useWorkspaceStore } from './workspaceStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

const initialState = useWorkspaceStore.getState()
const store = () => useWorkspaceStore.getState()

describe('workspaceStore', () => {
  beforeEach(() => {
    useWorkspaceStore.setState(initialState, true)
    vi.mocked(commands.workspaceCurrent).mockResolvedValue(null)
    vi.mocked(commands.workspaceRecent).mockResolvedValue({
      status: 'ok',
      data: [],
    })
    vi.mocked(commands.workspaceClose).mockResolvedValue(undefined as never)
  })

  test('init gets the open workspace and the recent list', async () => {
    const recent = [
      { path: '/work/a', name: 'a', opened_at: 1, engines: [], exists: true },
    ]
    vi.mocked(commands.workspaceCurrent).mockResolvedValue(makeWorkspace())
    vi.mocked(commands.workspaceRecent).mockResolvedValue({
      status: 'ok',
      data: recent,
    })

    await store().init()

    expect(store().workspace).toEqual(makeWorkspace())
    expect(store().recent).toEqual(recent)
    expect(store().isLoading).toBe(false)
  })

  test('init stores an error message when the backend is not available', async () => {
    vi.mocked(commands.workspaceCurrent).mockRejectedValue(
      new Error('no backend'),
    )

    await store().init()

    expect(store().error).toBe('no backend')
    expect(store().isLoading).toBe(false)
  })

  test('openPath stores the workspace that the backend returns', async () => {
    vi.mocked(commands.workspaceOpen).mockResolvedValue({
      status: 'ok',
      data: makeWorkspace(),
    })

    await store().openPath('/work/sql-project')

    expect(commands.workspaceOpen).toHaveBeenCalledWith('/work/sql-project')
    expect(store().workspace?.name).toBe('sql-project')
  })

  test('openPath stores the error message when the backend rejects the folder', async () => {
    vi.mocked(commands.workspaceOpen).mockResolvedValue({
      status: 'error',
      error: { kind: 'workspace', message: 'Not a directory.', issues: [] },
    })

    await store().openPath('/missing')

    expect(store().workspace).toBeNull()
    expect(store().error).toBe('Not a directory.')
  })

  test('openFolder opens the folder that the user selects', async () => {
    vi.mocked(open).mockResolvedValue('/work/sql-project')
    vi.mocked(commands.workspaceOpen).mockResolvedValue({
      status: 'ok',
      data: makeWorkspace(),
    })

    await store().openFolder()

    expect(commands.workspaceOpen).toHaveBeenCalledWith('/work/sql-project')
  })

  test('openFolder does nothing when the user cancels the dialog', async () => {
    vi.mocked(open).mockResolvedValue(null)

    await store().openFolder()

    expect(commands.workspaceOpen).not.toHaveBeenCalled()
  })

  test('close removes the workspace', async () => {
    useWorkspaceStore.setState({ workspace: makeWorkspace() })

    await store().close()

    expect(store().workspace).toBeNull()
  })
})

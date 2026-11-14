import { open } from '@tauri-apps/plugin-dialog'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { makeWorkspace } from '../test/fixtures'
import { CloneDialog } from './CloneDialog'
import { useWorkspaceStore } from './workspaceStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

const gitClone = vi.mocked(commands.gitClone)
const workspaceOpen = vi.mocked(commands.workspaceOpen)
const initialWorkspaceState = useWorkspaceStore.getState()

async function fill(user: ReturnType<typeof userEvent.setup>, url: string) {
  vi.mocked(open).mockResolvedValue('/home/me/projects')
  await user.type(screen.getByLabelText('Repository URL'), url)
  await user.click(screen.getByRole('button', { name: 'Select folder…' }))
  await screen.findByText('/home/me/projects')
}

describe('CloneDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkspaceStore.setState(initialWorkspaceState, true)
  })

  test('proposes the folder name from the URL', async () => {
    const user = userEvent.setup()
    render(<CloneDialog onClose={() => {}} />)

    await user.type(
      screen.getByLabelText('Repository URL'),
      'git@example.com:team/sql-reports.git',
    )

    expect(screen.getByLabelText('Folder name')).toHaveValue('sql-reports')
  })

  test('clones the repository and opens it as the workspace', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    gitClone.mockResolvedValue({ status: 'ok', data: '/home/me/projects/sql' })
    workspaceOpen.mockResolvedValue({ status: 'ok', data: makeWorkspace() })
    render(<CloneDialog onClose={onClose} />)
    expect(screen.getByRole('button', { name: 'Clone' })).toBeDisabled()

    await fill(user, 'https://example.com/team/sql.git')
    await user.click(screen.getByRole('button', { name: 'Clone' }))

    expect(gitClone).toHaveBeenCalledWith(
      'https://example.com/team/sql.git',
      '/home/me/projects',
      'sql',
    )
    expect(workspaceOpen).toHaveBeenCalledWith('/home/me/projects/sql')
    expect(onClose).toHaveBeenCalled()
  })

  test('shows the error of Git and stays open when the clone fails', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    gitClone.mockResolvedValue({
      status: 'error',
      error: {
        kind: 'git',
        message: 'fatal: could not read Username',
        issues: [],
      },
    })
    render(<CloneDialog onClose={onClose} />)

    await fill(user, 'https://example.com/private.git')
    await user.click(screen.getByRole('button', { name: 'Clone' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'could not read Username',
    )
    expect(onClose).not.toHaveBeenCalled()
    expect(workspaceOpen).not.toHaveBeenCalled()
  })
})

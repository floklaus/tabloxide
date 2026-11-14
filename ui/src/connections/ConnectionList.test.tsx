import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { makeProfile, makeWorkspace } from '../test/fixtures'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { ConnectionList } from './ConnectionList'
import { useConnectionStore } from './connectionStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

const initialWorkspaceState = useWorkspaceStore.getState()
const production = makeProfile({
  id: 'id-2',
  name: 'Live',
  environment: 'production',
})

function renderList(connections = [makeProfile(), production]) {
  useWorkspaceStore.setState({ workspace: makeWorkspace(connections) })
  render(<ConnectionList />)
  return userEvent.setup()
}

describe('ConnectionList', () => {
  beforeEach(() => {
    useWorkspaceStore.setState(initialWorkspaceState, true)
    useConnectionStore.setState({ tests: {} })
  })

  test('shows no connections when no workspace is open', () => {
    render(<ConnectionList />)

    expect(
      screen.getByText('This workspace has no connections.'),
    ).toBeInTheDocument()
  })

  test('shows a message when the workspace has no connections', () => {
    renderList([])

    expect(
      screen.getByText('This workspace has no connections.'),
    ).toBeInTheDocument()
  })

  test('shows each connection with its target and its environment', () => {
    renderList()

    const live = screen.getByRole('listitem', { name: 'Live' })
    expect(within(live).getByText('Production')).toBeInTheDocument()
    expect(
      within(live).getByText('app_user@localhost:5432/app'),
    ).toBeInTheDocument()
    expect(within(live).getByText('Not tested')).toBeInTheDocument()
  })

  test('shows the result of a connection test', async () => {
    vi.mocked(commands.connectionTest).mockResolvedValue({
      status: 'ok',
      data: {
        status: 'failed',
        error: {
          kind: 'authentication',
          advice: 'Check the user and the password.',
          detail: 'x',
        },
      },
    })
    const user = renderList([makeProfile()])

    await user.click(screen.getByRole('button', { name: 'Test' }))

    expect(
      await screen.findByText('Failed. Check the user and the password. x'),
    ).toBeInTheDocument()
  })

  test('deletes a connection only after the user confirms', async () => {
    vi.mocked(commands.connectionDelete).mockResolvedValue({
      status: 'ok',
      data: makeWorkspace([production]),
    })
    const user = renderList()
    const local = screen.getByRole('listitem', { name: 'Local' })

    await user.click(within(local).getByRole('button', { name: 'Delete' }))
    expect(commands.connectionDelete).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: 'Delete connection' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(commands.connectionDelete).toHaveBeenCalledWith('id-1')
    expect(
      screen.queryByRole('listitem', { name: 'Local' }),
    ).not.toBeInTheDocument()
  })

  test('does not delete a connection when the user cancels', async () => {
    const user = renderList()
    const local = screen.getByRole('listitem', { name: 'Local' })

    await user.click(within(local).getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(commands.connectionDelete).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('duplicates a connection', async () => {
    const copy = makeProfile({ id: 'id-3', name: 'Local (copy)' })
    vi.mocked(commands.connectionDuplicate).mockResolvedValue({
      status: 'ok',
      data: makeWorkspace([makeProfile(), copy]),
    })
    const user = renderList([makeProfile()])

    await user.click(screen.getByRole('button', { name: 'Duplicate' }))

    expect(
      await screen.findByRole('listitem', { name: 'Local (copy)' }),
    ).toBeInTheDocument()
  })

  test('opens the form with the template for a new connection', async () => {
    vi.mocked(commands.connectionTemplate).mockResolvedValue(
      makeProfile({ id: 'new-id', name: '', database: '', user: '' }),
    )
    const user = renderList([])

    await user.click(screen.getByRole('button', { name: 'New' }))

    expect(
      await screen.findByRole('dialog', { name: 'New connection' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Port')).toHaveValue('5432')
  })
})

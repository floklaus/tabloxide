import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { makeWorkspace } from '../test/fixtures'
import { WelcomeScreen } from './WelcomeScreen'
import { useWorkspaceStore } from './workspaceStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

const initialState = useWorkspaceStore.getState()

describe('WelcomeScreen', () => {
  beforeEach(() => {
    useWorkspaceStore.setState(initialState, true)
  })

  test('opens a recent workspace when the user clicks it', async () => {
    useWorkspaceStore.setState({
      recent: [{ path: '/work/sql-project', name: 'sql-project' }],
    })
    vi.mocked(commands.workspaceOpen).mockResolvedValue({
      status: 'ok',
      data: makeWorkspace(),
    })
    render(<WelcomeScreen />)

    await userEvent.click(screen.getByRole('button', { name: /sql-project/ }))

    expect(commands.workspaceOpen).toHaveBeenCalledWith('/work/sql-project')
  })

  test('shows no recent section when the list is empty', () => {
    render(<WelcomeScreen />)

    expect(screen.queryByText('Recent workspaces')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Open folder…' }),
    ).toBeInTheDocument()
  })

  test('shows the error message of a failed open', () => {
    useWorkspaceStore.setState({ error: 'Not a directory.' })

    render(<WelcomeScreen />)

    expect(screen.getByRole('alert')).toHaveTextContent('Not a directory.')
  })
})

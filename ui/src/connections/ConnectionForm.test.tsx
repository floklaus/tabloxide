import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { makeProfile, makeWorkspace } from '../test/fixtures'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { ConnectionForm } from './ConnectionForm'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

const initialWorkspaceState = useWorkspaceStore.getState()

function renderForm(profile = makeProfile(), isNew = false) {
  const onClose = vi.fn()
  render(<ConnectionForm profile={profile} isNew={isNew} onClose={onClose} />)
  return { user: userEvent.setup(), onClose }
}

function saved(profile = makeProfile()) {
  return { status: 'ok' as const, data: makeWorkspace([profile]) }
}

describe('ConnectionForm', () => {
  beforeEach(() => {
    useWorkspaceStore.setState(initialWorkspaceState, true)
  })

  test('saves the changed profile with the new password and closes', async () => {
    vi.mocked(commands.connectionSave).mockResolvedValue(saved())
    const { user, onClose } = renderForm()

    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Renamed')
    await user.type(screen.getByLabelText('Password'), 's3cret')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(commands.connectionSave).toHaveBeenCalledWith(
      makeProfile({ name: 'Renamed' }),
      's3cret',
    )
    expect(onClose).toHaveBeenCalledOnce()
  })

  test('sends no password when the password field is empty', async () => {
    vi.mocked(commands.connectionSave).mockResolvedValue(saved())
    const { user } = renderForm()

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(commands.connectionSave).toHaveBeenCalledWith(makeProfile(), null)
  })

  test('shows the problems of the backend at the fields and stays open', async () => {
    vi.mocked(commands.connectionSave).mockResolvedValue({
      status: 'error',
      error: {
        kind: 'invalid-profile',
        message: 'The connection settings are not valid.',
        issues: [{ field: 'name', message: 'Enter a name.' }],
      },
    })
    const { user, onClose } = renderForm(makeProfile({ name: '' }))

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Enter a name.')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription(
      'Enter a name.',
    )
    expect(screen.getByLabelText('Name')).toBeInvalid()
    expect(onClose).not.toHaveBeenCalled()
  })

  test('does not call the backend when the port is not a number', async () => {
    const { user } = renderForm()

    await user.clear(screen.getByLabelText('Port'))
    await user.type(screen.getByLabelText('Port'), 'abc')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByText('Enter a number.')).toBeInTheDocument()
    expect(commands.connectionSave).not.toHaveBeenCalled()
  })

  test('shows the environment variable field and hides the password field for that source', async () => {
    vi.mocked(commands.connectionSave).mockResolvedValue(saved())
    const { user } = renderForm()

    await user.selectOptions(
      screen.getByLabelText('Password source'),
      'env-var',
    )
    await user.type(
      screen.getByLabelText('Environment variable name'),
      'PGPASSWORD',
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(commands.connectionSave).toHaveBeenCalledWith(
      makeProfile({ secret: { type: 'env-var', name: 'PGPASSWORD' } }),
      null,
    )
  })

  test('tests the connection with the values in the form and shows the result', async () => {
    vi.mocked(commands.connectionTest).mockResolvedValue({
      status: 'ok',
      data: { status: 'connected', server: { version: '17.2' } },
    })
    const { user } = renderForm()

    await user.type(screen.getByLabelText('Password'), 'pw')
    await user.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(
      await screen.findByText('Connected. Server version 17.2.'),
    ).toBeInTheDocument()
    expect(commands.connectionTest).toHaveBeenCalledWith(makeProfile(), 'pw')
    expect(commands.connectionSave).not.toHaveBeenCalled()
  })

  test('shows the advice and the detail of a failed test', async () => {
    vi.mocked(commands.connectionTest).mockResolvedValue({
      status: 'ok',
      data: {
        status: 'failed',
        error: {
          kind: 'unreachable',
          advice: 'Check the host.',
          detail: 'connection refused',
        },
      },
    })
    const { user } = renderForm()

    await user.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(
      await screen.findByText('The connection failed. Check the host.'),
    ).toBeInTheDocument()
    expect(screen.getByText('connection refused')).toBeInTheDocument()
  })

  test('closes without a save when the user presses Escape', async () => {
    const { user, onClose } = renderForm()

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledOnce()
    expect(commands.connectionSave).not.toHaveBeenCalled()
  })
})

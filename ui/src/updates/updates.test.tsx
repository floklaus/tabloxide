import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import {
  DEFAULT_PREFERENCES,
  usePreferencesStore,
} from '../preferences/preferencesStore'
import { UpdateNotice } from './UpdateNotice'
import { UpdateSettings } from './UpdateSettings'
import { resetUpdateStore, useUpdateStore } from './updateStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)

const updateCheck = vi.mocked(commands.updateCheck)
const updateInstall = vi.mocked(commands.updateInstall)
const preferencesLoad = vi.mocked(commands.preferencesLoad)

const AVAILABLE = {
  status: 'ok' as const,
  data: {
    status: 'available' as const,
    version: '0.2.0',
    current_version: '0.1.0',
    notes: 'Faster grid.',
  },
}

function preferences(checkForUpdates: boolean) {
  return {
    status: 'ok' as const,
    data: { ...DEFAULT_PREFERENCES, check_for_updates: checkForUpdates },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // A different test can replace the answer. Each test starts with the default.
  updateCheck.mockResolvedValue({
    status: 'ok',
    data: { status: 'not-configured' },
  })
  updateInstall.mockResolvedValue({ status: 'ok', data: null })
  resetUpdateStore()
  usePreferencesStore.setState({
    preferences: DEFAULT_PREFERENCES,
    error: null,
  })
})

describe('UpdateNotice', () => {
  test('checks at the start and offers a newer version', async () => {
    updateCheck.mockResolvedValue(AVAILABLE)

    render(<UpdateNotice />)

    const notice = await screen.findByRole('region', { name: 'Update' })
    expect(notice).toHaveTextContent('Tabloxide 0.2.0 is available.')
    expect(notice).toHaveTextContent('You use version 0.1.0.')
    expect(screen.getByText('Faster grid.')).toBeInTheDocument()
  })

  test('does not send a request when the user disabled the check', async () => {
    preferencesLoad.mockResolvedValueOnce(preferences(false))

    render(<UpdateNotice />)

    await waitFor(() => expect(preferencesLoad).toHaveBeenCalled())
    await Promise.resolve()
    expect(updateCheck).not.toHaveBeenCalled()
  })

  test('does not send a request when the preferences are not available', async () => {
    preferencesLoad.mockResolvedValueOnce({
      status: 'error',
      error: { kind: 'internal', message: 'no database', issues: [] },
    })

    render(<UpdateNotice />)

    await waitFor(() => expect(preferencesLoad).toHaveBeenCalled())
    await Promise.resolve()
    expect(updateCheck).not.toHaveBeenCalled()
  })

  test('shows nothing when the build cannot update itself', async () => {
    render(<UpdateNotice />)

    await waitFor(() => expect(updateCheck).toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: 'Update' })).toBeNull()
  })

  test('hides the notice until the next start when the user defers', async () => {
    updateCheck.mockResolvedValue(AVAILABLE)
    const user = userEvent.setup()
    render(<UpdateNotice />)

    await user.click(await screen.findByRole('button', { name: 'Later' }))

    expect(screen.queryByRole('region', { name: 'Update' })).toBeNull()
    expect(updateInstall).not.toHaveBeenCalled()
  })

  test('installs the update and shows a failure', async () => {
    updateCheck.mockResolvedValue(AVAILABLE)
    updateInstall.mockResolvedValue({
      status: 'error',
      error: {
        kind: 'internal',
        message: 'The update failed: the signature is not valid',
        issues: [],
      },
    })
    const user = userEvent.setup()
    render(<UpdateNotice />)

    await user.click(
      await screen.findByRole('button', { name: 'Install and restart' }),
    )

    expect(updateInstall).toHaveBeenCalledOnce()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'the signature is not valid',
    )
    expect(
      screen.getByRole('button', { name: 'Install and restart' }),
    ).toBeEnabled()
  })
})

describe('UpdateSettings', () => {
  test('changes the setting and checks on request', async () => {
    const onChange = vi.fn()
    updateCheck.mockResolvedValue({
      status: 'ok',
      data: { status: 'up-to-date' },
    })
    const user = userEvent.setup()
    render(<UpdateSettings isEnabled onChange={onChange} />)

    await user.click(
      screen.getByRole('checkbox', {
        name: 'Check for a newer version when the application starts',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Check now' }))

    expect(onChange).toHaveBeenCalledWith(false)
    expect(
      await screen.findByText('You use the newest version.'),
    ).toBeInTheDocument()
  })

  test('explains a build that cannot update itself', async () => {
    const user = userEvent.setup()
    render(<UpdateSettings isEnabled={false} onChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Check now' }))

    expect(
      await screen.findByText(/This build of the application cannot update/),
    ).toBeInTheDocument()
  })

  test('a check from the preferences shows the notice again after a deferral', async () => {
    updateCheck.mockResolvedValue(AVAILABLE)
    useUpdateStore.setState({ check: AVAILABLE.data, isDeferred: true })

    await useUpdateStore.getState().checkNow()

    expect(useUpdateStore.getState().isDeferred).toBe(false)
  })
})

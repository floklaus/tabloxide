import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { useThemeStore } from '../theme/themeStore'
import { AppShell } from './AppShell'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

const appInfo = vi.mocked(commands.appInfo)

describe('AppShell', () => {
  test('shows the sidebar, editor, and results panes', () => {
    appInfo.mockResolvedValue({ name: 'Tabloxide', version: '0.1.0' })

    render(<AppShell />)

    expect(
      screen.getByRole('navigation', { name: 'Sidebar' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Editor' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Results' })).toBeInTheDocument()
  })

  test('shows the application name and version from the backend', async () => {
    appInfo.mockResolvedValue({ name: 'Tabloxide', version: '9.9.9' })

    render(<AppShell />)

    expect(await screen.findByText('Tabloxide 9.9.9')).toBeInTheDocument()
  })

  test('shows an error message when the backend is not available', async () => {
    appInfo.mockRejectedValue(new Error('no backend'))

    render(<AppShell />)

    expect(
      await screen.findByText('Backend not available: no backend'),
    ).toBeInTheDocument()
  })

  test('changes the theme when the user clicks the theme button', async () => {
    appInfo.mockResolvedValue({ name: 'Tabloxide', version: '0.1.0' })
    useThemeStore.setState({ theme: 'system' })
    render(<AppShell />)

    await userEvent.click(
      screen.getByRole('button', { name: /^Theme: System/ }),
    )

    expect(
      screen.getByRole('button', { name: /^Theme: Light/ }),
    ).toBeInTheDocument()
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})

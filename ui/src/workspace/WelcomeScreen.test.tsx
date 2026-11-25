import { open } from '@tauri-apps/plugin-dialog'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  commands,
  type RecentWorkspaceInfo_Serialize as RecentWorkspaceInfo,
} from '../bindings'
import { makeWorkspace } from '../test/fixtures'
import { WelcomeScreen } from './WelcomeScreen'
import { useWorkspaceStore } from './workspaceStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

const initialState = useWorkspaceStore.getState()
const NOW = 1_800_000_000

function recent(
  overrides: Partial<RecentWorkspaceInfo> = {},
): RecentWorkspaceInfo {
  return {
    path: '/work/sql-project',
    name: 'sql-project',
    opened_at: NOW - 2 * 3600,
    engines: ['postgres'],
    exists: true,
    ...overrides,
  }
}

describe('WelcomeScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkspaceStore.setState(initialState, true)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW * 1000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('shows the logo, the text, and the two actions', () => {
    render(<WelcomeScreen />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Tabloxide',
    )
    expect(
      screen.getByRole('button', { name: /Open folder…/ }),
    ).toHaveTextContent('Ctrl+O')
    expect(
      screen.getByRole('button', { name: /Clone a repository…/ }),
    ).toHaveTextContent('From a Git address')
    expect(screen.queryByText('Recent workspaces')).not.toBeInTheDocument()
  })

  test('opens a recent workspace when the user clicks it', async () => {
    useWorkspaceStore.setState({ recent: [recent()] })
    vi.mocked(commands.workspaceOpen).mockResolvedValue({
      status: 'ok',
      data: makeWorkspace(),
    })
    render(<WelcomeScreen />)

    await userEvent.click(screen.getByRole('button', { name: /^sql-project/ }))

    expect(commands.workspaceOpen).toHaveBeenCalledWith('/work/sql-project')
  })

  test('shows the engines and the time of the last open of each workspace', () => {
    useWorkspaceStore.setState({
      recent: [
        recent(),
        recent({
          path: '/lab/mixed',
          name: 'mixed',
          engines: ['postgres', 'duckdb'],
          opened_at: NOW - 8 * 24 * 3600,
        }),
        recent({ path: '/lab/old', name: 'old', engines: [], opened_at: null }),
        recent({ path: '/lab/gone', name: 'gone', exists: false }),
      ],
    })

    render(<WelcomeScreen />)

    const list = screen.getByRole('region', { name: 'Recent workspaces' })
    const items = within(list).getAllByRole('button', { name: /^(?!Remove)/ })
    expect(items[0]).toHaveTextContent('PostgreSQL · 2 hours ago')
    expect(items[1]).toHaveTextContent('PostgreSQL, DuckDB · last week')
    expect(items[2]).toHaveTextContent(/old\/lab\/old$/)
    expect(items[3]).toHaveTextContent('The folder does not exist')
  })

  test('removes a workspace from the list without opening it', async () => {
    const kept = recent({ path: '/lab/kept', name: 'kept' })
    useWorkspaceStore.setState({ recent: [recent(), kept] })
    vi.mocked(commands.workspaceRecentRemove).mockResolvedValue({
      status: 'ok',
      data: [kept],
    })
    render(<WelcomeScreen />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Remove sql-project from the list' }),
    )

    expect(commands.workspaceRecentRemove).toHaveBeenCalledWith(
      '/work/sql-project',
    )
    expect(commands.workspaceOpen).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('button', { name: /sql-project/ }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^kept/ })).toBeInTheDocument()
  })

  test('shows the error message of a failed remove', async () => {
    useWorkspaceStore.setState({ recent: [recent()] })
    vi.mocked(commands.workspaceRecentRemove).mockResolvedValue({
      status: 'error',
      error: { kind: 'internal', message: 'The disk is full.' },
    } as never)
    render(<WelcomeScreen />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Remove sql-project from the list' }),
    )

    expect(screen.getByRole('alert')).toHaveTextContent('The disk is full.')
    expect(
      screen.getByRole('button', { name: /^sql-project/ }),
    ).toBeInTheDocument()
  })

  test('Ctrl+O opens the folder dialog', async () => {
    vi.mocked(open).mockResolvedValue(null)
    render(<WelcomeScreen />)

    await userEvent.keyboard('{Control>}o{/Control}')

    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ directory: true }),
    )
  })

  test('F1 and the button show the keyboard shortcuts', async () => {
    render(<WelcomeScreen />)

    await userEvent.keyboard('{F1}')
    expect(
      screen.getByRole('dialog', { name: 'Keyboard shortcuts' }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.click(
      screen.getByRole('button', { name: 'Keyboard shortcuts' }),
    )

    expect(
      screen.getByRole('dialog', { name: 'Keyboard shortcuts' }),
    ).toBeInTheDocument()
  })

  test('shows the error message of a failed open', () => {
    useWorkspaceStore.setState({ error: 'Not a directory.' })

    render(<WelcomeScreen />)

    expect(screen.getByRole('alert')).toHaveTextContent('Not a directory.')
  })
})

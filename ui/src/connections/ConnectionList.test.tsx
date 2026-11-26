import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { ConnectionEditor } from '../shell/ConnectionEditor'
import { resetShellStore } from '../shell/shellStore'
import { useTabsStore } from '../tabs/tabsStore'
import { makeProfile, makeWorkspace } from '../test/fixtures'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { ConnectionDetail } from './ConnectionDetail'
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
  useWorkspaceStore.setState({
    workspace: { ...makeWorkspace(connections), name: 'sql-project' },
  })
  render(
    <>
      <ConnectionList />
      <ConnectionEditor />
    </>,
  )
  return userEvent.setup()
}

const option = (name: RegExp | string) =>
  screen.getByRole('option', {
    name: typeof name === 'string' ? new RegExp(`^${name},`) : name,
  })

describe('ConnectionList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetShellStore()
    useWorkspaceStore.setState(initialWorkspaceState, true)
    useConnectionStore.setState({ tests: {} })
    useTabsStore.getState().reset()
    useTabsStore.getState().newTab()
  })

  test('without connections, the view says so and gives one action', () => {
    renderList([])

    expect(
      screen.getByText('This workspace has no connections.'),
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: 'New connection' }),
    ).not.toHaveLength(0)
  })

  test('groups the connections by environment, Production first', () => {
    renderList()

    const groups = screen
      .getAllByRole('group')
      .map((group) => group.getAttribute('aria-label'))
    expect(groups).toEqual(['Production', 'Development'])
    const local = option('Local')
    expect(local).toHaveAccessibleName('Local, Not tested')
    expect(local).toHaveTextContent('PostgreSQL · localhost/app')
    expect(screen.getByRole('status')).toHaveTextContent(
      '2 connections · 0 connected',
    )
  })

  test('the test of a row shows its status mark and its error', async () => {
    vi.mocked(commands.connectionTest).mockResolvedValue({
      status: 'ok',
      data: {
        status: 'failed',
        error: {
          kind: 'authentication',
          advice: 'Check the password.',
          detail: 'password refused',
        },
      },
    })
    const user = renderList([makeProfile()])

    // The row buttons are for the pointer. A screen reader uses Ctrl+Enter.
    await user.click(screen.getByLabelText('Test Local'))

    expect(
      await screen.findByRole('option', { name: 'Local, Failed' }),
    ).toHaveTextContent('Failed: password refused')
    expect(screen.getByRole('img', { name: 'Failed' })).toBeInTheDocument()
  })

  test('Delete asks first, and deletes only after the confirmation', async () => {
    vi.mocked(commands.connectionDelete).mockResolvedValue({
      status: 'ok',
      data: makeWorkspace([production]),
    })
    const user = renderList()
    option('Local').focus()

    await user.keyboard('{Delete}')
    expect(commands.connectionDelete).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: 'Delete connection' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(commands.connectionDelete).toHaveBeenCalledWith('id-1')
  })

  test('Cancel of the confirmation keeps the connection', async () => {
    const user = renderList()
    option('Local').focus()

    await user.keyboard('{Delete}')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(commands.connectionDelete).not.toHaveBeenCalled()
  })

  test('the context menu duplicates a connection', async () => {
    vi.mocked(commands.connectionDuplicate).mockResolvedValue({
      status: 'ok',
      data: makeWorkspace([
        makeProfile(),
        makeProfile({ id: 'id-3', name: 'Local (copy)' }),
      ]),
    })
    const user = renderList([makeProfile()])
    option('Local').focus()

    await user.keyboard('{Shift>}{F10}{/Shift}')
    await user.click(screen.getByRole('menuitem', { name: /Duplicate/ }))

    expect(commands.connectionDuplicate).toHaveBeenCalledWith('id-1')
  })

  test('Space shows the detail in a preview tab, and Enter connects the current tab', async () => {
    const user = renderList()
    option('Local').focus()

    await user.keyboard(' ')
    const detail = useTabsStore
      .getState()
      .tabs.find((tab) => tab.detail?.kind === 'connection')
    expect(detail).toMatchObject({ title: 'Local', isPreview: true })

    await user.keyboard('{Enter}')
    const sql = useTabsStore
      .getState()
      .tabs.find((tab) => tab.detail === undefined)
    expect(sql?.connectionId).toBe('id-1')
  })

  test('the primary action opens the form for a new connection', async () => {
    vi.mocked(commands.connectionTemplate).mockResolvedValue(
      makeProfile({ id: 'new-id', name: '', database: '', user: '' }),
    )
    const user = renderList([])

    await user.click(
      screen.getAllByRole('button', { name: 'New connection' })[0],
    )

    expect(
      await screen.findByRole('dialog', { name: 'New connection' }),
    ).toBeInTheDocument()
  })
})

describe('ConnectionDetail', () => {
  beforeEach(() => {
    useConnectionStore.setState({ tests: {} })
  })

  test('shows the facts without the password, and the error of the last test', () => {
    useWorkspaceStore.setState({ workspace: makeWorkspace([makeProfile()]) })
    useConnectionStore.setState({
      tests: {
        'id-1': {
          status: 'failed',
          error: {
            kind: 'authentication',
            advice: 'Edit the password.',
            detail: 'FATAL: password',
          },
          at: Date.now() / 1000 - 120,
        },
      },
    })

    render(<ConnectionDetail id="id-1" />)

    expect(screen.getByRole('heading', { name: 'Local' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      /The test failed 2 minutes ago/,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('FATAL: password')
    expect(screen.getByText('Server').nextElementSibling).toHaveTextContent(
      'localhost:5432',
    )
    expect(screen.getByRole('button', { name: 'Test again' })).toBeEnabled()
  })
})

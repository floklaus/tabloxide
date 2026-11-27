import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { ResultsPane } from '../results/ResultsPane'
import { makeProfile, makeWorkspace } from '../test/fixtures'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { QueryEditor } from './QueryEditor'
import { switchConnection } from '../shell/commands'
import { useTabsStore, type Tab } from '../tabs/tabsStore'
import { resetQueryStores } from './queryStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('../editor/CodeEditor', () => import('../test/FakeCodeEditor'))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))

const sessionOpen = vi.mocked(commands.sessionOpen)
const queryRun = vi.mocked(commands.queryRun)
const queryCancel = vi.mocked(commands.queryCancel)
const fileWrite = vi.mocked(commands.fileWrite)
const tab: Tab = {
  id: 'tab-1',
  title: 'Query 1',
  path: null,
  content: '',
  savedContent: null,
  connectionId: null,
}
const initialWorkspaceState = useWorkspaceStore.getState()
const live = makeProfile({
  id: 'id-2',
  name: 'Live',
  environment: 'production',
})

function ok<T>(data: T) {
  return { status: 'ok' as const, data }
}

function renderEditor() {
  useWorkspaceStore.setState({
    workspace: makeWorkspace([makeProfile(), live]),
  })
  render(
    <>
      <QueryEditor />
      <ResultsPane />
    </>,
  )
  return userEvent.setup()
}

async function connect(_user: ReturnType<typeof userEvent.setup>) {
  sessionOpen.mockResolvedValue(
    ok({
      status: 'connected',
      session: {
        id: 7,
        connection_id: 'id-2',
        database: 'app',
        server: { version: '17.2' },
      },
    }),
  )
  await act(async () => switchConnection('id-2'))
  await screen.findByText('PostgreSQL 17.2')
}

describe('QueryEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkspaceStore.setState(initialWorkspaceState, true)
    resetQueryStores()
    useTabsStore.setState({
      tabs: [tab],
      activeId: tab.id,
      isLoaded: true,
      error: null,
    })
  })

  test('disables the run buttons without a connection', () => {
    renderEditor()

    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Run all' })).toBeDisabled()
    expect(
      screen.getByText('Select a connection, then run a statement.'),
    ).toBeInTheDocument()
  })

  test('connects and shows the server version', async () => {
    const user = renderEditor()

    await connect(user)

    // The title bar shows the environment. Refer to the shell tests.
    expect(sessionOpen).toHaveBeenCalledWith('id-2')
    expect(screen.getByText('PostgreSQL 17.2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled()
  })

  test('shows the failure and the advice when the connect fails', async () => {
    renderEditor()
    sessionOpen.mockResolvedValue(
      ok({
        status: 'failed',
        error: {
          kind: 'authentication',
          advice: 'Check the user and the password.',
          detail: 'password authentication failed',
        },
      }),
    )

    await act(async () => switchConnection('id-2'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'password authentication failed',
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Check the user')
  })

  test('connects at the first run when the tab has a connection from the last session', async () => {
    useTabsStore.setState({
      tabs: [{ ...tab, content: 'select 1', connectionId: 'id-2' }],
    })
    const user = renderEditor()
    sessionOpen.mockResolvedValue(
      ok({
        status: 'connected',
        session: {
          id: 7,
          connection_id: 'id-2',
          database: 'app',
          server: { version: '17.2' },
        },
      }),
    )
    queryRun.mockResolvedValue(ok({ statements: [], open_result: null }))

    expect(screen.getByText('Connects at the first run')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Run all' }))

    expect(sessionOpen).toHaveBeenCalledWith('id-2')
    expect(queryRun).toHaveBeenCalledWith(7, 'select 1', { type: 'all' })
  })

  test('shows a marker for unsaved changes and saves a file tab with Ctrl+S', async () => {
    useTabsStore.setState({
      tabs: [
        {
          ...tab,
          title: 'a.sql',
          path: 'q/a.sql',
          content: 'x',
          savedContent: 'x',
        },
      ],
    })
    const user = renderEditor()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await user.type(screen.getByRole('textbox', { name: 'SQL' }), 'y')
    expect(screen.getByLabelText('Unsaved changes')).toBeInTheDocument()
    await user.keyboard('{Control>}s{/Control}')

    expect(fileWrite).toHaveBeenCalledWith('q/a.sql', 'xy')
    expect(screen.queryByLabelText('Unsaved changes')).not.toBeInTheDocument()
  })

  test('runs the statement at the cursor with Ctrl+Enter', async () => {
    const user = renderEditor()
    await connect(user)
    queryRun.mockResolvedValue(ok({ statements: [], open_result: null }))

    await user.type(screen.getByRole('textbox', { name: 'SQL' }), 'select 1')
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(queryRun).toHaveBeenCalledWith(7, 'select 1', {
      type: 'at',
      offset: 8,
    })
  })

  test('runs the selection when text is selected', async () => {
    const user = renderEditor()
    await connect(user)
    queryRun.mockResolvedValue(ok({ statements: [], open_result: null }))
    const input = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'SQL',
    })

    await user.type(input, 'select 1; select 2')
    input.setSelectionRange(10, 18)
    await user.click(screen.getByRole('button', { name: 'Run' }))

    expect(queryRun).toHaveBeenCalledWith(7, 'select 1; select 2', {
      type: 'range',
      from: 10,
      to: 18,
    })
  })

  test('runs all statements with the Run all button', async () => {
    const user = renderEditor()
    await connect(user)
    queryRun.mockResolvedValue(ok({ statements: [], open_result: null }))

    await user.type(screen.getByRole('textbox', { name: 'SQL' }), 'select 1')
    await user.click(screen.getByRole('button', { name: 'Run all' }))

    expect(queryRun).toHaveBeenCalledWith(7, 'select 1', { type: 'all' })
    expect(
      await screen.findByText('There is no statement to run.'),
    ).toBeInTheDocument()
  })

  test('cancels a run that is in progress', async () => {
    const user = renderEditor()
    await connect(user)
    queryRun.mockReturnValue(new Promise(() => {}))

    await user.click(screen.getByRole('button', { name: 'Run all' }))
    expect(await screen.findByText('Running…')).toBeInTheDocument()
    // The editor bar and the results have a Cancel button. The first is in the bar.
    await user.click(screen.getAllByRole('button', { name: 'Cancel' })[0])

    expect(queryCancel).toHaveBeenCalledWith(7)
    expect(await screen.findByText('Cancelling…')).toBeInTheDocument()
  })

  test('shows the results of a script and the error position', async () => {
    const user = renderEditor()
    await connect(user)
    queryRun.mockResolvedValue(
      ok({
        open_result: null,
        statements: [
          {
            range: { from: 0, to: 18 },
            elapsed_ms: 4,
            outcome: { type: 'command', affected_rows: 3 },
          },
          {
            range: { from: 20, to: 32 },
            elapsed_ms: 1,
            outcome: {
              type: 'failed',
              error: {
                kind: 'database',
                message: 'column "idd" does not exist',
                detail: null,
                hint: 'Perhaps you meant "id".',
                code: '42703',
                position: 8,
              },
              location: { offset: 27, line: 1, column: 28 },
            },
          },
        ],
      }),
    )
    const input = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'SQL',
    })
    await user.type(input, 'update t set a = 1; select idd t')

    await user.click(screen.getByRole('button', { name: 'Run all' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'column "idd" does not exist',
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Error code: 42703')
    const statements = screen.getByRole('list', {
      name: 'Statements of the run',
    })
    expect(statements).toHaveTextContent('update t set a = 1')
    expect(statements).toHaveTextContent('3 rows')
    expect(statements).toHaveTextContent('Failed')

    await user.click(
      screen.getByRole('button', { name: 'Go to line 1, column 28' }),
    )
    expect(input).toHaveFocus()
    expect(input.selectionStart).toBe(27)

    await user.click(screen.getByRole('button', { name: /update t set/ }))
    expect(screen.getByText(/3 rows affected/)).toBeInTheDocument()
  })

  test('saves the text of the tab as a snippet of the workspace', async () => {
    useTabsStore.setState({
      tabs: [{ ...tab, content: 'select * from item' }],
    })
    fileWrite.mockResolvedValue(ok(null))
    const user = renderEditor()

    await user.click(screen.getByRole('button', { name: 'More query actions' }))
    await user.click(screen.getByRole('menuitem', { name: /Save as snippet/ }))
    const dialog = screen.getByRole('dialog', { name: 'Save as snippet' })
    expect(dialog).toHaveTextContent('select * from item')
    await user.type(screen.getByLabelText('Name'), 'all items')
    await user.type(screen.getByLabelText('Description'), 'Every item')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(fileWrite).toHaveBeenCalledWith(
      '.tabloxide/snippets/all items.sql',
      '-- Every item\nselect * from item\n',
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('shows the version of DuckDB without the name PostgreSQL', async () => {
    const duck = makeProfile({
      id: 'id-3',
      name: 'Duck',
      engine: 'duckdb',
      database: ':memory:',
    })
    useWorkspaceStore.setState({ workspace: makeWorkspace([duck]) })
    render(<QueryEditor />)
    sessionOpen.mockResolvedValue(
      ok({
        status: 'connected',
        session: {
          id: 9,
          connection_id: 'id-3',
          database: ':memory:',
          server: { version: 'DuckDB v2.0.0' },
        },
      }),
    )

    await act(async () => switchConnection('id-3'))

    expect(await screen.findByText('DuckDB v2.0.0')).toBeInTheDocument()
    expect(screen.queryByText(/PostgreSQL/)).not.toBeInTheDocument()
  })

  test('shows the MongoDB version and switches the editor to the MongoDB syntax', async () => {
    const mongo = makeProfile({
      id: 'id-4',
      name: 'Docs',
      engine: 'mongodb',
      port: 27017,
    })
    useWorkspaceStore.setState({ workspace: makeWorkspace([mongo]) })
    render(<QueryEditor />)
    sessionOpen.mockResolvedValue(
      ok({
        status: 'connected',
        session: {
          id: 10,
          connection_id: 'id-4',
          database: 'app',
          server: { version: '8.0.4' },
        },
      }),
    )

    await act(async () => switchConnection('id-4'))

    expect(await screen.findByText('MongoDB 8.0.4')).toBeInTheDocument()
    expect(
      await screen.findByRole('textbox', { name: 'MongoDB statements' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'SQL' })).toBeNull()
  })
})

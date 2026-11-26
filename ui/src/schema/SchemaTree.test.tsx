import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest'
import { commands } from '../bindings'
import { useResultsViewStore } from '../results/resultsViewStore'
import { makeProfile, makeWorkspace } from '../test/fixtures'
import { useTabsStore } from '../tabs/tabsStore'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { SchemaTree } from './SchemaTree'
import { useSchemaStore } from './schemaStore'
import { TableDetail } from './TableDetail'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))

const sessionOpen = vi.mocked(commands.sessionOpen)
const schemaList = vi.mocked(commands.schemaList)
const schemaRelations = vi.mocked(commands.schemaRelations)
const schemaRelationDetail = vi.mocked(commands.schemaRelationDetail)
const schemaSample = vi.mocked(commands.schemaSample)
const initialWorkspaceState = useWorkspaceStore.getState()

// jsdom has no layout. The virtual list reads these sizes to decide which rows to render.
const original = Object.getOwnPropertyDescriptors(Element.prototype)

beforeAll(() => {
  for (const [name, value] of [
    ['clientHeight', 480],
    ['clientWidth', 300],
  ] as const) {
    Object.defineProperty(Element.prototype, name, {
      configurable: true,
      get: () => value,
    })
  }
})

afterAll(() => {
  Object.defineProperty(
    Element.prototype,
    'clientHeight',
    original.clientHeight,
  )
  Object.defineProperty(Element.prototype, 'clientWidth', original.clientWidth)
})

/** Sets the connection of the active tab. The schema browser follows it. */
function setTabConnection(connectionId: string | null) {
  useTabsStore.setState({
    tabs: [
      {
        id: 'tab-1',
        title: 'Query 1',
        path: null,
        content: '',
        savedContent: null,
        connectionId,
      },
    ],
    activeId: 'tab-1',
  })
}

function ok<T>(data: T) {
  return { status: 'ok' as const, data }
}

const detail = {
  columns: [
    {
      name: 'id',
      data_type: 'integer',
      is_nullable: false,
      default: null,
      is_primary_key: true,
    },
    {
      name: 'note',
      data_type: 'text',
      is_nullable: true,
      default: "'x'::text",
      is_primary_key: false,
    },
  ],
  indexes: [
    {
      name: 'item_pkey',
      definition: 'CREATE UNIQUE INDEX item_pkey ON item (id)',
      is_unique: true,
      is_primary: true,
    },
  ],
  constraints: [
    {
      name: 'item_check',
      kind: 'check' as const,
      definition: 'CHECK (id > 0)',
    },
  ],
  columns_from_sample: false,
}

async function connect() {
  useWorkspaceStore.setState({ workspace: makeWorkspace([makeProfile()]) })
  sessionOpen.mockResolvedValue(
    ok({
      status: 'connected',
      session: {
        id: 3,
        connection_id: 'id-1',
        database: 'shop',
        server: { version: '17' },
      },
    }),
  )
  schemaList.mockResolvedValue(
    ok([
      { name: 'public', is_system: false },
      { name: 'pg_catalog', is_system: true },
    ]),
  )
  render(
    <>
      <SchemaTree />
      <TableDetail />
    </>,
  )
  const user = userEvent.setup()
  act(() => setTabConnection('id-1'))
  await screen.findByRole('button', { name: /public/ })
  return user
}

describe('SchemaTree', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkspaceStore.setState(initialWorkspaceState, true)
    useSchemaStore.getState().reset()
    setTabConnection(null)
    useResultsViewStore.getState().setView('results')
    schemaRelations.mockResolvedValue(
      ok([
        { name: 'item', kind: 'table' },
        { name: 'item_view', kind: 'view' },
        { name: 'orders', kind: 'table' },
      ]),
    )
    schemaRelationDetail.mockResolvedValue(ok(detail))
  })

  test('opens its own session and shows the database and the schemas', async () => {
    await connect()

    expect(sessionOpen).toHaveBeenCalledWith('id-1')
    expect(schemaList).toHaveBeenCalledWith(3)
    expect(screen.getByRole('heading', { name: 'Schema' })).toBeInTheDocument()
    expect(screen.getByText('shop')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pg_catalog/ })).toHaveAttribute(
      'data-system',
      'true',
    )
    expect(schemaRelations).not.toHaveBeenCalled()
  })

  test('shows the error when the connection fails', async () => {
    useWorkspaceStore.setState({ workspace: makeWorkspace([makeProfile()]) })
    sessionOpen.mockResolvedValue(
      ok({
        status: 'failed',
        error: {
          kind: 'unreachable',
          advice: 'Check the host.',
          detail: 'refused',
        },
      }),
    )
    render(<SchemaTree />)

    act(() => setTabConnection('id-1'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'refused Check the host.',
    )
  })

  test('loads the tables of a schema only when the user opens it', async () => {
    const user = await connect()

    await user.click(screen.getByRole('button', { name: /public/ }))

    expect(
      await screen.findByRole('button', { name: 'orders' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'item_view view' }),
    ).toHaveTextContent('view')
    expect(schemaRelations).toHaveBeenCalledTimes(1)
    expect(schemaRelations).toHaveBeenCalledWith(3, 'public')
  })

  test('filters the tables', async () => {
    const user = await connect()
    await user.click(screen.getByRole('button', { name: /public/ }))
    await screen.findByRole('button', { name: 'orders' })

    await user.type(screen.getByRole('searchbox'), 'ord')

    expect(screen.getByRole('button', { name: 'orders' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'item' }),
    ).not.toBeInTheDocument()
  })

  test('shows the columns of a table in the tree', async () => {
    const user = await connect()
    await user.click(screen.getByRole('button', { name: /public/ }))

    await user.click(
      await screen.findByRole('button', { name: 'Columns of item' }),
    )

    expect(
      await screen.findByText('integer, primary key, not null'),
    ).toBeInTheDocument()
    expect(schemaRelationDetail).toHaveBeenCalledWith(3, 'public', 'item')
  })

  test('shows the structure and a row sample when the user selects a table', async () => {
    const user = await connect()
    schemaSample.mockResolvedValue(
      ok({
        range: { from: 0, to: 10 },
        elapsed_ms: 2,
        outcome: {
          type: 'rows',
          columns: [{ name: 'id', type_name: 'int4', kind: 'number' }],
          rows: [['1'], ['2']],
          is_complete: true,
          total_rows: 2,
        },
      }),
    )
    await user.click(screen.getByRole('button', { name: /public/ }))

    await user.click(await screen.findByRole('button', { name: 'orders' }))

    expect(
      await screen.findByRole('heading', { name: 'public.orders' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('table', { name: 'Columns' }),
    ).toHaveTextContent('note' + 'text' + 'yes' + "'x'::text")
    expect(screen.getByRole('table', { name: 'Indexes' })).toHaveTextContent(
      'item_pkey',
    )
    expect(
      screen.getByRole('table', { name: 'Constraints' }),
    ).toHaveTextContent('CheckCHECK (id > 0)')
    expect(await screen.findByText(/The first 2 rows/)).toBeInTheDocument()
    expect(schemaSample).toHaveBeenCalledWith(3, 'public', 'orders')
    expect(useResultsViewStore.getState().view).toBe('table')
  })

  test('shows the error of a failed row sample', async () => {
    const user = await connect()
    schemaSample.mockResolvedValue({
      status: 'error',
      error: {
        kind: 'query',
        message: 'permission denied for table orders',
        issues: [],
      },
    })
    await user.click(screen.getByRole('button', { name: /public/ }))

    await user.click(await screen.findByRole('button', { name: 'orders' }))

    expect(
      await screen.findByText('permission denied for table orders'),
    ).toBeInTheDocument()
  })

  test('reads the open nodes again with the refresh button', async () => {
    const user = await connect()
    await user.click(screen.getByRole('button', { name: /public/ }))
    await screen.findByRole('button', { name: 'orders' })
    schemaRelations.mockResolvedValue(
      ok([{ name: 'new_table', kind: 'table' }]),
    )

    await user.click(
      screen.getByRole('button', { name: 'Read the schema again' }),
    )

    expect(
      await screen.findByRole('button', { name: 'new_table' }),
    ).toBeInTheDocument()
    expect(schemaList).toHaveBeenCalledTimes(2)
    expect(
      screen.queryByRole('button', { name: 'orders' }),
    ).not.toBeInTheDocument()
  })

  test('renders only the visible rows of a schema with 5000 tables', async () => {
    const user = await connect()
    const many = Array.from({ length: 5000 }, (_, index) => ({
      name: `table_${String(index).padStart(4, '0')}`,
      kind: 'table' as const,
    }))
    schemaRelations.mockResolvedValue(ok(many))

    await user.click(screen.getByRole('button', { name: /public/ }))

    expect(
      await screen.findByRole('button', { name: 'table_0000' }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').length).toBeLessThan(60)
    expect(
      screen.queryByRole('button', { name: 'table_4999' }),
    ).not.toBeInTheDocument()

    await user.type(screen.getByRole('searchbox'), '4999')
    expect(
      await screen.findByRole('button', { name: 'table_4999' }),
    ).toBeInTheDocument()
  })

  test('closes its session when the tab has no connection', async () => {
    await connect()

    act(() => setTabConnection(null))

    await waitFor(() => expect(commands.sessionClose).toHaveBeenCalledWith(3))
    expect(
      screen.queryByRole('button', { name: /public/ }),
    ).not.toBeInTheDocument()
  })
})

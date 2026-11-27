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
import { useShellStore } from '../shell/shellStore'
import { useTabsStore } from '../tabs/tabsStore'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { SchemaTree } from './SchemaTree'
import { useSchemaStore } from './schemaStore'
import { DetailView } from '../tabs/DetailView'

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

/** The detail tab of the editor area that is active, as the editor shows it. */
function ActiveDetail() {
  const detail = useTabsStore(
    (state) => state.tabs.find((tab) => tab.id === state.activeId)?.detail,
  )
  return detail ? <DetailView detail={detail} /> : null
}

/** The tree item of a schema, a table, or a column, by its name. */
function queryNode(name: string): HTMLElement | null {
  const label = screen
    .queryAllByText(name, { selector: '.view-row__label' })
    .at(0)
  return label?.closest<HTMLElement>('[role="treeitem"]') ?? null
}

function node(name: string): HTMLElement {
  const found = queryNode(name)
  if (!found) throw new Error(`No tree item ${name}`)
  return found
}

async function findNode(name: string): Promise<HTMLElement> {
  await screen.findAllByText(name, { selector: '.view-row__label' })
  return node(name)
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
      <ActiveDetail />
    </>,
  )
  const user = userEvent.setup()
  act(() => setTabConnection('id-1'))
  await findNode('public')
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
    // The scope names the connection and the database.
    expect(screen.getByRole('button', { name: /^Scope: / })).toHaveTextContent(
      /› shop$/,
    )
    expect(
      node('pg_catalog').querySelector('.view-row__label')!,
    ).toHaveAttribute('data-system', 'true')
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

    await user.click(node('public'))

    expect(await findNode('orders')).toBeInTheDocument()
    expect(node('item_view')).toHaveTextContent('view')
    expect(schemaRelations).toHaveBeenCalledTimes(1)
    expect(schemaRelations).toHaveBeenCalledWith(3, 'public')
  })

  test('filters the tables', async () => {
    const user = await connect()
    await user.click(node('public'))
    await findNode('orders')

    await user.type(screen.getByRole('searchbox'), 'ord')

    expect(node('orders')).toBeInTheDocument()
    expect(queryNode('item')).not.toBeInTheDocument()
  })

  test('shows the columns of a table in the tree', async () => {
    const user = await connect()
    await user.click(node('public'))

    // The chevron opens the node. A click on the row shows the detail.
    const item = await findNode('item')
    await user.click(item.querySelector('.view-row__chevron')!)

    const column = await findNode('id')
    expect(column).toHaveAttribute('aria-level', '3')
    expect(column).toHaveTextContent('integer')
    expect(column.querySelector('[aria-label="Primary key"]')).not.toBeNull()
    expect(item).toHaveAttribute('aria-expanded', 'true')
    expect(schemaRelationDetail).toHaveBeenCalledWith(3, 'public', 'item')
  })

  test('shows the structure and a row sample when the user selects a table', async () => {
    const user = await connect()
    schemaSample.mockResolvedValue(
      ok({
        range: { from: 0, to: 10 },
        elapsed_ms: 2,
        messages: [],
        outcome: {
          type: 'rows',
          columns: [{ name: 'id', type_name: 'int4', kind: 'number' }],
          rows: [['1'], ['2']],
          is_complete: true,
          total_rows: 2,
        },
      }),
    )
    await user.click(node('public'))

    await user.click(await findNode('orders'))

    expect(
      await screen.findByRole('heading', { name: 'public.orders' }),
    ).toBeInTheDocument()
    // A click opens the table in a preview tab. A double click keeps the tab.
    const opened = () =>
      useTabsStore.getState().tabs.find((tab) => tab.detail?.kind === 'table')
    expect(opened()?.isPreview).toBe(true)
    await user.dblClick(node('orders'))
    expect(opened()?.isPreview).toBe(false)
    expect(
      await screen.findByRole('table', { name: /^Columns/ }),
    ).toHaveTextContent('note' + 'text' + 'yes' + "'x'::text")
    expect(screen.getByRole('table', { name: /^Indexes/ })).toHaveTextContent(
      'item_pkey',
    )
    expect(
      screen.getByRole('table', { name: /^Constraints/ }),
    ).toHaveTextContent('CheckCHECK (id > 0)')
    await user.click(screen.getByRole('tab', { name: 'Rows' }))
    expect(await screen.findByText(/The first 2 rows/)).toBeInTheDocument()
    expect(schemaSample).toHaveBeenCalledWith(3, 'public', 'orders')
    // The detail goes to a tab of the editor area. The results pane does not change.
    expect(useResultsViewStore.getState().view).toBe('results')
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
    await user.click(node('public'))

    await user.click(await findNode('orders'))
    await user.click(await screen.findByRole('tab', { name: 'Rows' }))

    expect(
      await screen.findByText('permission denied for table orders'),
    ).toBeInTheDocument()
  })

  test('reads the open nodes again with the refresh button', async () => {
    const user = await connect()
    await user.click(node('public'))
    await findNode('orders')
    schemaRelations.mockResolvedValue(
      ok([{ name: 'new_table', kind: 'table' }]),
    )

    await user.click(
      screen.getByRole('button', { name: 'Read the schema again' }),
    )

    expect(await findNode('new_table')).toBeInTheDocument()
    expect(schemaList).toHaveBeenCalledTimes(2)
    expect(queryNode('orders')).not.toBeInTheDocument()
  })

  test('renders only the visible rows of a schema with 5000 tables', async () => {
    const user = await connect()
    const many = Array.from({ length: 5000 }, (_, index) => ({
      name: `table_${String(index).padStart(4, '0')}`,
      kind: 'table' as const,
    }))
    schemaRelations.mockResolvedValue(ok(many))

    await user.click(node('public'))

    expect(await findNode('table_0000')).toBeInTheDocument()
    expect(screen.getAllByRole('treeitem').length).toBeLessThan(60)
    expect(queryNode('table_4999')).not.toBeInTheDocument()

    await user.type(screen.getByRole('searchbox'), '4999')
    expect(await findNode('table_4999')).toBeInTheDocument()
  })

  test('closes its session when the tab has no connection', async () => {
    await connect()

    act(() => setTabConnection(null))

    await waitFor(() => expect(commands.sessionClose).toHaveBeenCalledWith(3))
    expect(queryNode('public')).not.toBeInTheDocument()
  })

  test('the menu of a table has the AI actions and does not read rows', async () => {
    const user = await connect()
    vi.mocked(commands.assistantAsk).mockResolvedValue({
      status: 'ok',
      data: {
        status: 'done',
        outcome: {
          stop: 'complete',
          model: 'claude-opus-5-5',
          input_tokens: 1,
          output_tokens: 1,
        },
        text: 'Each row is one order.',
      },
    })
    const { useAssistantStore } = await import('../assistant/assistantStore')
    useAssistantStore.getState().reset()
    useAssistantStore.setState({ hasKey: true })
    await user.click(node('public'))

    await user.click(
      await screen.findByRole('button', { name: 'Actions for orders' }),
    )
    const menu = screen.getByRole('menu', {
      name: 'Actions for public.orders',
    })
    // The menu is not in the row, so the row does not cut it.
    expect(menu.closest('.schema__row')).toBeNull()
    const explain = screen.getByRole('menuitem', { name: /Explain the table/ })
    expect(explain.querySelector('.menu__ai svg')).not.toBeNull()
    await user.click(explain)

    expect(commands.assistantAsk).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'explain-table',
        messages: [
          expect.objectContaining({
            context: { type: 'relation', schema: 'public', name: 'orders' },
          }),
        ],
      }),
      expect.anything(),
    )
    expect(schemaSample).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('menu', { name: 'Actions for public.orders' }),
    ).not.toBeInTheDocument()
  })

  test('without a connection, the view says why and gives one action', async () => {
    useWorkspaceStore.setState({ workspace: makeWorkspace([makeProfile()]) })
    render(<SchemaTree />)

    expect(screen.getByText(/The tab has no connection/)).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'Select a connection' }),
    )
    expect(useShellStore.getState().sidebarView).toBe('connections')
  })

  test('the error of a failed read has Try again, and the header stays', async () => {
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

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Cannot read the schema.')
    expect(screen.getByRole('heading', { name: 'Schema' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(sessionOpen).toHaveBeenCalledTimes(2)
  })

  test('Space shows a table in the preview tab, Enter keeps it, and Esc closes the preview', async () => {
    const user = await connect()
    await user.click(node('public'))
    await findNode('orders')
    const detailTab = () =>
      useTabsStore.getState().tabs.find((tab) => tab.detail?.kind === 'table')

    node('orders').focus()
    await user.keyboard(' ')
    expect(detailTab()).toMatchObject({ title: 'orders', isPreview: true })
    expect(node('orders')).toHaveFocus()
    expect(node('orders')).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{Escape}')
    expect(detailTab()).toBeUndefined()

    await user.keyboard('{Enter}')
    expect(detailTab()).toMatchObject({ title: 'orders', isPreview: false })
  })

  test('Right opens a node and type-ahead moves to a table', async () => {
    const user = await connect()
    node('public').focus()

    await user.keyboard('{ArrowRight}')
    await findNode('orders')
    await user.keyboard('{ArrowDown}o')

    expect(node('orders')).toHaveFocus()
  })
})

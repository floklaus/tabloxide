import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { activeQueryStore, resetQueryStores } from '../query/queryStore'
import type { Column, Row } from '../results/gridModel'
import { useTabsStore, type Tab } from '../tabs/tabsStore'
import { resetStatementNumbers } from './statementNumber'
import { serializeViewFile, type ViewFile } from './viewFile'
import { useViewFileStore } from './viewFileStore'
import { ViewHost } from './ViewHost'
import { useViewStore } from './viewStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('./chart/ChartCanvas', () => import('./chart/FakeChartCanvas'))

const fileList = vi.mocked(commands.fileList)
const fileRead = vi.mocked(commands.fileRead)
const fileWrite = vi.mocked(commands.fileWrite)
const queryPreview = vi.mocked(commands.queryPreview)

const COLUMNS: Column[] = [
  { name: 'country', type_name: 'text', kind: 'text' },
  { name: 'total', type_name: 'int4', kind: 'number' },
]
const ROWS: Row[] = [
  ['DE', '10'],
  ['FR', '20'],
]
const SQL = 'select country, total from sales'
const VIEW_PATH = 'reports/revenue.view.json'
const SAVED: ViewFile = {
  version: 1,
  views: [
    {
      name: 'Totals as a line',
      statement: 1,
      view: 'chart',
      settings: { type: 'line', x: 'country', y: ['total'] },
    },
    {
      name: 'Other statement',
      statement: 2,
      view: 'chart',
      settings: { type: 'area', x: 'country', y: ['total'] },
    },
  ],
}

function openTab(path: string | null) {
  const tab: Tab = {
    id: 'tab-1',
    title: 'revenue.sql',
    path,
    content: SQL,
    savedContent: path === null ? null : SQL,
    connectionId: null,
  }
  useTabsStore.setState({ tabs: [tab], activeId: tab.id, sqlId: tab.id })
  activeQueryStore().setState({ ranSql: SQL })
}

function onDisk(file: ViewFile | string) {
  fileList.mockResolvedValue({
    status: 'ok',
    data: [{ name: 'revenue.view.json', path: VIEW_PATH, is_directory: false }],
  })
  fileRead.mockResolvedValue({
    status: 'ok',
    data: typeof file === 'string' ? file : serializeViewFile(file),
  })
}

async function showChart() {
  render(
    <ViewHost
      statementFrom={0}
      runIndex={0}
      columns={COLUMNS}
      rows={ROWS}
      hasMore={false}
      onNeedMore={() => {}}
      isComplete
      totalRows={ROWS.length}
    />,
  )
  const chart = screen.getByRole('button', { name: 'Chart' })
  await waitFor(() => expect(chart).toBeEnabled())
  await waitFor(() => expect(fileList).toHaveBeenCalled())
  await userEvent.click(chart)
}

beforeEach(() => {
  vi.clearAllMocks()
  useTabsStore.getState().reset()
  resetQueryStores()
  useViewStore.getState().reset()
  useViewFileStore.getState().reset()
  resetStatementNumbers()
  queryPreview.mockResolvedValue([
    { range: { from: 0, to: SQL.length }, risk: null },
  ])
  fileList.mockResolvedValue({ status: 'ok', data: [] })
  fileWrite.mockResolvedValue({ status: 'ok', data: null })
})

describe('the saved views of a result', () => {
  test('a tab without a file says how to save the view', async () => {
    openTab(null)
    render(
      <ViewHost
        statementFrom={0}
        runIndex={0}
        columns={COLUMNS}
        rows={ROWS}
        hasMore={false}
        onNeedMore={() => {}}
        isComplete
        totalRows={ROWS.length}
      />,
    )
    const chart = screen.getByRole('button', { name: 'Chart' })
    await waitFor(() => expect(chart).toBeEnabled())

    await userEvent.click(chart)

    expect(
      screen.getByText('To save this view, save the query to a file first.'),
    ).toBeInTheDocument()
    expect(fileList).not.toHaveBeenCalled()
  })

  test('"Save as new view" writes the view to the file next to the query file', async () => {
    openTab('reports/revenue.sql')
    await showChart()

    await userEvent.type(
      screen.getByLabelText('Name of the view'),
      'Totals by country',
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Save as new view' }),
    )

    await waitFor(() => expect(fileWrite).toHaveBeenCalled())
    expect(fileWrite).toHaveBeenCalledWith(
      VIEW_PATH,
      serializeViewFile({
        version: 1,
        views: [
          {
            name: 'Totals by country',
            statement: 1,
            view: 'chart',
            settings: { type: 'bar', x: 'country', y: ['total'] },
          },
        ],
      }),
    )
    await waitFor(() =>
      expect(activeQueryStore().getState().notice).toBe(
        'Saved the view "Totals by country" to revenue.view.json.',
      ),
    )
    expect(await screen.findByLabelText('Saved view')).toHaveValue(
      'Totals by country',
    )
  })

  test('a view without a name cannot be saved', async () => {
    openTab('reports/revenue.sql')
    await showChart()

    expect(
      screen.getByRole('button', { name: 'Save as new view' }),
    ).toBeDisabled()
  })

  test('the chart starts with the first saved view of the statement', async () => {
    openTab('reports/revenue.sql')
    onDisk(SAVED)

    await showChart()

    expect(screen.getByRole('img')).toHaveAttribute('data-type', 'line')
    expect(screen.getByLabelText('Saved view')).toHaveValue('Totals as a line')
    expect(
      screen.queryByRole('option', { name: 'Other statement' }),
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText('Name of the view')).toHaveValue(
      'Totals as a line',
    )
  })

  test('"Save view" replaces the saved view with the settings that the chart shows', async () => {
    openTab('reports/revenue.sql')
    onDisk(SAVED)
    await showChart()
    await userEvent.selectOptions(screen.getByLabelText('Chart type'), 'area')

    await userEvent.click(screen.getByRole('button', { name: 'Save view' }))

    await waitFor(() => expect(fileWrite).toHaveBeenCalled())
    const written = JSON.parse(fileWrite.mock.calls[0][1]) as ViewFile
    expect(written.views).toHaveLength(2)
    expect(written.views[0]).toEqual({
      name: 'Totals as a line',
      statement: 1,
      view: 'chart',
      settings: { type: 'area', x: 'country', y: ['total'] },
    })
  })

  test('"Remove view" removes the saved view from the file', async () => {
    openTab('reports/revenue.sql')
    onDisk(SAVED)
    await showChart()

    await userEvent.click(screen.getByRole('button', { name: 'Remove view' }))

    await waitFor(() => expect(fileWrite).toHaveBeenCalled())
    const written = JSON.parse(fileWrite.mock.calls[0][1]) as ViewFile
    expect(written.views.map((view) => view.name)).toEqual(['Other statement'])
    await waitFor(() =>
      expect(screen.queryByLabelText('Saved view')).not.toBeInTheDocument(),
    )
  })

  test('a view file that is not valid gives a message, and there is no save', async () => {
    openTab('reports/revenue.sql')
    onDisk('{')

    await showChart()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The application cannot use the view file revenue.view.json. The file is not valid JSON.',
    )
    expect(
      screen.queryByRole('button', { name: /Save (as new )?view/ }),
    ).toBeNull()
  })

  test('a write failure shows below the form', async () => {
    openTab('reports/revenue.sql')
    fileWrite.mockResolvedValue({
      status: 'error',
      error: { kind: 'workspace', message: 'The disk is full.', issues: [] },
    })
    await showChart()
    await userEvent.type(screen.getByLabelText('Name of the view'), 'A')

    await userEvent.click(
      screen.getByRole('button', { name: 'Save as new view' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The disk is full.',
    )
  })
})

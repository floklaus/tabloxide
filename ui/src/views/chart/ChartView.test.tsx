import { save } from '@tauri-apps/plugin-dialog'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../../bindings'
import { activeQueryStore, resetQueryStores } from '../../query/queryStore'
import type { Row } from '../../results/gridModel'
import type { ViewProps } from '../viewTypes'
import { ChartView } from './ChartView'
import { column } from './testColumns'

vi.mock('./ChartCanvas', () => import('./FakeChartCanvas'))
vi.mock('../../bindings', async () =>
  (await import('../../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }))

const saveDialog = vi.mocked(save)
const viewImageSave = vi.mocked(commands.viewImageSave)

const SALES = [
  column('country', 'text'),
  column('amount', 'number'),
  column('tax', 'number'),
]
const ROWS: Row[] = [
  ['DE', '10', '1'],
  ['FR', '20', '2'],
]

/** The radio button of a column in the list of a setting. */
function picked(setting: string, columnName: string) {
  const list = screen.getByRole('radiogroup', { name: setting })
  return within(list).getByRole('radio', {
    name: new RegExp(`^${columnName}`),
  })
}

function props(overrides: Partial<ViewProps> = {}): ViewProps {
  return {
    columns: SALES,
    rows: ROWS,
    hasMore: false,
    onNeedMore: vi.fn(),
    isComplete: true,
    totalRows: ROWS.length,
    settings: { type: 'bar', x: 'country', y: ['amount'] },
    onSettings: vi.fn(),
    ...overrides,
  }
}

describe('the chart of a result', () => {
  test('shows the chart of the settings with a text for a screen reader', () => {
    render(<ChartView {...props()} />)

    const chart = screen.getByRole('img')

    expect(chart).toHaveAccessibleName(
      'Bar chart. Horizontal axis: country. Vertical axis: amount. 1 series, 2 bars. The Grid view has the values.',
    )
  })

  test('without settings, it proposes a chart from the kinds of the columns', () => {
    const columns = [column('country', 'text'), column('amount', 'number')]

    render(
      <ChartView
        {...props({ columns, rows: [['DE', '1']], settings: undefined })}
      />,
    )

    expect(screen.getByRole('img')).toHaveAttribute('data-type', 'bar')
    expect(picked('Horizontal axis', 'country')).toBeChecked()
  })

  test('without a rule for the columns, it asks for the columns', () => {
    render(<ChartView {...props({ settings: undefined })} />)

    expect(
      screen.getByText('Select the column of the horizontal axis.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  test('a single value shows the number as text', () => {
    render(
      <ChartView
        {...props({
          columns: [column('orders', 'number')],
          rows: [['1284977']],
          totalRows: 1,
          settings: undefined,
        })}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('1,284,977')
    expect(screen.getByRole('figure')).toHaveTextContent('orders')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  test('a result without rows says that the chart has no data', () => {
    render(<ChartView {...props({ rows: [], totalRows: 0 })} />)

    expect(
      screen.getByText('The chart has no data to show.'),
    ).toBeInTheDocument()
  })
})

describe('the chart settings', () => {
  test('a new chart type goes to the host and keeps the columns', async () => {
    const view = props()
    render(<ChartView {...view} />)

    await userEvent.selectOptions(screen.getByLabelText('Chart type'), 'line')

    expect(view.onSettings).toHaveBeenCalledWith({
      type: 'line',
      x: 'country',
      y: ['amount'],
    })
  })

  test('a second column of the vertical axis goes to the host in the sequence of the result', async () => {
    const view = props({
      settings: { type: 'bar', x: 'country', y: ['tax'] },
    })
    render(<ChartView {...view} />)
    const picker = screen.getByRole('group', { name: 'Vertical axis' })

    await userEvent.click(
      within(picker).getByRole('checkbox', { name: /^amount/ }),
    )

    expect(view.onSettings).toHaveBeenCalledWith({
      type: 'bar',
      x: 'country',
      y: ['amount', 'tax'],
    })
  })

  test('the form shows only the parts that the chart type uses', () => {
    render(
      <ChartView
        {...props({ settings: { type: 'histogram', x: 'amount', y: [] } })}
      />,
    )

    expect(picked('Column', 'amount')).toBeChecked()
    expect(screen.queryByLabelText('Series')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Stacked')).not.toBeInTheDocument()
  })

  test('an aggregate and the stack go to the host', async () => {
    const view = props()
    render(<ChartView {...view} />)

    await userEvent.selectOptions(screen.getByLabelText('Aggregate'), 'mean')
    await userEvent.click(screen.getByLabelText('Stacked'))

    expect(view.onSettings).toHaveBeenNthCalledWith(1, {
      type: 'bar',
      x: 'country',
      y: ['amount'],
      aggregate: 'mean',
    })
    expect(view.onSettings).toHaveBeenNthCalledWith(2, {
      type: 'bar',
      x: 'country',
      y: ['amount'],
      stacked: true,
    })
  })
})

describe('settings that do not fit the result', () => {
  test('a column that the result does not have gives a message, and the settings do not change', () => {
    const view = props({
      settings: { type: 'bar', x: 'region', y: ['amount'] },
    })

    render(<ChartView {...view} />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The result does not have the column region of the chart settings.',
    )
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(view.onSettings).not.toHaveBeenCalled()
  })

  test('"Make a new chart" replaces the settings', async () => {
    const view = props({
      columns: [column('country', 'text'), column('amount', 'number')],
      settings: { type: 'bar', x: 'region', y: ['amount'] },
    })
    render(<ChartView {...view} />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Make a new chart' }),
    )

    expect(view.onSettings).toHaveBeenCalledWith({
      type: 'bar',
      x: 'country',
      y: ['amount'],
    })
  })

  test('settings that are not valid give the reason', () => {
    render(<ChartView {...props({ settings: { type: 'sankey' } })} />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The chart type "sankey" is not known.',
    )
  })
})

describe('the notes about the chart', () => {
  test('a result with more rows than the loaded rows says so', () => {
    render(<ChartView {...props({ totalRows: 5_000_000 })} />)

    expect(
      screen.getByText('Chart of the first 2 of 5,000,000 rows.'),
    ).toBeInTheDocument()
  })

  test('a complete result has no note', () => {
    render(<ChartView {...props()} />)

    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  test('the number of cells that are not numbers shows', () => {
    render(
      <ChartView
        {...props({
          rows: [
            ['DE', 'n/a', '1'],
            ['FR', '20', '2'],
          ],
        })}
      />,
    )

    expect(
      screen.getByText(
        '1 cell of the column amount is not a number. The chart does not show it.',
      ),
    ).toBeInTheDocument()
  })
})

describe('an open result', () => {
  test('"Load all rows" asks for the next rows until the result has no more', async () => {
    const onNeedMore = vi.fn()
    const open = props({
      hasMore: true,
      isComplete: false,
      totalRows: null,
      onNeedMore,
    })
    const { rerender } = render(<ChartView {...open} />)
    expect(
      screen.getByText(
        /Chart of the first 2 rows\. The result has more rows\./,
      ),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Load all rows' }))
    expect(onNeedMore).toHaveBeenCalledTimes(1)
    // While the rows load, the chart keeps the rows that it had.
    const more: Row[] = [...ROWS, ['IT', '30', '3']]
    rerender(<ChartView {...open} rows={more} />)
    expect(onNeedMore).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('img')).toHaveAttribute('data-points', '2')
    expect(screen.getByText(/3 rows loaded/)).toBeInTheDocument()

    rerender(
      <ChartView
        {...open}
        rows={more}
        hasMore={false}
        isComplete
        totalRows={3}
      />,
    )

    expect(onNeedMore).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('img')).toHaveAttribute('data-points', '3')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  test('"Stop" ends the load of the rows', async () => {
    const onNeedMore = vi.fn()
    const open = props({
      hasMore: true,
      isComplete: false,
      totalRows: null,
      onNeedMore,
    })
    const { rerender } = render(<ChartView {...open} />)
    await userEvent.click(screen.getByRole('button', { name: 'Load all rows' }))

    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    rerender(<ChartView {...open} rows={[...ROWS, ['IT', '30', '3']]} />)

    expect(onNeedMore).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('img')).toHaveAttribute('data-points', '3')
  })
})

describe('the image export', () => {
  const button = () => screen.getByRole('button', { name: 'Save image…' })
  const notice = () => activeQueryStore().getState().notice

  beforeEach(() => {
    vi.clearAllMocks()
    resetQueryStores()
    viewImageSave.mockResolvedValue({ status: 'ok', data: null })
  })

  test('saves a PNG image to the file that the user selected', async () => {
    saveDialog.mockResolvedValue('/home/user/revenue.png')
    render(<ChartView {...props()} />)

    await userEvent.click(button())

    await waitFor(() =>
      expect(viewImageSave).toHaveBeenCalledWith('/home/user/revenue.png', {
        format: 'png',
        base64: 'UE5H',
      }),
    )
    await waitFor(() =>
      expect(notice()).toBe(
        'Saved the image of the chart to /home/user/revenue.png.',
      ),
    )
  })

  test('a file name that ends with .svg gives an SVG image', async () => {
    saveDialog.mockResolvedValue('/home/user/Revenue.SVG')
    render(<ChartView {...props()} />)

    await userEvent.click(button())

    await waitFor(() =>
      expect(viewImageSave).toHaveBeenCalledWith('/home/user/Revenue.SVG', {
        format: 'svg',
        text: '<svg></svg>',
      }),
    )
  })

  test('a cancel of the dialog saves nothing', async () => {
    saveDialog.mockResolvedValue(null)
    render(<ChartView {...props()} />)

    await userEvent.click(button())

    expect(viewImageSave).not.toHaveBeenCalled()
    expect(notice()).toBeNull()
  })

  test('a failure of the write shows as a notice', async () => {
    saveDialog.mockResolvedValue('/home/user/revenue.png')
    viewImageSave.mockResolvedValue({
      status: 'error',
      error: { kind: 'workspace', message: 'The disk is full.', issues: [] },
    })
    render(<ChartView {...props()} />)

    await userEvent.click(button())

    await waitFor(() =>
      expect(notice()).toBe('The image export failed: The disk is full.'),
    )
  })

  test('a single value has no image', () => {
    render(
      <ChartView
        {...props({
          columns: [column('orders', 'number')],
          rows: [['7']],
          totalRows: 1,
          settings: undefined,
        })}
      />,
    )

    expect(button()).toBeDisabled()
  })
})

describe('the sentence above the chart', () => {
  test('says what the chart shows and how many rows it has', () => {
    render(<ChartView {...props()} />)

    expect(
      screen.getByText('amount against country, one bar for each row.'),
    ).toBeInTheDocument()
    expect(screen.getByText('2 rows in 2 bars.')).toBeInTheDocument()
  })
})

describe('the automatic aggregate', () => {
  const repeats: Row[] = [
    ['DE', '10', '1'],
    ['DE', '5', '2'],
    ['FR', '20', '2'],
  ]

  test('the chart shows the sum when the values of the horizontal axis repeat, and the form says so', () => {
    render(<ChartView {...props({ rows: repeats, totalRows: 3 })} />)

    expect(
      screen.getByText('Sum of amount for each country.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAttribute('data-points', '2')
    expect(
      screen.getByRole('option', { name: 'Automatic (Sum)' }),
    ).toBeInTheDocument()
  })

  test('"Show each row" sets the aggregate to None', async () => {
    const view = props({ rows: repeats, totalRows: 3 })
    render(<ChartView {...view} />)

    await userEvent.click(screen.getByRole('button', { name: 'Show each row' }))

    expect(view.onSettings).toHaveBeenCalledWith({
      type: 'bar',
      x: 'country',
      y: ['amount'],
      aggregate: 'none',
    })
  })

  test('without a repeat, the form says that the chart shows each row', () => {
    render(<ChartView {...props()} />)

    expect(
      screen.getByRole('option', { name: 'Automatic (None)' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show each row' })).toBeNull()
  })
})

describe('the number of rows', () => {
  test('"Number of rows" replaces the columns of the vertical axis', async () => {
    const view = props()
    render(<ChartView {...view} />)
    const picker = screen.getByRole('group', { name: 'Vertical axis' })

    await userEvent.click(
      within(picker).getByRole('checkbox', { name: /^Number of rows/ }),
    )

    expect(view.onSettings).toHaveBeenCalledWith({
      type: 'bar',
      x: 'country',
      y: [],
      countRows: true,
    })
  })

  test('a chart of the number of rows has no aggregate control', () => {
    render(
      <ChartView
        {...props({
          settings: { type: 'bar', x: 'country', y: [], countRows: true },
        })}
      />,
    )

    expect(screen.queryByLabelText('Aggregate')).not.toBeInTheDocument()
    expect(
      screen.getByText('Number of rows for each country.'),
    ).toBeInTheDocument()
  })

  test('a result with only text columns gets a chart of the number of rows', () => {
    render(
      <ChartView
        {...props({
          columns: [column('country', 'text'), column('city', 'text')],
          rows: [
            ['DE', 'Bonn'],
            ['DE', 'Kiel'],
          ],
          settings: undefined,
        })}
      />,
    )

    expect(screen.getByRole('img')).toHaveAttribute('data-points', '1')
  })
})

describe('the controls of the horizontal axis', () => {
  const PAYMENTS = [column('paid', 'temporal'), column('amount', 'number')]
  const payments = (settings: object) =>
    props({
      columns: PAYMENTS,
      rows: [
        ['2026-01-15', '1'],
        ['2026-01-20', '2'],
      ],
      settings,
    })

  test('a date column has a time unit', async () => {
    const view = payments({ type: 'line', x: 'paid', y: ['amount'] })
    render(<ChartView {...view} />)

    await userEvent.selectOptions(screen.getByLabelText('Group by'), 'month')

    expect(view.onSettings).toHaveBeenCalledWith({
      type: 'line',
      x: 'paid',
      y: ['amount'],
      timeUnit: 'month',
    })
    expect(screen.queryByLabelText('Sort')).not.toBeInTheDocument()
  })

  test('a text column has a sort', async () => {
    const view = props()
    render(<ChartView {...view} />)

    await userEvent.selectOptions(
      screen.getByLabelText('Sort'),
      'By value, largest first',
    )

    expect(view.onSettings).toHaveBeenCalledWith({
      type: 'bar',
      x: 'country',
      y: ['amount'],
      sort: 'value-desc',
    })
    expect(screen.queryByLabelText('Group by')).not.toBeInTheDocument()
  })

  test('a different column removes a time unit that it cannot use', async () => {
    const view = payments({
      type: 'line',
      x: 'paid',
      y: ['amount'],
      timeUnit: 'month',
    })
    render(<ChartView {...view} />)

    await userEvent.click(picked('Horizontal axis', 'amount'))

    expect(view.onSettings).toHaveBeenCalledWith({
      type: 'line',
      x: 'amount',
      y: ['amount'],
    })
  })
})

describe('the column lists', () => {
  test('each column has the name of its kind for a screen reader, and the type name of the database', () => {
    const columns = [
      { name: 'paid', type_name: 'timestamptz', kind: 'temporal' as const },
      { name: 'amount', type_name: 'numeric', kind: 'number' as const },
    ]
    render(
      <ChartView
        {...props({
          columns,
          rows: [['2026-01-15', '1']],
          settings: { type: 'line', x: 'paid', y: ['amount'] },
        })}
      />,
    )
    const list = screen.getByRole('radiogroup', { name: 'Horizontal axis' })

    expect(
      within(list).getByRole('radio', { name: /^paid\s*, date$/ }),
    ).toBeChecked()
    expect(within(list).getByText('timestamptz')).toBeInTheDocument()
  })

  test('a warning about the cells of a column is at the control of that column', () => {
    render(
      <ChartView
        {...props({
          rows: [
            ['DE', 'n/a', '1'],
            ['FR', '20', '2'],
          ],
        })}
      />,
    )
    const warning = screen.getByText(
      '1 cell of the column amount is not a number. The chart does not show it.',
    )

    expect(warning.closest('.chart__field')).toHaveTextContent('Vertical axis')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
})

describe('the reset', () => {
  test('"Reset to the proposed chart" removes the settings', async () => {
    const view = props()
    render(<ChartView {...view} />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Reset to the proposed chart' }),
    )

    expect(view.onSettings).toHaveBeenCalledWith(undefined)
  })

  test('a chart without settings has no reset', () => {
    render(
      <ChartView
        {...props({
          columns: [column('country', 'text'), column('amount', 'number')],
          settings: undefined,
        })}
      />,
    )

    expect(
      screen.queryByRole('button', { name: 'Reset to the proposed chart' }),
    ).toBeNull()
  })
})

import { save } from '@tauri-apps/plugin-dialog'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../../bindings'
import { activeQueryStore, resetQueryStores } from '../../query/queryStore'
import type { Row } from '../../results/gridModel'
import type { ViewProps } from '../viewTypes'
import { useChartUiStore } from './chartUiStore'
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

const ADD_COLUMN = 'Add a column to the vertical axis'

beforeEach(() => {
  useChartUiStore.setState({ isPanelOpen: true })
})

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
    const columns = [column('a', 'json'), column('b', 'json')]

    render(
      <ChartView
        {...props({ columns, rows: [['{}', '{}']], settings: undefined })}
      />,
    )

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

    await userEvent.click(screen.getByRole('button', { name: 'Line chart' }))

    expect(view.onSettings).toHaveBeenCalledWith({
      type: 'line',
      x: 'country',
      y: ['amount'],
    })
  })

  test('"Add a column" adds a column to the end of the vertical axis', async () => {
    const view = props({
      settings: { type: 'bar', x: 'country', y: ['tax'] },
    })
    render(<ChartView {...view} />)

    await userEvent.click(picked(ADD_COLUMN, 'amount'))

    expect(view.onSettings).toHaveBeenCalledWith({
      type: 'bar',
      x: 'country',
      y: ['tax', 'amount'],
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

    await userEvent.selectOptions(
      screen.getByLabelText('Aggregate of amount'),
      'mean',
    )
    await userEvent.click(screen.getByLabelText('Stacked'))

    expect(view.onSettings).toHaveBeenNthCalledWith(1, {
      type: 'bar',
      x: 'country',
      y: ['amount'],
      aggregates: { amount: 'mean' },
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
      aggregates: { amount: 'none' },
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

    await userEvent.click(picked(ADD_COLUMN, 'Number of rows'))

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

    expect(screen.queryByLabelText(/^Aggregate of/)).not.toBeInTheDocument()
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

    expect(warning.closest('.chart__section')).toHaveTextContent(
      'Vertical axis',
    )
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
})

describe('the reset', () => {
  test('"Reset to the first suggested chart" removes the settings', async () => {
    const view = props()
    render(<ChartView {...view} />)

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Reset to the first suggested chart',
      }),
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
      screen.queryByRole('button', {
        name: 'Reset to the first suggested chart',
      }),
    ).toBeNull()
  })
})

describe('the suggested charts', () => {
  const suggestion = (name: string) => screen.getByRole('button', { name })

  test('the strip shows the charts that the rules propose, and the first one is the chart of a result without settings', () => {
    render(<ChartView {...props({ settings: undefined })} />)

    expect(suggestion('Bar: amount by country')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(suggestion('Scatter: tax by amount')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('img')).toHaveAttribute('data-type', 'bar')
  })

  test('a suggestion replaces the settings', async () => {
    const view = props()
    render(<ChartView {...view} />)

    await userEvent.click(suggestion('Scatter: tax by amount'))

    expect(view.onSettings).toHaveBeenCalledWith({
      type: 'scatter',
      x: 'amount',
      y: ['tax'],
    })
  })

  test('the first suggestion removes the settings, thus a new run gets a new proposal', async () => {
    const view = props({ settings: { type: 'line', x: 'tax', y: ['amount'] } })
    render(<ChartView {...view} />)

    await userEvent.click(suggestion('Bar: amount by country'))

    expect(view.onSettings).toHaveBeenCalledWith(undefined)
  })

  test('the suggestion that is equal to the settings shows as selected', () => {
    render(
      <ChartView
        {...props({ settings: { type: 'scatter', x: 'amount', y: ['tax'] } })}
      />,
    )

    expect(suggestion('Scatter: tax by amount')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(suggestion('Bar: amount by country')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  test('a result without a proposal has no strip', () => {
    render(
      <ChartView
        {...props({
          columns: [column('a', 'json')],
          rows: [['{}']],
          settings: undefined,
        })}
      />,
    )

    expect(screen.queryByRole('group', { name: 'Suggested charts' })).toBeNull()
  })
})

describe('the chart type buttons', () => {
  test('the button of the chart type of the settings shows as selected', () => {
    render(<ChartView {...props()} />)

    expect(screen.getByRole('button', { name: 'Bar chart' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('a type that cannot show the columns gives the cause and has no action', async () => {
    const view = props({
      columns: [column('country', 'text'), column('city', 'text')],
      rows: [['DE', 'Bonn']],
      settings: undefined,
    })
    render(<ChartView {...view} />)
    const histogram = screen.getByRole('button', {
      name: 'Histogram. A histogram needs a number column. This result has none.',
    })

    await userEvent.click(histogram)

    expect(histogram).toHaveAttribute('aria-disabled', 'true')
    expect(view.onSettings).not.toHaveBeenCalled()
  })
})

describe('the columns of the vertical axis', () => {
  test('each column has a row with its aggregate, and "Remove" removes it', async () => {
    const view = props({
      settings: { type: 'bar', x: 'country', y: ['amount', 'tax'] },
    })
    render(<ChartView {...view} />)
    expect(screen.getByLabelText('Aggregate of tax')).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Remove amount from the vertical axis',
      }),
    )

    expect(view.onSettings).toHaveBeenCalledWith({
      type: 'bar',
      x: 'country',
      y: ['tax'],
    })
  })

  test('the list of "Add a column" has only the columns that are not on the axis', () => {
    render(<ChartView {...props()} />)
    const list = screen.getByRole('radiogroup', { name: ADD_COLUMN })

    expect(within(list).queryByRole('radio', { name: /^amount/ })).toBeNull()
    expect(
      within(list).getByRole('radio', { name: /^tax/ }),
    ).toBeInTheDocument()
  })
})

describe('the settings panel', () => {
  const settingsButton = () => screen.getByRole('button', { name: 'Settings' })

  test('"Settings" hides the panel, and the chart stays', async () => {
    render(<ChartView {...props()} />)
    expect(
      screen.getByRole('complementary', { name: 'Chart settings' }),
    ).toBeInTheDocument()

    await userEvent.click(settingsButton())

    expect(screen.queryByRole('complementary')).toBeNull()
    expect(settingsButton()).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('img')).toBeInTheDocument()
  })

  test('the close button of the panel hides it', async () => {
    render(<ChartView {...props()} />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Close the chart settings' }),
    )

    expect(screen.queryByRole('complementary')).toBeNull()
  })

  test('without a chart and with a closed panel, a button opens the settings', async () => {
    useChartUiStore.setState({ isPanelOpen: false })
    render(
      <ChartView
        {...props({
          columns: [column('a', 'json')],
          rows: [['{}']],
          settings: undefined,
        })}
      />,
    )

    await userEvent.click(
      screen.getByRole('button', { name: 'Open the chart settings' }),
    )

    expect(
      screen.getByRole('complementary', { name: 'Chart settings' }),
    ).toBeInTheDocument()
  })
})

describe('the limit of the categories', () => {
  test('a limit also sets the sort by value and "Other"', async () => {
    const view = props()
    render(<ChartView {...view} />)

    await userEvent.selectOptions(screen.getByLabelText('Show'), 'The first 5')

    expect(view.onSettings).toHaveBeenCalledWith({
      type: 'bar',
      x: 'country',
      y: ['amount'],
      sort: 'value-desc',
      limit: 5,
      other: true,
    })
  })

  test('the check box for "Other" shows only with a limit', async () => {
    const view = props({
      settings: { type: 'bar', x: 'country', y: ['amount'], limit: 5 },
    })
    const { rerender } = render(<ChartView {...props()} />)
    expect(screen.queryByLabelText(/Show the rest/)).not.toBeInTheDocument()
    rerender(<ChartView {...view} />)

    await userEvent.click(screen.getByLabelText('Show the rest as "Other"'))

    expect(view.onSettings).toHaveBeenCalledWith({
      type: 'bar',
      x: 'country',
      y: ['amount'],
      limit: 5,
      other: true,
    })
  })

  test('a chart with more categories than the limit says so', () => {
    render(
      <ChartView
        {...props({
          rows: [
            ['DE', '10', '1'],
            ['FR', '20', '2'],
            ['IT', '5', '2'],
          ],
          totalRows: 3,
          settings: {
            type: 'bar',
            x: 'country',
            y: ['amount'],
            sort: 'value-desc',
            limit: 1,
            other: true,
          },
        })}
      />,
    )

    expect(
      screen.getByText(
        'amount against country, one bar for each row, the first 1 and "Other".',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'The chart shows the first 1 of 3 categories. The category "Other" has the rest.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAttribute('data-points', '2')
  })
})

describe('the kind of the column of the horizontal axis', () => {
  const YEARS = [column('year', 'number'), column('total', 'number')]
  const years = (settings: object) =>
    props({
      columns: YEARS,
      rows: [
        ['2025', '1'],
        ['2026', '2'],
      ],
      settings,
    })

  test('"Use as" shows the kind of the result, and "Category" changes it', async () => {
    const view = years({ type: 'line', x: 'year', y: ['total'] })
    render(<ChartView {...view} />)
    expect(
      screen.getByRole('option', { name: 'Automatic (number)' }),
    ).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Use as'), 'Category')

    expect(view.onSettings).toHaveBeenCalledWith({
      type: 'line',
      x: 'year',
      y: ['total'],
      kinds: { year: 'text' },
    })
  })

  test('a number column as a category has a sort and no time unit', () => {
    render(
      <ChartView
        {...years({
          type: 'line',
          x: 'year',
          y: ['total'],
          kinds: { year: 'text' },
        })}
      />,
    )

    expect(screen.getByLabelText('Sort')).toBeInTheDocument()
    expect(screen.getByLabelText('Use as')).toHaveValue('text')
    // The list shows the column with the kind that the settings give it.
    expect(picked('Horizontal axis', 'year')).toHaveAccessibleName(
      /^year\s*, text$/,
    )
  })

  test('a histogram has no "Use as", because it needs numbers', () => {
    render(<ChartView {...years({ type: 'histogram', x: 'total', y: [] })} />)

    expect(screen.queryByLabelText('Use as')).not.toBeInTheDocument()
  })
})

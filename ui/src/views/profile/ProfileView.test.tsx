import { render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { Row } from '../../results/gridModel'
import { column } from '../chart/testColumns'
import type { ViewProps } from '../viewTypes'
import { ProfileView } from './ProfileView'

const COLUMNS = [
  { name: 'country', type_name: 'text', kind: 'text' as const },
  column('amount', 'number'),
]
const ROWS: Row[] = [
  ['DE', '10'],
  ['DE', null],
  ['FR', '30'],
  [null, 'n/a'],
]

function props(overrides: Partial<ViewProps> = {}): ViewProps {
  return {
    columns: COLUMNS,
    rows: ROWS,
    hasMore: false,
    onNeedMore: vi.fn(),
    isComplete: true,
    totalRows: ROWS.length,
    settings: undefined,
    onSettings: vi.fn(),
    ...overrides,
  }
}

function rowOf(name: string) {
  return screen.getByRole('row', { name: new RegExp(`^${name}`) })
}

describe('the column profile', () => {
  test('has one row for each column, with the type, the empty cells, and the different values', () => {
    render(<ProfileView {...props()} />)

    const country = within(rowOf('country'))
    expect(country.getByRole('rowheader')).toHaveTextContent('countrytext')
    expect(country.getAllByRole('cell')[0]).toHaveTextContent('1 (25%)')
    expect(country.getAllByRole('cell')[1]).toHaveTextContent('2')
    expect(country.getAllByRole('cell')[2]).toHaveTextContent('DE')
    expect(country.getAllByRole('cell')[3]).toHaveTextContent('FR')
    expect(screen.getByText('2 columns, 4 rows.')).toBeInTheDocument()
  })

  test('a text column shows its most frequent values with their counts', () => {
    render(<ProfileView {...props()} />)

    const values = within(rowOf('country')).getByRole('list', {
      name: 'Most frequent values',
    })

    expect(within(values).getAllByRole('listitem')[0]).toHaveTextContent('DE2')
  })

  test('a number column shows a histogram that a screen reader can read, and the cells that are not numbers', () => {
    render(<ProfileView {...props()} />)
    const amount = within(rowOf('amount'))

    expect(amount.getByRole('img')).toHaveAccessibleName(
      /^Histogram\. 10 to 12: 1 row\./,
    )
    expect(amount.getByText('1 cell is not a number.')).toBeInTheDocument()
    expect(amount.getAllByRole('cell')[1]).toHaveTextContent(
      '3 (all different)',
    )
  })

  test('a result with more rows than the loaded rows says so', () => {
    render(<ProfileView {...props({ totalRows: 5_000_000 })} />)

    expect(
      screen.getByText('Profile of the first 4 of 5,000,000 rows.'),
    ).toBeInTheDocument()
  })

  test('an open result says that it has more rows', () => {
    render(
      <ProfileView
        {...props({ hasMore: true, isComplete: false, totalRows: null })}
      />,
    )

    expect(
      screen.getByText(
        /^Profile of the first 4 rows\. The result has more rows\./,
      ),
    ).toBeInTheDocument()
  })

  test('a column without values shows a dash for the smallest and the largest value', () => {
    render(
      <ProfileView
        {...props({ columns: [column('n', 'number')], rows: [[null]] })}
      />,
    )

    expect(within(rowOf('n')).getAllByText('—')).toHaveLength(2)
  })
})

test('a text column with only different values shows no list of frequent values', () => {
  render(
    <ProfileView
      {...props({
        columns: [column('note', 'text')],
        rows: [['a'], ['b'], ['c']],
      })}
    />,
  )

  expect(screen.queryByRole('list')).not.toBeInTheDocument()
  expect(screen.getByText('(all different)')).toBeInTheDocument()
})

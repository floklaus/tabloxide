import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import type { Column, Row } from './gridModel'
import { ResultGrid } from './ResultGrid'

const columns: Column[] = [
  { name: 'id', type_name: 'int4', kind: 'number' },
  { name: 'name', type_name: 'text', kind: 'text' },
]
const rows: Row[] = [
  ['10', 'b'],
  ['9', null],
  ['100', 'a'],
]

// jsdom has no layout. The virtual list reads these sizes to decide which rows to render.
const sizes = { clientHeight: 400, clientWidth: 800 }
const original = Object.getOwnPropertyDescriptors(Element.prototype)

beforeAll(() => {
  for (const [name, value] of Object.entries(sizes)) {
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

function renderGrid(props: Partial<Parameters<typeof ResultGrid>[0]> = {}) {
  const onNeedMore = vi.fn()
  render(
    <ResultGrid
      columns={columns}
      rows={rows}
      hasMore={false}
      onNeedMore={onNeedMore}
      {...props}
    />,
  )
  return { user: userEvent.setup(), onNeedMore }
}

function columnValues(column: number): (string | null)[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('gridcell')[column].textContent)
}

describe('ResultGrid', () => {
  test('shows the columns, the rows, and a marker for NULL', () => {
    renderGrid()

    expect(screen.getByRole('button', { name: 'id' })).toBeInTheDocument()
    expect(columnValues(0)).toEqual(['10', '9', '100'])
    expect(columnValues(1)).toEqual(['b', 'NULL', 'a'])
    expect(screen.getByText('NULL')).toHaveClass('grid__null')
  })

  test('renders only the rows near the visible area', () => {
    const many: Row[] = Array.from({ length: 5000 }, (_, i) => [String(i), 'x'])

    renderGrid({ rows: many })

    expect(screen.getAllByRole('row').length).toBeLessThan(60)
    expect(screen.getByRole('grid')).toHaveAttribute('aria-rowcount', '5001')
  })

  test('sorts a number column by value when the user clicks the header', async () => {
    const { user } = renderGrid()

    await user.click(screen.getByRole('button', { name: 'id' }))
    expect(columnValues(0)).toEqual(['9', '10', '100'])

    await user.click(screen.getByRole('button', { name: /^id/ }))
    expect(columnValues(0)).toEqual(['100', '10', '9'])

    await user.click(screen.getByRole('button', { name: /^id/ }))
    expect(columnValues(0)).toEqual(['10', '9', '100'])
  })

  test('hides a column when the user clears its checkbox', async () => {
    const { user } = renderGrid()

    await user.click(screen.getByText('Columns'))
    await user.click(screen.getByRole('checkbox', { name: 'name' }))

    expect(
      screen.queryByRole('button', { name: 'name' }),
    ).not.toBeInTheDocument()
    expect(columnValues(0)).toEqual(['10', '9', '100'])
  })

  test('copies the selected cell and the selected row', async () => {
    const { user } = renderGrid()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')

    await user.click(screen.getByText('b'))
    await user.click(screen.getByRole('button', { name: 'Copy cell' }))
    expect(writeText).toHaveBeenLastCalledWith('b')

    await user.click(screen.getByRole('button', { name: 'Copy row' }))
    expect(writeText).toHaveBeenLastCalledWith('10\tb')
  })

  test('copies NULL as empty text', async () => {
    const { user } = renderGrid()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')

    await user.click(screen.getByText('NULL'))
    await user.click(screen.getByRole('button', { name: 'Copy cell' }))

    expect(writeText).toHaveBeenLastCalledWith('')
  })

  test('asks for more rows when the end is near and the result has more', () => {
    const { onNeedMore } = renderGrid({ hasMore: true })

    expect(onNeedMore).toHaveBeenCalled()
  })

  test('does not ask for more rows when the result is complete', () => {
    const { onNeedMore } = renderGrid({ hasMore: false })

    expect(onNeedMore).not.toHaveBeenCalled()
  })
})

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

  test('moves the selected cell with the arrow keys', async () => {
    const { user } = renderGrid()
    const selected = () =>
      screen
        .getAllByRole('gridcell')
        .find((cell) => cell.getAttribute('aria-selected') === 'true')
        ?.textContent

    screen.getByRole('grid').focus()
    await user.keyboard('{ArrowDown}')
    expect(selected()).toBe('10')

    await user.keyboard('{ArrowDown}{ArrowRight}')
    expect(selected()).toBe('NULL')

    await user.keyboard('{ArrowRight}{ArrowDown}{ArrowDown}')
    expect(selected()).toBe('a')

    await user.keyboard('{Home}{ArrowUp}{ArrowUp}{ArrowUp}')
    expect(selected()).toBe('10')
  })

  test('renders only the columns near the visible area', () => {
    const wide: Column[] = Array.from({ length: 300 }, (_, i) => ({
      name: `c${i}`,
      type_name: 'text',
      kind: 'text',
    }))
    const row: Row = wide.map((_, i) => `v${i}`)

    renderGrid({ columns: wide, rows: [row] })

    expect(screen.getAllByRole('columnheader').length).toBeLessThan(30)
    expect(screen.getAllByRole('gridcell').length).toBeLessThan(30)
    expect(screen.getByRole('grid')).toHaveAttribute('aria-colcount', '301')
    expect(screen.getByRole('button', { name: 'c0' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'c299' }),
    ).not.toBeInTheDocument()
  })

  test('gives each cell its column position', () => {
    renderGrid()

    const first = screen.getAllByRole('row')[1]
    expect(within(first).getByRole('rowheader')).toHaveAttribute(
      'aria-colindex',
      '1',
    )
    expect(
      within(first)
        .getAllByRole('gridcell')
        .map((cell) => cell.getAttribute('aria-colindex')),
    ).toEqual(['2', '3'])
  })

  test('changes the width of the selected column with Alt+Shift and an arrow key', async () => {
    const { user } = renderGrid()
    const template = () =>
      screen.getAllByRole('row')[0].style.gridTemplateColumns

    await user.click(screen.getByText('b'))
    expect(template()).toContain('160px 160px')

    await user.keyboard('{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}')
    expect(template()).toContain('160px 176px')

    await user.keyboard('{Alt>}{Shift>}{ArrowLeft}{ArrowLeft}{/Shift}{/Alt}')
    expect(template()).toContain('160px 144px')
  })

  test('does not make a column narrower than the minimum width', async () => {
    const { user } = renderGrid()
    await user.click(screen.getByText('b'))

    for (let press = 0; press < 12; press += 1) {
      await user.keyboard('{Alt>}{Shift>}{ArrowLeft}{/Shift}{/Alt}')
    }

    expect(screen.getAllByRole('row')[0].style.gridTemplateColumns).toContain(
      '160px 48px',
    )
  })

  test('tells a screen reader the keys that change the column width', () => {
    renderGrid()

    expect(screen.getByRole('grid')).toHaveAccessibleDescription(
      /Alt\+Shift\+Right/,
    )
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

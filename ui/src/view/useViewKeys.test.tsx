import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { focusNextArea } from '../shell/areas'
import { useViewKeys, type KeyRow, type ViewKeysOptions } from './useViewKeys'

type Handlers = Partial<
  Pick<
    ViewKeysOptions,
    | 'onSelect'
    | 'onOpen'
    | 'onSecondary'
    | 'onRename'
    | 'onDelete'
    | 'onRefresh'
    | 'onEscape'
  >
>

/** A tree: public (customer, item, orders), sales (closed). */
function TestTree(handlers: Handlers) {
  const [open, setOpen] = useState<Set<string>>(new Set(['public']))
  const [selected, setSelected] = useState<string | null>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const rows: KeyRow[] = [
    {
      key: 'public',
      label: 'public',
      level: 1,
      isExpandable: true,
      isExpanded: open.has('public'),
    },
    ...(open.has('public')
      ? ['customer', 'item', 'orders'].map((name) => ({
          key: `public.${name}`,
          label: name,
          level: 2,
          parentKey: 'public',
        }))
      : []),
    {
      key: 'sales',
      label: 'sales',
      level: 1,
      isExpandable: true,
      isExpanded: open.has('sales'),
    },
  ]
  const keys = useViewKeys({
    kind: 'tree',
    rows,
    selectedKey: selected,
    filterRef,
    onToggle: (key, expand) =>
      setOpen((now) => {
        const next = new Set(now)
        if (expand) next.add(key)
        else next.delete(key)
        return next
      }),
    contextItems: (key) => [
      { kind: 'action', label: `Copy ${key}`, run: vi.fn() },
    ],
    ...handlers,
    onSelect: (key) => {
      setSelected(key)
      handlers.onSelect?.(key)
    },
  })
  return (
    <>
      <input ref={filterRef} aria-label="Filter" />
      <ul role="tree" aria-label="Objects">
        {rows.map((row, index) => (
          <li key={row.key} {...keys.rowProps(row, index)} className="view-row">
            {row.label}
          </li>
        ))}
      </ul>
      {keys.contextMenu}
    </>
  )
}

const item = (name: string) => screen.getByRole('treeitem', { name })

describe('useViewKeys', () => {
  test('only one row is in the Tab order, and the arrows move the focus', async () => {
    const user = userEvent.setup()
    render(<TestTree />)

    expect(
      screen.getAllByRole('treeitem').filter((row) => row.tabIndex === 0),
    ).toHaveLength(1)
    await user.click(item('public'))
    await user.keyboard('{ArrowDown}')
    expect(item('customer')).toHaveFocus()
    await user.keyboard('{End}')
    expect(item('sales')).toHaveFocus()
    await user.keyboard('{Home}')
    expect(item('public')).toHaveFocus()
    expect(item('public')).toHaveAttribute('aria-level', '1')
    expect(item('public')).toHaveAttribute('aria-expanded', 'true')
  })

  test('Right and Left open and close a node, and move to the child and the parent', async () => {
    const user = userEvent.setup()
    render(<TestTree />)

    await user.click(item('item'))
    await user.keyboard('{ArrowLeft}')
    expect(item('public')).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(item('public')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('treeitem', { name: 'item' })).toBeNull()
    await user.keyboard('{ArrowRight}')
    expect(item('public')).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{ArrowRight}')
    expect(item('customer')).toHaveFocus()
  })

  test('Space selects, Enter opens, Ctrl+Enter is the second action', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onOpen = vi.fn()
    const onSecondary = vi.fn()
    render(
      <TestTree
        onSelect={onSelect}
        onOpen={onOpen}
        onSecondary={onSecondary}
      />,
    )

    await user.click(item('public'))
    await user.keyboard('{ArrowDown}{ArrowDown} ')
    expect(onSelect).toHaveBeenLastCalledWith('public.item')
    expect(item('item')).toHaveAttribute('aria-selected', 'true')
    // The arrows move the focus, not the selection.
    await user.keyboard('{ArrowDown}')
    expect(item('item')).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(onOpen).toHaveBeenCalledWith('public.orders')
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(onSecondary).toHaveBeenCalledWith('public.orders')
  })

  test('F2, Delete, F5, and Esc call their actions', async () => {
    const user = userEvent.setup()
    const handlers = {
      onRename: vi.fn(),
      onDelete: vi.fn(),
      onRefresh: vi.fn(),
      onEscape: vi.fn(),
    }
    render(<TestTree {...handlers} />)

    await user.click(item('orders'))
    await user.keyboard('{F2}{Delete}{F5}{Escape}')

    expect(handlers.onRename).toHaveBeenCalledWith('public.orders')
    expect(handlers.onDelete).toHaveBeenCalledWith('public.orders')
    expect(handlers.onRefresh).toHaveBeenCalled()
    expect(handlers.onEscape).toHaveBeenCalled()
  })

  test('type-ahead moves to the next row that starts with the text', async () => {
    const user = userEvent.setup()
    render(<TestTree />)

    await user.click(item('public'))
    await user.keyboard('s')
    expect(item('sales')).toHaveFocus()
    await user.keyboard('{Home}it')
    expect(item('item')).toHaveFocus()
  })

  test('Ctrl+F and / move the focus to the filter', async () => {
    const user = userEvent.setup()
    render(<TestTree />)

    await user.click(item('public'))
    await user.keyboard('/')
    expect(screen.getByRole('textbox', { name: 'Filter' })).toHaveFocus()
    await user.click(item('public'))
    await user.keyboard('{Control>}f{/Control}')
    expect(screen.getByRole('textbox', { name: 'Filter' })).toHaveFocus()
  })

  test('Shift+F10 opens the context menu, and Esc gives the focus back to the row', async () => {
    const user = userEvent.setup()
    render(<TestTree />)

    await user.click(item('item'))
    await user.keyboard('{Shift>}{F10}{/Shift}')
    expect(
      screen.getByRole('menu', { name: 'Actions for item' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: 'Copy public.item' }),
    ).toHaveFocus()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).toBeNull()
    expect(item('item')).toHaveFocus()
  })
})

describe('F6', () => {
  test('moves between the areas and back to the last focused element', async () => {
    const user = userEvent.setup()
    render(
      <>
        <nav data-area="side">
          <button type="button">Side first</button>
          <button type="button">Side second</button>
        </nav>
        <section data-area="editor">
          <textarea aria-label="Editor" />
        </section>
        <section data-area="results">
          <button type="button">Results</button>
        </section>
      </>,
    )
    const { rememberFocus } = await import('../shell/areas')
    document.addEventListener('focusin', rememberFocus)

    await user.click(screen.getByRole('button', { name: 'Side second' }))
    focusNextArea(false)
    expect(screen.getByRole('textbox', { name: 'Editor' })).toHaveFocus()
    focusNextArea(false)
    expect(screen.getByRole('button', { name: 'Results' })).toHaveFocus()
    focusNextArea(false)
    expect(screen.getByRole('button', { name: 'Side second' })).toHaveFocus()
    focusNextArea(true)
    expect(screen.getByRole('button', { name: 'Results' })).toHaveFocus()

    document.removeEventListener('focusin', rememberFocus)
  })
})

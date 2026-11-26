import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { SideView } from './SideView'
import { StatusMark, type Status } from './StatusMark'
import {
  EmptyState,
  Loading,
  NoMatch,
  SKELETON_DELAY_MS,
  ViewError,
} from './ViewState'

describe('SideView', () => {
  test('has the header, the toolbar, the body, and the status line', async () => {
    const user = userEvent.setup()
    const refresh = vi.fn()
    const copy = vi.fn()
    render(
      <SideView
        title="Schema"
        scope={{
          text: 'Local shop › shop',
          label: 'Scope: Local shop, database shop. Change the scope',
          items: () => [
            { kind: 'action', label: 'Other database', run: vi.fn() },
          ],
        }}
        primary={{
          icon: 'refresh',
          label: 'Read the schema again',
          shortcut: 'F5',
          run: refresh,
        }}
        overflow={() => [{ kind: 'action', label: 'Copy the name', run: copy }]}
        filter={{ value: '', onChange: vi.fn(), label: 'Filter the tables' }}
        status="14 tables · read 2 min ago"
      >
        <p>Body</p>
      </SideView>,
    )

    const view = screen.getByRole('region', { name: 'Schema' })
    expect(view).toContainElement(
      screen.getByRole('heading', { name: 'Schema' }),
    )
    expect(
      screen.getByRole('button', { name: /Scope: Local shop/ }),
    ).toHaveTextContent('Local shop › shop')
    const primary = screen.getByRole('button', {
      name: 'Read the schema again',
    })
    expect(primary).toHaveAttribute('title', 'Read the schema again (F5)')
    await user.click(primary)
    expect(refresh).toHaveBeenCalled()
    await user.click(
      screen.getByRole('button', { name: 'More schema actions' }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'Copy the name' }))
    expect(copy).toHaveBeenCalled()
    expect(
      screen.getByRole('searchbox', { name: 'Filter the tables' }),
    ).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent(
      '14 tables · read 2 min ago',
    )
  })

  test('the first Esc clears the filter, and the second Esc leaves it', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onLeave = vi.fn()
    const { rerender } = render(
      <SideView
        title="Schema"
        filter={{ value: 'inv', onChange, onLeave, label: 'Filter' }}
      >
        <p>Body</p>
      </SideView>,
    )

    await user.click(screen.getByRole('searchbox', { name: 'Filter' }))
    await user.keyboard('{Escape}')
    expect(onChange).toHaveBeenCalledWith('')
    expect(onLeave).not.toHaveBeenCalled()

    rerender(
      <SideView
        title="Schema"
        filter={{ value: '', onChange, onLeave, label: 'Filter' }}
      >
        <p>Body</p>
      </SideView>,
    )
    await user.keyboard('{Escape}')
    expect(onLeave).toHaveBeenCalled()
  })

  test('the modes are tabs with one selected tab', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SideView
        title="Git"
        modes={{
          label: 'Git mode',
          value: 'changes',
          options: [
            { value: 'changes', label: 'Changes' },
            { value: 'history', label: 'History' },
          ],
          onChange,
        }}
      >
        <p>Body</p>
      </SideView>,
    )

    expect(screen.getByRole('tab', { name: 'Changes' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await user.click(screen.getByRole('tab', { name: 'History' }))
    expect(onChange).toHaveBeenCalledWith('history')
  })
})

describe('StatusMark', () => {
  test('each state has its own shape and a name for a screen reader', () => {
    const states: Status[] = ['ok', 'busy', 'neutral', 'warning', 'error']
    render(
      <>
        {states.map((state) => (
          <StatusMark key={state} status={state} label={state} />
        ))}
      </>,
    )

    const shapes = states.map(
      (state) => screen.getByRole('img', { name: state }).innerHTML,
    )
    expect(new Set(shapes).size).toBe(states.length)
  })
})

describe('the states of a view', () => {
  afterEach(() => vi.useRealTimers())

  test('loading shows the skeleton only after 300 ms', () => {
    vi.useFakeTimers()
    const { container } = render(<Loading text="Reading the schema" />)

    expect(
      screen.getByRole('status', { name: 'Reading the schema' }),
    ).toBeInTheDocument()
    expect(container.querySelector('.view-skeleton')).toBeNull()
    act(() => vi.advanceTimersByTime(SKELETON_DELAY_MS))
    expect(container.querySelectorAll('.view-skeleton')).toHaveLength(4)
  })

  test('an error is an alert with Try again', async () => {
    const user = userEvent.setup()
    const retry = vi.fn()
    render(
      <ViewError
        title="Cannot read the schema."
        detail="The server closed the connection."
        onRetry={retry}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Cannot read the schema.',
    )
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalled()
  })

  test('the empty states say why and give one action', async () => {
    const user = userEvent.setup()
    const select = vi.fn()
    const clear = vi.fn()
    render(
      <>
        <EmptyState
          text="The tab has no connection."
          action={{ label: 'Select a connection', run: select }}
        />
        <NoMatch noun="tables" filter="invoice" onClear={clear} />
      </>,
    )

    await user.click(
      screen.getByRole('button', { name: 'Select a connection' }),
    )
    expect(screen.getByText('No tables contain “invoice”.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear the filter' }))
    expect(select).toHaveBeenCalled()
    expect(clear).toHaveBeenCalled()
  })
})

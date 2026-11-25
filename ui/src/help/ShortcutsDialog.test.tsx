import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { ShortcutsDialog } from './ShortcutsDialog'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))

test('shows the shortcuts in tables, finds a shortcut, and closes', async () => {
  const onClose = vi.fn()
  const user = userEvent.setup()
  render(<ShortcutsDialog onClose={onClose} />)

  const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
  expect(
    within(dialog).getByRole('table', { name: 'Result grid' }),
  ).toBeInTheDocument()
  const help = within(dialog).getByRole('table', { name: 'Help' })
  expect(
    within(help).getByRole('row', {
      name: /Ctrl\s*K\s*Search or run a command/,
    }),
  ).toBeInTheDocument()

  await user.type(screen.getByLabelText('Find a shortcut'), 'palette')
  expect(
    within(dialog)
      .getAllByRole('table')
      .map((table) => table.getAttribute('class')),
  ).not.toHaveLength(0)
  expect(
    within(dialog).queryByRole('table', { name: 'Result grid' }),
  ).toBeNull()

  await user.clear(screen.getByLabelText('Find a shortcut'))
  await user.type(screen.getByLabelText('Find a shortcut'), 'nothing like this')
  expect(screen.getByRole('status')).toHaveTextContent('No shortcut matches.')

  await user.click(screen.getByRole('button', { name: 'Close' }))
  expect(onClose).toHaveBeenCalled()
})

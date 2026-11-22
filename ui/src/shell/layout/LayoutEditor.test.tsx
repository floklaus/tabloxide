import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { resetShellStore, useShellStore } from '../shellStore'
import { LayoutEditor } from './LayoutEditor'

vi.mock('../../bindings', async () =>
  (await import('../../test/mockBindings')).createBindingsMock(),
)

function renderEditor() {
  const onClose = vi.fn()
  render(<LayoutEditor onClose={onClose} />)
  return { user: userEvent.setup(), onClose }
}

const layouts = () => screen.getByRole('radiogroup', { name: 'Layouts' })
const preview = () =>
  screen.getByRole('region', { name: 'Preview of the window' })

beforeEach(() => {
  resetShellStore()
})

describe('LayoutEditor', () => {
  test('a built-in layout cannot change, and Duplicate starts a custom layout', async () => {
    const { user } = renderEditor()

    expect(
      within(layouts()).getByRole('radio', { name: /Standard/ }),
    ).toBeChecked()
    expect(screen.getByLabelText('Results')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save layout' })).toBeDisabled()
    expect(
      within(preview()).queryByRole('button', { name: /Move the/ }),
    ).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Duplicate' }))

    expect(
      within(layouts()).getByRole('radio', { name: /Standard copy/ }),
    ).toBeChecked()
    expect(screen.getByLabelText('Results')).toBeEnabled()
    expect(
      useShellStore.getState().customLayouts.map((layout) => layout.name),
    ).toEqual(['Standard copy'])
  })

  test('moves a panel with the keyboard menu of its handle and saves the layout', async () => {
    const { user, onClose } = renderEditor()
    await user.click(screen.getByRole('button', { name: 'New layout' }))

    await user.click(
      within(preview()).getByRole('button', { name: 'Move the Results panel' }),
    )
    await user.click(
      screen.getByRole('menuitemradio', { name: 'Beside the editor' }),
    )
    expect(screen.getByLabelText('Results position')).toHaveValue('beside')
    await user.click(screen.getByRole('button', { name: 'Save layout' }))

    const shell = useShellStore.getState()
    expect(shell.resultsPosition).toBe('beside')
    expect(shell.layoutId).toBe(shell.customLayouts[0].id)
    expect(shell.customLayouts[0].settings.resultsPosition).toBe('beside')
    expect(onClose).toHaveBeenCalled()
  })

  test('moves a panel with drag and drop to a slot', async () => {
    const { user } = renderEditor()
    await user.click(screen.getByRole('button', { name: 'New layout' }))
    const sidebar = within(preview())
      .getByText('Sidebar')
      .closest('[draggable]')
    if (!sidebar) throw new Error('The sidebar box is not draggable.')

    fireEvent.dragStart(sidebar, {
      dataTransfer: { setData: vi.fn(), effectAllowed: '' },
    })
    const slot = preview().querySelector('[data-slot="right"]')
    if (!slot) throw new Error('The preview shows no slot.')
    fireEvent.dragOver(slot, { dataTransfer: { dropEffect: '' } })
    fireEvent.drop(slot, { dataTransfer: {} })

    expect(screen.getByRole('radio', { name: 'Right' })).toBeChecked()
    expect(preview().querySelector('[data-slot]')).toBeNull()
  })

  test('Apply shows the settings in the window without a save', async () => {
    const { user } = renderEditor()
    await user.click(screen.getByRole('button', { name: 'New layout' }))

    await user.click(screen.getByLabelText('Status bar'))
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    const shell = useShellStore.getState()
    expect(shell.panels.statusBar).toBe(false)
    expect(shell.customLayouts[0].settings.panels.statusBar).toBe(true)
    expect(shell.layoutId).toBeNull()
  })

  test('renames a layout and rejects a name that exists', async () => {
    const { user } = renderEditor()
    await user.click(screen.getByRole('button', { name: 'New layout' }))

    await user.click(screen.getByRole('button', { name: 'Rename' }))
    const field = screen.getByLabelText('New name')
    await user.clear(field)
    await user.type(field, 'simple')
    await user.click(
      within(field.closest('form') as HTMLElement).getByRole('button', {
        name: 'Rename',
      }),
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'A layout with this name exists.',
    )

    await user.clear(field)
    await user.type(field, 'Review')
    await user.keyboard('{Enter}')

    expect(
      within(layouts()).getByRole('radio', { name: /Review/ }),
    ).toBeChecked()
    expect(useShellStore.getState().customLayouts[0].name).toBe('Review')
  })

  test('asks before it deletes a layout', async () => {
    const { user } = renderEditor()
    await user.click(screen.getByRole('button', { name: 'New layout' }))

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Delete the layout “My layout”?',
    )
    await user.click(
      within(screen.getByRole('alert')).getByRole('button', { name: 'Delete' }),
    )

    expect(useShellStore.getState().customLayouts).toEqual([])
    expect(
      within(layouts()).getByRole('radio', { name: /Standard/ }),
    ).toBeChecked()
  })
})

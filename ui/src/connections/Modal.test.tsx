import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { Modal } from './Modal'

function renderModal(onClose = vi.fn()) {
  render(
    <>
      <button type="button">Outside</button>
      <Modal title="Settings" onClose={onClose}>
        <input aria-label="First" />
        <button type="button" disabled>
          Disabled
        </button>
        <button type="button">Last</button>
      </Modal>
    </>,
  )
  return { user: userEvent.setup(), onClose }
}

describe('Modal', () => {
  test('moves the focus to the first field when it opens', () => {
    renderModal()

    expect(screen.getByLabelText('First')).toHaveFocus()
  })

  test('keeps the focus in the dialog when the user presses Tab on the last control', async () => {
    const { user } = renderModal()
    screen.getByRole('button', { name: 'Last' }).focus()

    await user.tab()

    expect(screen.getByLabelText('First')).toHaveFocus()
  })

  test('keeps the focus in the dialog when the user presses Shift+Tab on the first control', async () => {
    const { user } = renderModal()

    await user.tab({ shift: true })

    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus()
  })

  test('closes when the user presses Escape', async () => {
    const { user, onClose } = renderModal()

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledOnce()
  })
})

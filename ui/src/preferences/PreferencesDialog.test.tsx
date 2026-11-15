import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { PreferencesDialog } from './PreferencesDialog'
import { DEFAULT_PREFERENCES, usePreferencesStore } from './preferencesStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)

const preferencesSave = vi.mocked(commands.preferencesSave)

describe('PreferencesDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePreferencesStore.setState({
      preferences: DEFAULT_PREFERENCES,
      error: null,
    })
  })

  test('shows the stored preferences', () => {
    render(<PreferencesDialog onClose={() => {}} />)

    expect(screen.getByLabelText(/Font size/)).toHaveValue(14)
    expect(screen.getByLabelText(/Tab width/)).toHaveValue(2)
    expect(screen.getByLabelText('Show line numbers')).toBeChecked()
    expect(screen.getByLabelText('Wrap long lines')).not.toBeChecked()
    expect(screen.getByLabelText(/Keep the query history/)).toHaveValue(90)
  })

  test('stores the changes and uses the values that the backend returns', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const changed = {
      editor: {
        font_size: 18,
        tab_width: 2,
        line_numbers: true,
        word_wrap: true,
      },
      history_retention_days: 90,
      guardrails: {
        development: 'risky' as const,
        staging: 'risky' as const,
        production: 'always' as const,
      },
    }
    preferencesSave.mockResolvedValue({ status: 'ok', data: changed })
    render(<PreferencesDialog onClose={onClose} />)

    await user.clear(screen.getByLabelText(/Font size/))
    await user.type(screen.getByLabelText(/Font size/), '18')
    await user.click(screen.getByLabelText('Wrap long lines'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(preferencesSave).toHaveBeenCalledWith(changed)
    expect(usePreferencesStore.getState().preferences).toEqual(changed)
    expect(onClose).toHaveBeenCalled()
  })

  test('shows the confirmation rule of each environment', () => {
    render(<PreferencesDialog onClose={() => {}} />)

    expect(screen.getByLabelText('Development connections')).toHaveValue(
      'risky',
    )
    expect(screen.getByLabelText('Staging connections')).toHaveValue('risky')
    expect(screen.getByLabelText('Production connections')).toHaveValue(
      'always',
    )
  })

  test('stores a changed confirmation rule for one environment', async () => {
    const user = userEvent.setup()
    preferencesSave.mockImplementation(async (preferences) => ({
      status: 'ok',
      data: preferences as never,
    }))
    render(<PreferencesDialog onClose={() => {}} />)

    await user.selectOptions(
      screen.getByLabelText('Staging connections'),
      'Before each run',
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(preferencesSave).toHaveBeenCalledWith({
      ...DEFAULT_PREFERENCES,
      guardrails: {
        development: 'risky',
        staging: 'always',
        production: 'always',
      },
    })
  })

  test('does not store the changes when the user cancels', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<PreferencesDialog onClose={onClose} />)

    await user.click(screen.getByLabelText('Wrap long lines'))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(preferencesSave).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})

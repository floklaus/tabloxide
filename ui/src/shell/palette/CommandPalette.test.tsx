import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { resetShellStore, useShellStore } from '../shellStore'
import { CommandPalette } from './CommandPalette'
import { parseQuery, search, type PaletteEntry } from './paletteSearch'

vi.mock('../../bindings', async () =>
  (await import('../../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))

function entry(
  id: string,
  group: PaletteEntry['group'],
  label: string,
  detail?: string,
): PaletteEntry {
  return { id, group, label, detail, run: vi.fn() }
}

const ENTRIES = [
  entry('a', 'Commands', 'Run all statements', 'Query'),
  entry('b', 'Commands', 'Show or hide the results', 'View'),
  entry('c', 'Files', 'runs_by_day.sql', 'reports/'),
  entry('d', 'Schema objects', 'public.job_run', 'table · Local'),
  entry('e', 'Settings', 'Theme: Neon', 'View'),
]

describe('paletteSearch', () => {
  test('reads the scope of the query', () => {
    expect(parseQuery('> Run  ALL')).toEqual({
      scope: 'commands',
      words: ['run', 'all'],
    })
    expect(parseQuery('@job')).toEqual({ scope: 'schema', words: ['job'] })
    expect(parseQuery('runs')).toEqual({ scope: 'all', words: ['runs'] })
  })

  test('finds each word in the label or the detail, in the sequence of the groups', () => {
    expect(search(ENTRIES, 'run').map((item) => item.id)).toEqual([
      'a',
      'c',
      'd',
    ])
    expect(search(ENTRIES, 'reports').map((item) => item.id)).toEqual(['c'])
    expect(search(ENTRIES, '>run').map((item) => item.id)).toEqual(['a'])
    expect(search(ENTRIES, '@run').map((item) => item.id)).toEqual(['d'])
    expect(search(ENTRIES, '>neon').map((item) => item.id)).toEqual(['e'])
  })

  test('puts an entry that starts with the word first in its group', () => {
    const entries = [
      entry('x', 'Commands', 'Hide the results'),
      entry('y', 'Commands', 'Results below the editor'),
    ]

    expect(search(entries, 'results').map((item) => item.id)).toEqual([
      'y',
      'x',
    ])
  })
})

describe('CommandPalette', () => {
  beforeEach(() => {
    resetShellStore()
    useShellStore.setState({ dialog: 'palette' })
  })

  test('moves the selection with the arrow keys and closes with Escape', async () => {
    const user = userEvent.setup()
    render(<CommandPalette />)
    const input = screen.getByRole('combobox', {
      name: 'Search or run a command',
    })

    await user.keyboard('>zoom')
    const options = screen.getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining('Zoom in'),
      expect.stringContaining('Zoom out'),
      expect.stringContaining('Reset zoom'),
    ])
    await user.keyboard('{ArrowDown}')
    expect(input).toHaveAttribute('aria-activedescendant', options[1].id)
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(input).toHaveAttribute('aria-activedescendant', options[2].id)
    await user.keyboard('{Escape}')

    expect(useShellStore.getState().dialog).toBeNull()
  })

  test('says when nothing matches', async () => {
    const user = userEvent.setup()
    render(<CommandPalette />)

    await user.keyboard('>no such command')

    expect(screen.getByText('Nothing matches.')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })
})

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { useTabsStore } from '../tabs/tabsStore'
import { FileTree } from './FileTree'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }))

const fileList = vi.mocked(commands.fileList)
const fileRead = vi.mocked(commands.fileRead)

const listings: Record<
  string,
  { name: string; path: string; is_directory: boolean }[]
> = {
  '': [
    { name: 'queries', path: 'queries', is_directory: true },
    { name: 'readme.md', path: 'readme.md', is_directory: false },
  ],
  queries: [{ name: 'a.sql', path: 'queries/a.sql', is_directory: false }],
}

describe('FileTree', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTabsStore.getState().reset()
    fileList.mockImplementation(async (directory) => ({
      status: 'ok',
      data: listings[directory] ?? [],
    }))
  })

  test('shows the entries of the workspace root', async () => {
    render(<FileTree />)

    expect(
      await screen.findByRole('treeitem', { name: /queries/ }),
    ).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.getByRole('treeitem', { name: 'readme.md' }),
    ).toBeInTheDocument()
    expect(fileList).toHaveBeenCalledWith('')
  })

  test('loads a directory only when the user opens it', async () => {
    const user = userEvent.setup()
    render(<FileTree />)
    const directory = await screen.findByRole('treeitem', { name: /queries/ })
    expect(fileList).toHaveBeenCalledTimes(1)

    await user.click(directory)

    expect(
      await screen.findByRole('treeitem', { name: 'a.sql' }),
    ).toBeInTheDocument()
    expect(fileList).toHaveBeenCalledWith('queries')

    await user.click(directory)
    expect(
      screen.queryByRole('treeitem', { name: 'a.sql' }),
    ).not.toBeInTheDocument()
  })

  test('opens a file in a tab when the user clicks it', async () => {
    const user = userEvent.setup()
    fileRead.mockResolvedValue({ status: 'ok', data: 'text' })
    render(<FileTree />)

    await user.click(await screen.findByRole('treeitem', { name: 'readme.md' }))

    expect(fileRead).toHaveBeenCalledWith('readme.md')
    expect(useTabsStore.getState().tabs[0]).toMatchObject({
      title: 'readme.md',
      content: 'text',
    })
  })

  test('shows the error when a directory does not load', async () => {
    fileList.mockResolvedValue({
      status: 'error',
      error: {
        kind: 'workspace',
        message: 'Cannot read the folder.',
        issues: [],
      },
    })

    render(<FileTree />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cannot read the folder.',
    )
  })

  test('loads the open directories again with the refresh button', async () => {
    const user = userEvent.setup()
    render(<FileTree />)
    await screen.findByRole('treeitem', { name: 'readme.md' })
    listings[''] = [{ name: 'new.sql', path: 'new.sql', is_directory: false }]

    await user.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(
      await screen.findByRole('treeitem', { name: 'new.sql' }),
    ).toBeInTheDocument()
  })
})

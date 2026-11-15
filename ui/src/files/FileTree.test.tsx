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

type Listings = Record<
  string,
  { name: string; path: string; is_directory: boolean }[]
>

function makeListings(): Listings {
  return {
    '': [
      { name: 'queries', path: 'queries', is_directory: true },
      { name: 'readme.md', path: 'readme.md', is_directory: false },
    ],
    queries: [{ name: 'a.sql', path: 'queries/a.sql', is_directory: false }],
  }
}

// A test can change the listings. Each test starts with new listings.
let listings = makeListings()

describe('FileTree', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTabsStore.getState().reset()
    listings = makeListings()
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

  test('has only one tree item in the Tab key sequence', async () => {
    render(<FileTree />)
    const directory = await screen.findByRole('treeitem', { name: /queries/ })

    expect(directory).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('treeitem', { name: 'readme.md' })).toHaveAttribute(
      'tabindex',
      '-1',
    )
  })

  test('moves between the tree items with the arrow keys, Home, and End', async () => {
    const user = userEvent.setup()
    render(<FileTree />)
    const directory = await screen.findByRole('treeitem', { name: /queries/ })
    const file = screen.getByRole('treeitem', { name: 'readme.md' })
    directory.focus()

    await user.keyboard('{ArrowDown}')
    expect(file).toHaveFocus()
    expect(file).toHaveAttribute('tabindex', '0')
    expect(directory).toHaveAttribute('tabindex', '-1')

    await user.keyboard('{ArrowDown}')
    expect(file).toHaveFocus()

    await user.keyboard('{ArrowUp}')
    expect(directory).toHaveFocus()

    await user.keyboard('{End}')
    expect(file).toHaveFocus()

    await user.keyboard('{Home}')
    expect(directory).toHaveFocus()
  })

  test('opens and closes a directory with the right and left arrow keys', async () => {
    const user = userEvent.setup()
    render(<FileTree />)
    const directory = await screen.findByRole('treeitem', { name: /queries/ })
    directory.focus()

    await user.keyboard('{ArrowRight}')
    const child = await screen.findByRole('treeitem', { name: 'a.sql' })
    expect(directory).toHaveAttribute('aria-expanded', 'true')
    expect(directory).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(child).toHaveFocus()

    await user.keyboard('{ArrowLeft}')
    expect(directory).toHaveFocus()

    await user.keyboard('{ArrowLeft}')
    expect(directory).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.queryByRole('treeitem', { name: 'a.sql' }),
    ).not.toBeInTheDocument()
  })

  test('opens a file with the Enter key', async () => {
    const user = userEvent.setup()
    fileRead.mockResolvedValue({ status: 'ok', data: 'text' })
    render(<FileTree />)
    const file = await screen.findByRole('treeitem', { name: 'readme.md' })
    file.focus()

    await user.keyboard('{Enter}')

    expect(fileRead).toHaveBeenCalledWith('readme.md')
  })

  test('keeps the focus on an open directory without entries when the user presses the right arrow key', async () => {
    const user = userEvent.setup()
    listings.queries = []
    render(<FileTree />)
    const directory = await screen.findByRole('treeitem', { name: /queries/ })
    directory.focus()
    await user.keyboard('{ArrowRight}')
    expect(directory).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard('{ArrowRight}')

    expect(directory).toHaveFocus()
  })
})

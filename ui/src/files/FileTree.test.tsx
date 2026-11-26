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

  test('the error of the root has Try again, and the header stays', async () => {
    const user = userEvent.setup()
    fileList.mockResolvedValue({
      status: 'error',
      error: {
        kind: 'workspace',
        message: 'Permission denied.',
        issues: [],
      },
    })

    render(<FileTree />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Cannot read the workspace folder.')
    expect(alert).toHaveTextContent('Permission denied.')
    expect(screen.getByRole('heading', { name: 'Files' })).toBeInTheDocument()
    fileList.mockImplementation(async (directory) => ({
      status: 'ok',
      data: listings[directory] ?? [],
    }))
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByRole('treeitem', { name: 'readme.md' }),
    ).toBeInTheDocument()
  })

  test('shows the error of a folder in the tree', async () => {
    const user = userEvent.setup()
    fileList.mockImplementation(async (directory) =>
      directory === 'queries'
        ? {
            status: 'error',
            error: {
              kind: 'workspace',
              message: 'Cannot read the folder.',
              issues: [],
            },
          }
        : { status: 'ok', data: listings[directory] ?? [] },
    )
    render(<FileTree />)

    await user.click(await screen.findByRole('treeitem', { name: /queries/ }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Cannot read the folder queries.')
    expect(alert).toHaveTextContent('Cannot read the folder.')
  })

  test('while the root loads, the view shows the loading state', async () => {
    fileList.mockReturnValue(new Promise(() => {}))

    render(<FileTree />)

    expect(
      screen.getByRole('status', {
        name: 'Reading the files of the workspace…',
      }),
    ).toBeInTheDocument()
  })

  test('an empty workspace folder says so and gives one action', async () => {
    listings = { '': [] }

    render(<FileTree />)

    expect(
      await screen.findByText('The workspace folder is empty.'),
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: 'Read the files again' }),
    ).toHaveLength(2)
  })

  test('filters the loaded files and shows the folders that contain them', async () => {
    const user = userEvent.setup()
    render(<FileTree />)
    await user.click(await screen.findByRole('treeitem', { name: /queries/ }))
    await screen.findByRole('treeitem', { name: 'a.sql' })
    await user.click(screen.getByRole('treeitem', { name: /queries/ }))

    await user.type(
      screen.getByRole('searchbox', { name: 'Filter the files' }),
      'a.s',
    )

    expect(screen.getByRole('treeitem', { name: /queries/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByRole('treeitem', { name: 'a.sql' })).toBeInTheDocument()
    expect(
      screen.queryByRole('treeitem', { name: 'readme.md' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 folder, 1 file')
  })

  test('a filter without a match says so and clears the filter', async () => {
    const user = userEvent.setup()
    render(<FileTree />)
    await screen.findByRole('treeitem', { name: 'readme.md' })

    await user.type(
      screen.getByRole('searchbox', { name: 'Filter the files' }),
      'invoice',
    )
    expect(screen.getByText('No files contain “invoice”.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear the filter' }))

    expect(
      screen.getByRole('treeitem', { name: 'readme.md' }),
    ).toBeInTheDocument()
  })

  test('Space opens a file, and the file of the active tab is selected', async () => {
    const user = userEvent.setup()
    fileRead.mockResolvedValue({ status: 'ok', data: 'text' })
    render(<FileTree />)
    const file = await screen.findByRole('treeitem', { name: 'readme.md' })
    file.focus()

    await user.keyboard(' ')

    await vi.waitFor(() =>
      expect(file).toHaveAttribute('aria-selected', 'true'),
    )
    expect(fileRead).toHaveBeenCalledTimes(1)
    expect(file).toHaveFocus()
  })

  test('a double click opens a file in one tab only', async () => {
    const user = userEvent.setup()
    fileRead.mockResolvedValue({ status: 'ok', data: 'text' })
    render(<FileTree />)

    await user.dblClick(
      await screen.findByRole('treeitem', { name: 'readme.md' }),
    )

    await vi.waitFor(() => expect(useTabsStore.getState().tabs).toHaveLength(1))
    expect(fileRead).toHaveBeenCalledTimes(1)
  })

  test('type-ahead moves to a file, and / moves to the filter', async () => {
    const user = userEvent.setup()
    render(<FileTree />)
    const directory = await screen.findByRole('treeitem', { name: /queries/ })
    directory.focus()

    await user.keyboard('r')
    expect(screen.getByRole('treeitem', { name: 'readme.md' })).toHaveFocus()

    await user.keyboard('/')
    expect(
      screen.getByRole('searchbox', { name: 'Filter the files' }),
    ).toHaveFocus()
  })

  test('F5 reads the open folders again', async () => {
    const user = userEvent.setup()
    render(<FileTree />)
    const file = await screen.findByRole('treeitem', { name: 'readme.md' })
    file.focus()
    fileList.mockClear()

    await user.keyboard('{F5}')

    expect(fileList).toHaveBeenCalledWith('')
  })

  test('Shift+F10 opens the context menu of a file', async () => {
    const user = userEvent.setup()
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue()
    render(<FileTree />)
    const file = await screen.findByRole('treeitem', { name: 'readme.md' })
    file.focus()

    await user.keyboard('{Shift>}{F10}{/Shift}')
    expect(
      screen.getByRole('menuitem', { name: /Open the file/ }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Copy the path' }))

    expect(writeText).toHaveBeenCalledWith('readme.md')
  })

  test('loads the open directories again with the refresh button', async () => {
    const user = userEvent.setup()
    render(<FileTree />)
    await screen.findByRole('treeitem', { name: 'readme.md' })
    listings[''] = [{ name: 'new.sql', path: 'new.sql', is_directory: false }]

    await user.click(
      screen.getByRole('button', { name: 'Read the files again' }),
    )

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

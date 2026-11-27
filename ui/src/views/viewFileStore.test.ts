import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { serializeViewFile, type SavedView, type ViewFile } from './viewFile'
import { useViewFileStore } from './viewFileStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)

const fileList = vi.mocked(commands.fileList)
const fileRead = vi.mocked(commands.fileRead)
const fileWrite = vi.mocked(commands.fileWrite)

const PATH = 'reports/revenue.view.json'
const REVENUE: SavedView = {
  name: 'Revenue by day',
  statement: 1,
  view: 'chart',
  settings: { type: 'line', x: 'day', y: ['amount'] },
}
const FILE: ViewFile = { version: 1, views: [REVENUE] }
const ERROR = { kind: 'workspace' as const, message: 'no access', issues: [] }

/** The disk has the view settings file with this text. */
function onDisk(text: string) {
  fileList.mockResolvedValue({
    status: 'ok',
    data: [{ name: 'revenue.view.json', path: PATH, is_directory: false }],
  })
  fileRead.mockResolvedValue({ status: 'ok', data: text })
}

beforeEach(() => {
  useViewFileStore.getState().reset()
  fileList.mockResolvedValue({ status: 'ok', data: [] })
  fileWrite.mockResolvedValue({ status: 'ok', data: null })
})

describe('load', () => {
  test('a file that does not exist is not an error, and the application does not read it', async () => {
    const loaded = await useViewFileStore.getState().load(PATH)

    expect(loaded).toEqual({ status: 'missing' })
    expect(fileList).toHaveBeenCalledWith('reports')
    expect(fileRead).not.toHaveBeenCalled()
  })

  test('a valid file gives its views', async () => {
    onDisk(serializeViewFile(FILE))

    const loaded = await useViewFileStore.getState().load(PATH)

    expect(loaded).toEqual({ status: 'ok', file: FILE })
    expect(useViewFileStore.getState().files[PATH]).toEqual(loaded)
  })

  test('a file that is not valid gives the reason', async () => {
    onDisk('{')

    const loaded = await useViewFileStore.getState().load(PATH)

    expect(loaded).toEqual({
      status: 'invalid',
      error: 'The file is not valid JSON.',
    })
  })

  test('a file that is not readable gives the message of the backend', async () => {
    onDisk('')
    fileRead.mockResolvedValue({ status: 'error', error: ERROR })

    const loaded = await useViewFileStore.getState().load(PATH)

    expect(loaded).toEqual({ status: 'invalid', error: 'no access' })
  })
})

describe('update', () => {
  const added: SavedView = { ...REVENUE, name: 'Revenue by week' }
  const add = (file: ViewFile): ViewFile => ({
    ...file,
    views: [...file.views, added],
  })

  test('the first save makes the file', async () => {
    const failure = await useViewFileStore.getState().update(PATH, add)

    expect(failure).toBeNull()
    expect(fileWrite).toHaveBeenCalledWith(
      PATH,
      serializeViewFile({ version: 1, views: [added] }),
    )
  })

  test('a save reads the file again and keeps the views of the disk', async () => {
    onDisk(serializeViewFile(FILE))

    await useViewFileStore.getState().update(PATH, add)

    expect(fileWrite).toHaveBeenCalledWith(
      PATH,
      serializeViewFile({ version: 1, views: [REVENUE, added] }),
    )
    expect(useViewFileStore.getState().files[PATH]).toEqual({
      status: 'ok',
      file: { version: 1, views: [REVENUE, added] },
    })
  })

  test('a save does not replace a file that is not valid', async () => {
    onDisk('{"version": 2, "views": []}')

    const failure = await useViewFileStore.getState().update(PATH, add)

    expect(failure).toContain('The application did not change')
    expect(fileWrite).not.toHaveBeenCalled()
  })

  test('a write failure gives the message of the backend', async () => {
    fileWrite.mockResolvedValue({ status: 'error', error: ERROR })

    const failure = await useViewFileStore.getState().update(PATH, add)

    expect(failure).toBe('no access')
    expect(useViewFileStore.getState().files[PATH]).toEqual({
      status: 'missing',
    })
  })
})

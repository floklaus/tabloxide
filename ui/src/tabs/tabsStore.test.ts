import { save } from '@tauri-apps/plugin-dialog'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { isDirty, persistTabs, toUiState, useTabsStore } from './tabsStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }))

const uiStateLoad = vi.mocked(commands.uiStateLoad)
const uiStateSave = vi.mocked(commands.uiStateSave)
const fileRead = vi.mocked(commands.fileRead)
const fileWrite = vi.mocked(commands.fileWrite)
const fileRelativePath = vi.mocked(commands.fileRelativePath)
const store = useTabsStore

function ok<T>(data: T) {
  return { status: 'ok' as const, data }
}

function failed(message: string) {
  return {
    status: 'error' as const,
    error: { kind: 'workspace' as const, message, issues: [] },
  }
}

function stored(overrides: object = {}) {
  return {
    id: 't1',
    title: 'Query 1',
    path: null,
    content: 'select 1',
    connection_id: 'c1',
    ...overrides,
  }
}

function active() {
  const { tabs, activeId } = store.getState()
  return tabs.find((tab) => tab.id === activeId)!
}

describe('tabsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.getState().reset()
    fileWrite.mockResolvedValue(ok(null))
  })

  test('starts with one empty tab when the last session had no tabs', async () => {
    uiStateLoad.mockResolvedValue(ok({ tabs: [], active_tab: null }))

    await store.getState().load()

    expect(store.getState().tabs).toHaveLength(1)
    expect(active().title).toBe('Query 1')
    expect(isDirty(active())).toBe(false)
  })

  test('restores the tabs, the unsaved text, and the active tab', async () => {
    uiStateLoad.mockResolvedValue(
      ok({
        active_tab: 't2',
        tabs: [
          stored(),
          stored({ id: 't2', title: 'a.sql', path: 'a.sql', content: null }),
          stored({
            id: 't3',
            title: 'b.sql',
            path: 'b.sql',
            content: 'edited',
          }),
        ],
      }),
    )
    fileRead.mockImplementation(async (path) => ok(`on disk: ${path}`))

    await store.getState().load()

    const [buffer, clean, edited] = store.getState().tabs
    expect(buffer).toMatchObject({ content: 'select 1', connectionId: 'c1' })
    expect(clean).toMatchObject({ content: 'on disk: a.sql', path: 'a.sql' })
    expect(isDirty(clean)).toBe(false)
    expect(edited.content).toBe('edited')
    expect(isDirty(edited)).toBe(true)
    expect(store.getState().activeId).toBe('t2')
  })

  test('drops a file tab without changes when its file is gone', async () => {
    uiStateLoad.mockResolvedValue(
      ok({
        active_tab: 't1',
        tabs: [
          stored({ path: 'gone.sql', content: null }),
          stored({ id: 't2', path: 'gone2.sql', content: 'keep me' }),
        ],
      }),
    )
    fileRead.mockResolvedValue(failed('not found'))

    await store.getState().load()

    expect(store.getState().tabs).toHaveLength(1)
    expect(active()).toMatchObject({ id: 't2', path: null, content: 'keep me' })
  })

  test('gives each new tab a title that is not in use', () => {
    store.getState().newTab()
    store.getState().newTab('select 2')

    expect(store.getState().tabs.map((tab) => tab.title)).toEqual([
      'Query 1',
      'Query 2',
    ])
    expect(active().content).toBe('select 2')
  })

  test('opens a file in a new tab, and activates the tab if the file is open', async () => {
    fileRead.mockResolvedValue(ok('select 1'))

    await store.getState().openFile('q/a.sql')
    store.getState().newTab()
    await store.getState().openFile('q/a.sql')

    expect(fileRead).toHaveBeenCalledTimes(1)
    expect(store.getState().tabs).toHaveLength(2)
    expect(active()).toMatchObject({ title: 'a.sql', path: 'q/a.sql' })
  })

  test('shows the error when a file does not open', async () => {
    fileRead.mockResolvedValue(failed('image.bin is not a UTF-8 text file.'))

    await store.getState().openFile('image.bin')

    expect(store.getState().tabs).toHaveLength(0)
    expect(store.getState().error).toBe('image.bin is not a UTF-8 text file.')
  })

  test('saves a file tab and clears the unsaved marker', async () => {
    fileRead.mockResolvedValue(ok('select 1'))
    await store.getState().openFile('a.sql')
    store.getState().setContent(active().id, 'select 2')
    expect(isDirty(active())).toBe(true)

    await store.getState().save(active().id)

    expect(fileWrite).toHaveBeenCalledWith('a.sql', 'select 2')
    expect(isDirty(active())).toBe(false)
  })

  test('keeps the unsaved marker when the write fails', async () => {
    fileRead.mockResolvedValue(ok('select 1'))
    await store.getState().openFile('a.sql')
    store.getState().setContent(active().id, 'select 2')
    fileWrite.mockResolvedValue(failed('read-only'))

    await store.getState().save(active().id)

    expect(isDirty(active())).toBe(true)
    expect(store.getState().error).toBe('read-only')
  })

  test('saves a buffer to the file from the save dialog', async () => {
    const id = store.getState().newTab('select 1')
    vi.mocked(save).mockResolvedValue('/work/sql-project/q/new.sql')
    fileRelativePath.mockResolvedValue(ok('q/new.sql'))

    await store.getState().save(id)

    expect(fileWrite).toHaveBeenCalledWith('q/new.sql', 'select 1')
    expect(active()).toMatchObject({ title: 'new.sql', path: 'q/new.sql' })
    expect(isDirty(active())).toBe(false)
  })

  test('does not save a buffer to a file out of the workspace', async () => {
    const id = store.getState().newTab('select 1')
    vi.mocked(save).mockResolvedValue('/other/new.sql')
    fileRelativePath.mockResolvedValue(
      failed('The path is not in the workspace.'),
    )

    await store.getState().save(id)

    expect(fileWrite).not.toHaveBeenCalled()
    expect(store.getState().error).toContain('Save the file in the workspace')
    expect(active().path).toBeNull()
  })

  test('activates the adjacent tab after a close and keeps one tab', () => {
    const first = store.getState().newTab()
    const second = store.getState().newTab()

    store.getState().close(second)
    expect(store.getState().activeId).toBe(first)

    store.getState().close(first)
    expect(store.getState().tabs).toHaveLength(1)
    expect(active().id).not.toBe(first)
  })

  test('stores only the unsaved text of a file tab', async () => {
    fileRead.mockResolvedValue(ok('select 1'))
    await store.getState().openFile('a.sql')
    const clean = toUiState(store.getState().tabs, null).tabs[0]
    store.getState().setContent(active().id, 'select 2')
    const edited = toUiState(store.getState().tabs, null).tabs[0]

    expect(clean.content).toBeNull()
    expect(edited.content).toBe('select 2')
  })

  test('reloads a file tab without changes and keeps unsaved text', async () => {
    fileRead.mockResolvedValue(ok('old'))
    await store.getState().openFile('a.sql')
    await store.getState().openFile('b.sql')
    store.getState().setContent(active().id, 'my edit')
    store.getState().newTab('buffer')
    fileRead.mockClear()
    fileRead.mockResolvedValue(ok('new'))

    await store.getState().reloadFromDisk()

    const [clean, edited, buffer] = store.getState().tabs
    expect(clean).toMatchObject({ content: 'new', savedContent: 'new' })
    expect(edited).toMatchObject({ content: 'my edit', savedContent: 'new' })
    expect(isDirty(edited)).toBe(true)
    expect(buffer.content).toBe('buffer')
    expect(fileRead).toHaveBeenCalledTimes(2)
  })

  test('keeps a tab when its file is not readable after a reload', async () => {
    fileRead.mockResolvedValue(ok('old'))
    await store.getState().openFile('a.sql')
    fileRead.mockResolvedValue(failed('not found'))

    await store.getState().reloadFromDisk()

    expect(active()).toMatchObject({ content: 'old', savedContent: 'old' })
  })

  describe('persistTabs', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    test('stores the tabs one time after a group of changes', () => {
      store.setState({ isLoaded: true })
      const stop = persistTabs()

      const id = store.getState().newTab()
      store.getState().setContent(id, 'select 1')
      store.getState().setConnection(id, 'c1')
      vi.advanceTimersByTime(500)
      stop()

      expect(uiStateSave).toHaveBeenCalledTimes(1)
      expect(uiStateSave.mock.calls[0][0]).toMatchObject({
        active_tab: id,
        tabs: [{ id, content: 'select 1', connection_id: 'c1' }],
      })
    })

    test('stores a change that waits when the subscription stops', () => {
      store.setState({ isLoaded: true })
      const stop = persistTabs()

      store.getState().newTab()
      stop()

      expect(uiStateSave).toHaveBeenCalledTimes(1)
    })

    test('does not store the tabs before the load is complete', () => {
      const stop = persistTabs()

      store.getState().newTab()
      vi.advanceTimersByTime(500)
      stop()

      expect(uiStateSave).not.toHaveBeenCalled()
    })
  })
})

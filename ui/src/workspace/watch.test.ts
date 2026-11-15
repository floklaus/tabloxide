import { beforeEach, describe, expect, test, vi } from 'vitest'
import { commands } from '../bindings'
import { useGitStore } from '../git/gitStore'
import { useTabsStore } from '../tabs/tabsStore'
import { failed, ok, repository } from '../test/gitFixtures'
import {
  onWorkspaceChange,
  startWorkspaceWatch,
  useWorkspaceChangeStore,
} from './watch'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)

const workspaceWatch = vi.mocked(commands.workspaceWatch)
const gitOverview = vi.mocked(commands.gitOverview)
const fileRead = vi.mocked(commands.fileRead)

function openTab(content: string, savedContent: string) {
  useTabsStore.setState({
    tabs: [
      {
        id: 'tab-1',
        title: 'a.sql',
        path: 'a.sql',
        content,
        savedContent,
        connectionId: null,
      },
    ],
    activeId: 'tab-1',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  useGitStore.getState().reset()
  useTabsStore.getState().reset()
  useWorkspaceChangeStore.setState({ count: 0 })
})

describe('workspace watch', () => {
  test('a message of the watcher reads the tabs and the Git status again', async () => {
    openTab('select 1', 'select 1')
    fileRead.mockResolvedValue(ok('select 2'))
    gitOverview.mockResolvedValue(ok(repository()))
    await useGitStore.getState().refresh()
    gitOverview.mockClear()

    expect(await startWorkspaceWatch()).toBeNull()
    workspaceWatch.mock.calls[0][0].onmessage(null)

    await vi.waitFor(() =>
      expect(useTabsStore.getState().tabs[0].content).toBe('select 2'),
    )
    expect(gitOverview).toHaveBeenCalledTimes(1)
    expect(useWorkspaceChangeStore.getState().count).toBe(1)
    expect(useTabsStore.getState().error).toBeNull()
  })

  test('does not read the Git status when the Git panel was not open', async () => {
    onWorkspaceChange()
    await Promise.resolve()

    expect(gitOverview).not.toHaveBeenCalled()
  })

  test('keeps unsaved text and tells the user that the file changed on disk', async () => {
    openTab('my unsaved text', 'select 1')
    fileRead.mockResolvedValue(ok('text of a different program'))

    onWorkspaceChange()

    await vi.waitFor(() =>
      expect(useTabsStore.getState().error).toMatch(/a\.sql/),
    )
    expect(useTabsStore.getState().tabs[0].content).toBe('my unsaved text')
  })

  test('gives no message for unsaved text when the file did not change', async () => {
    openTab('my unsaved text', 'select 1')
    fileRead.mockResolvedValue(ok('select 1'))

    onWorkspaceChange()
    await vi.waitFor(() => expect(fileRead).toHaveBeenCalled())
    await Promise.resolve()

    expect(useTabsStore.getState().error).toBeNull()
  })

  test('returns the message when the system cannot watch the folder', async () => {
    workspaceWatch.mockResolvedValue(failed('too many folders'))

    expect(await startWorkspaceWatch()).toBe('too many folders')
  })
})

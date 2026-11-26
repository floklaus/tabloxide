import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getQueryStore, resetQueryStores } from '../query/queryStore'
import { useTabsStore, type Tab } from '../tabs/tabsStore'
import { makeProfile, makeWorkspace } from '../test/fixtures'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { buildCommands } from './commands'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)

const tab: Tab = {
  id: 'tab-1',
  title: 'Query 1',
  path: null,
  content: 'select 1',
  savedContent: null,
  connectionId: 'c1',
}

function explainEnabled(engine: string): boolean {
  useWorkspaceStore.setState({
    workspace: makeWorkspace([makeProfile({ id: 'c1', name: 'A', engine })]),
  })
  return (
    buildCommands()
      .find((command) => command.id === 'query.explain')
      ?.isEnabled() ?? false
  )
}

describe('the plan tree commands', () => {
  beforeEach(() => {
    resetQueryStores()
    useTabsStore.setState({
      tabs: [tab],
      activeId: tab.id,
      sqlId: tab.id,
      isLoaded: true,
      error: null,
    })
    getQueryStore(tab.id).setState({
      session: { id: 7, connectionId: 'c1', version: '17' },
    })
  })

  test('are for the SQL engines only, also when a connector gives plans', () => {
    expect(explainEnabled('postgres')).toBe(true)
    expect(explainEnabled('mongodb')).toBe(false)
  })
})

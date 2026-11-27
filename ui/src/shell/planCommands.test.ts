import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useEngineStore } from '../engines/engineStore'
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

const ENGINES = useEngineStore.getState().engines

describe('the plan tree commands', () => {
  beforeEach(() => {
    useEngineStore.setState({ engines: ENGINES })
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

  test('are for each engine that gives plans, also a connector engine', () => {
    expect(explainEnabled('postgres')).toBe(true)
    expect(explainEnabled('mongodb')).toBe(true)
  })

  test('are not for an engine without plans', () => {
    useEngineStore.setState({
      engines: useEngineStore.getState().engines.map((entry) =>
        entry.info.engine === 'mongodb'
          ? {
              ...entry,
              info: {
                ...entry.info,
                capabilities: {
                  ...entry.info.capabilities,
                  explainPlan: false,
                  measuredPlan: false,
                },
              },
            }
          : entry,
      ),
    })

    expect(explainEnabled('mongodb')).toBe(false)
  })
})

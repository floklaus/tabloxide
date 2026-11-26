import { beforeEach, describe, expect, test, vi } from 'vitest'
import { isSqlTab, sqlTabForTools, toUiState, useTabsStore } from './tabsStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)

const table = (name: string) => ({
  kind: 'table' as const,
  schema: 'public',
  name,
})

describe('preview tabs', () => {
  beforeEach(() => {
    useTabsStore.getState().reset()
    // A workspace always has a minimum of one SQL tab.
    useTabsStore.getState().newTab()
  })

  test('a selection opens a preview tab next to the active tab, and the next selection replaces it', () => {
    const store = useTabsStore.getState()
    const sql = useTabsStore.getState().tabs[0]

    store.openDetail(table('orders'), 'orders')
    const first = useTabsStore.getState().tabs[1]
    store.openDetail(table('customer'), 'customer')

    const { tabs, activeId } = useTabsStore.getState()
    expect(tabs).toHaveLength(2)
    expect(tabs[1].id).toBe(first.id)
    expect(tabs[1]).toMatchObject({ title: 'customer', isPreview: true })
    expect(activeId).toBe(first.id)
    // The SQL tab stays the tab of the editor and the tools.
    expect(sqlTabForTools()?.id).toBe(sql.id)
    expect(isSqlTab(tabs[1])).toBe(false)
  })

  test('a kept tab stays, and the next selection opens a new preview tab', () => {
    const store = useTabsStore.getState()

    store.openDetail(table('orders'), 'orders', true)
    store.openDetail(table('customer'), 'customer')

    const titles = useTabsStore.getState().tabs.map((tab) => tab.title)
    expect(titles).toEqual(['Query 1', 'orders', 'customer'])
    expect(useTabsStore.getState().tabs[1].isPreview).toBe(false)
  })

  test('the same detail activates its tab, and Enter keeps it', () => {
    const store = useTabsStore.getState()
    store.openDetail(table('orders'), 'orders')
    store.activate(useTabsStore.getState().tabs[0].id)

    store.openDetail(table('orders'), 'orders', true)

    const { tabs, activeId } = useTabsStore.getState()
    expect(tabs).toHaveLength(2)
    expect(activeId).toBe(tabs[1].id)
    expect(tabs[1].isPreview).toBe(false)
  })

  test('closePreview closes only the preview tab', () => {
    const store = useTabsStore.getState()
    store.openDetail(table('orders'), 'orders', true)
    store.openDetail(table('customer'), 'customer')

    store.closePreview()

    expect(useTabsStore.getState().tabs.map((tab) => tab.title)).toEqual([
      'Query 1',
      'orders',
    ])
  })

  test('the stored tabs have no detail tab', () => {
    useTabsStore.getState().openDetail(table('orders'), 'orders', true)
    const { tabs, activeId } = useTabsStore.getState()

    const stored = toUiState(tabs, activeId)

    expect(stored.tabs.map((tab) => tab.title)).toEqual(['Query 1'])
    expect(stored.active_tab).toBeNull()
  })
})

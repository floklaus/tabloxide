import { beforeEach, describe, expect, test, vi } from 'vitest'
import { isDirty, sqlTabForTools, toUiState, useTabsStore } from './tabsStore'

vi.mock('../bindings', async () =>
  (await import('../test/mockBindings')).createBindingsMock(),
)
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }))

const store = useTabsStore

describe('assistant tabs', () => {
  beforeEach(() => store.getState().reset())

  test('an assistant tab keeps the last SQL tab for the tools', () => {
    const first = store.getState().newTab('select 1')
    const second = store.getState().newTab('select 2')
    store.getState().activate(first)

    store.getState().openAssistantTab('session-1')

    const state = store.getState()
    expect(state.activeId).toBe('assistant-session-1')
    expect(sqlTabForTools()?.id).toBe(first)
    expect(second).not.toBe(first)
  })

  test('opens one tab for each session', () => {
    store.getState().newTab()
    store.getState().openAssistantTab('session-1')
    store.getState().newTab()
    store.getState().openAssistantTab('session-1')

    const assistantTabs = store
      .getState()
      .tabs.filter((tab) => tab.assistantSessionId === 'session-1')
    expect(assistantTabs).toHaveLength(1)
    expect(store.getState().activeId).toBe('assistant-session-1')
  })

  test('the stored tabs do not include assistant tabs', () => {
    const id = store.getState().newTab('select 1')
    store.getState().openAssistantTab('session-1')
    const { tabs, activeId } = store.getState()

    const state = toUiState(tabs, activeId)

    expect(state.tabs.map((tab) => tab.id)).toEqual([id])
    expect(state.active_tab).toBeNull()
  })

  test('an assistant tab has no unsaved changes', () => {
    store.getState().newTab()
    store.getState().openAssistantTab('session-1')
    const tab = store.getState().tabs.find((item) => item.assistantSessionId)!

    expect(isDirty(tab)).toBe(false)
  })

  test('a close of the last SQL tab makes a new SQL tab', () => {
    const id = store.getState().newTab('select 1')
    store.getState().openAssistantTab('session-1')

    store.getState().close(id)

    const sqlTabs = store
      .getState()
      .tabs.filter((tab) => tab.assistantSessionId === undefined)
    expect(sqlTabs).toHaveLength(1)
    expect(sqlTabForTools()?.id).toBe(sqlTabs[0].id)
    expect(store.getState().activeId).toBe('assistant-session-1')
  })

  test('a close of the assistant tab activates a neighbour tab', () => {
    const id = store.getState().newTab('select 1')
    store.getState().openAssistantTab('session-1')

    store.getState().close('assistant-session-1')

    expect(store.getState().activeId).toBe(id)
    expect(store.getState().sqlId).toBe(id)
  })

  test('new SQL tabs do not use the title of an assistant tab', () => {
    store.getState().openAssistantTab('session-1')
    const id = store.getState().newTab()

    const tab = store.getState().tabs.find((item) => item.id === id)
    expect(tab?.title).toBe('Query 1')
  })
})

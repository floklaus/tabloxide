import { beforeEach, describe, expect, test, vi } from 'vitest'
import { STANDARD_SETTINGS } from './layout/layoutModel'
import { resetShellStore, useShellStore } from './shellStore'

const store = () => useShellStore.getState()

beforeEach(() => {
  resetShellStore()
})

describe('shellStore layouts', () => {
  test('a change of a panel follows the layout with the same settings', () => {
    store().togglePanel('sidebar')
    expect(store().layoutId).toBeNull()

    store().togglePanel('statusBar')
    // Without the sidebar and the status bar, the window is the Simple layout.
    expect(store().layoutId).toBe('simple')
  })

  test('applies, saves, and deletes a custom layout', () => {
    const layout = {
      id: 'custom-1',
      name: 'Wide results',
      settings: { ...STANDARD_SETTINGS, resultsPosition: 'beside' as const },
      isBuiltIn: false,
    }

    store().saveLayout(layout)
    store().applyLayout('custom-1')
    expect(store().resultsPosition).toBe('beside')
    expect(store().layoutId).toBe('custom-1')

    store().deleteLayout('custom-1')
    expect(store().customLayouts).toEqual([])
    expect(store().layoutId).toBeNull()
    store().applyLayout('no-such-layout')
    expect(store().resultsPosition).toBe('beside')
  })

  test('a built-in layout cannot be saved over', () => {
    store().saveLayout({
      id: 'standard',
      name: 'Standard',
      settings: STANDARD_SETTINGS,
      isBuiltIn: true,
    })

    expect(store().customLayouts).toEqual([])
  })

  test('reads the layout name of an earlier version and damaged values', async () => {
    localStorage.setItem(
      'tabloxide.shell',
      JSON.stringify({
        layout: 'simple',
        sidebarWidth: 5000,
        customLayouts: [
          { id: 'x', name: 'Mine', settings: { editorSize: 99 } },
          { bad: true },
        ],
      }),
    )
    vi.resetModules()

    const { useShellStore: fresh } = await import('./shellStore')
    const state = fresh.getState()

    expect(state.layoutId).toBe('simple')
    expect(state.sidebarWidth).toBe(480)
    expect(state.customLayouts).toHaveLength(1)
    expect(state.customLayouts[0].settings.editorSize).toBe(80)
  })
})

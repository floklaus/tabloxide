import { create } from 'zustand'
import { GRID_VIEW_ID } from './viewTypes'

/** The view of the result of one statement, and the settings of each view that the user changed. */
export type StatementViews = {
  view: string
  /** The settings of each view, by the identifier of the view. */
  settings: Record<string, unknown>
  /** The name of the saved view that the settings came from. */
  savedName: string | null
}

const DEFAULT: StatementViews = {
  view: GRID_VIEW_ID,
  settings: {},
  savedName: null,
}

type ViewState = {
  /** By the identifier of the tab, then by the number of the statement in the script. */
  tabs: Record<string, Record<number, StatementViews>>
  change: (
    tabId: string,
    statement: number,
    change: Partial<StatementViews>,
  ) => void
  reset: () => void
}

/**
 * The view that each result shows. The state is in memory. A new run of a
 * statement keeps the view and the settings of its last run.
 */
export const useViewStore = create<ViewState>((set, get) => ({
  tabs: {},
  change: (tabId, statement, change) => {
    const { tabs } = get()
    const current = tabs[tabId]?.[statement] ?? DEFAULT
    set({
      tabs: {
        ...tabs,
        [tabId]: { ...tabs[tabId], [statement]: { ...current, ...change } },
      },
    })
  },
  reset: () => set({ tabs: {} }),
}))

export function statementViews(
  state: ViewState,
  tabId: string | null,
  statement: number | null,
): StatementViews {
  if (tabId === null || statement === null) return DEFAULT
  return state.tabs[tabId]?.[statement] ?? DEFAULT
}

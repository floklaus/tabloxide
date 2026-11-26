import { create } from 'zustand'

export type ResultsView =
  'results' | 'history' | 'table' | 'plan' | 'diff' | 'console'

type ResultsViewState = {
  view: ResultsView
  setView: (view: ResultsView) => void
}

/** The view that the results pane shows. Other panes can change it. */
export const useResultsViewStore = create<ResultsViewState>((set) => ({
  view: 'results',
  setView: (view) => set({ view }),
}))

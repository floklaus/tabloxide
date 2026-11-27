import { create } from 'zustand'

type ChartUiState = {
  /** `true` if the chart view shows its settings panel. */
  isPanelOpen: boolean
  setPanelOpen: (isPanelOpen: boolean) => void
}

/**
 * The state of the chart view that is the same for all results. It is in
 * memory: each start of the application shows the settings panel.
 */
export const useChartUiStore = create<ChartUiState>((set) => ({
  isPanelOpen: true,
  setPanelOpen: (isPanelOpen) => set({ isPanelOpen }),
}))

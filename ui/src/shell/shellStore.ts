import { create } from 'zustand'
import type { ConnectionProfile } from '../connections/formModel'

export type SidebarView = 'files' | 'connections' | 'schema' | 'git' | 'history'

/** Where the results pane is: below the editor, or beside it. */
export type ResultsPosition = 'below' | 'beside'

/** A built-in layout. `custom` means that the user changed a panel after the selection. */
export type LayoutName = 'standard' | 'simple' | 'custom'

/** The size of the controls and the space around them. */
export type Density = 'comfortable' | 'compact'

export type Panels = {
  sidebar: boolean
  assistant: boolean
  results: boolean
  statusBar: boolean
}

export type Dialog = 'preferences' | 'clone' | 'palette' | 'shortcuts'

/** The connection that the connection form edits. */
export type ConnectionEditing = { profile: ConnectionProfile; isNew: boolean }

export const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const

type Persisted = {
  density: Density
  sidebarView: SidebarView
  panels: Panels
  resultsPosition: ResultsPosition
  layout: LayoutName
  zoom: number
}

type ShellState = Persisted & {
  dialog: Dialog | null
  connectionEditing: ConnectionEditing | null
  /** The line and the column of the cursor in the editor, from 1. */
  cursor: { line: number; column: number } | null

  /** Shows the sidebar with `view`. */
  showSidebar: (view: SidebarView) => void
  /** Selects `view`, or hides the sidebar if it shows `view` already. */
  toggleSidebarView: (view: SidebarView) => void
  togglePanel: (panel: keyof Panels) => void
  setResultsPosition: (position: ResultsPosition) => void
  setDensity: (density: Density) => void
  applyLayout: (layout: Exclude<LayoutName, 'custom'>) => void
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
  openDialog: (dialog: Dialog) => void
  closeDialog: () => void
  editConnection: (editing: ConnectionEditing | null) => void
  setCursor: (cursor: { line: number; column: number } | null) => void
}

const STORAGE_KEY = 'tabloxide.shell'

const LAYOUTS: Record<Exclude<LayoutName, 'custom'>, Panels> = {
  standard: { sidebar: true, assistant: false, results: true, statusBar: true },
  simple: { sidebar: false, assistant: false, results: true, statusBar: false },
}

const DEFAULTS: Persisted = {
  density: 'comfortable',
  sidebarView: 'files',
  panels: LAYOUTS.standard,
  resultsPosition: 'below',
  layout: 'standard',
  zoom: 1,
}

/** Reads the stored layout. A missing or damaged value gives the defaults. */
function load(): Persisted {
  try {
    const stored = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? '{}',
    ) as Partial<Persisted>
    return {
      ...DEFAULTS,
      ...stored,
      density: stored.density === 'compact' ? 'compact' : 'comfortable',
      panels: { ...DEFAULTS.panels, ...stored.panels },
      zoom: ZOOM_STEPS.includes(stored.zoom as (typeof ZOOM_STEPS)[number])
        ? (stored.zoom as number)
        : 1,
    }
  } catch {
    return DEFAULTS
  }
}

function save(state: Persisted): void {
  try {
    const { density, sidebarView, panels, resultsPosition, layout, zoom } =
      state
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        density,
        sidebarView,
        panels,
        resultsPosition,
        layout,
        zoom,
      }),
    )
  } catch {
    // Without the storage, the layout starts with the defaults at the next start.
  }
}

/** Sets the density on the document. The style sheet reads it. */
export function applyDensity(density: Density): void {
  if (density === 'compact')
    document.documentElement.dataset.density = 'compact'
  else delete document.documentElement.dataset.density
}

/** Sets the zoom of the whole window. */
export function applyZoom(zoom: number): void {
  document.documentElement.style.setProperty(
    'zoom',
    zoom === 1 ? '' : String(zoom),
  )
}

function nextZoom(zoom: number, step: 1 | -1): number {
  const index = ZOOM_STEPS.findIndex((value) => value === zoom)
  const next = Math.min(Math.max(index + step, 0), ZOOM_STEPS.length - 1)
  return ZOOM_STEPS[next]
}

export const useShellStore = create<ShellState>((set, get) => {
  /** Changes the persisted values and stores them. */
  const change = (patch: Partial<Persisted>) => {
    set(patch)
    save({ ...get(), ...patch })
  }
  const setPanel = (panel: keyof Panels, value: boolean) =>
    change({ panels: { ...get().panels, [panel]: value }, layout: 'custom' })

  return {
    ...load(),
    dialog: null,
    connectionEditing: null,
    cursor: null,

    showSidebar: (view) => {
      change({ sidebarView: view })
      if (!get().panels.sidebar) setPanel('sidebar', true)
    },
    toggleSidebarView: (view) => {
      const { panels, sidebarView } = get()
      if (panels.sidebar && sidebarView === view) setPanel('sidebar', false)
      else get().showSidebar(view)
    },
    togglePanel: (panel) => setPanel(panel, !get().panels[panel]),
    setResultsPosition: (resultsPosition) => change({ resultsPosition }),
    setDensity: (density) => {
      change({ density })
      applyDensity(density)
    },
    applyLayout: (layout) => change({ layout, panels: LAYOUTS[layout] }),
    zoomIn: () => {
      const zoom = nextZoom(get().zoom, 1)
      change({ zoom })
      applyZoom(zoom)
    },
    zoomOut: () => {
      const zoom = nextZoom(get().zoom, -1)
      change({ zoom })
      applyZoom(zoom)
    },
    resetZoom: () => {
      change({ zoom: 1 })
      applyZoom(1)
    },
    openDialog: (dialog) => set({ dialog }),
    closeDialog: () => set({ dialog: null }),
    editConnection: (connectionEditing) => set({ connectionEditing }),
    setCursor: (cursor) => set({ cursor }),
  }
})

/** Sets the store to its defaults. For tests. */
export function resetShellStore(): void {
  applyDensity('comfortable')
  useShellStore.setState({
    ...DEFAULTS,
    dialog: null,
    connectionEditing: null,
    cursor: null,
  })
}

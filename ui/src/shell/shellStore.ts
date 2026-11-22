import { create } from 'zustand'
import type { ConnectionProfile } from '../connections/formModel'
import {
  BUILT_IN_LAYOUTS,
  normalizeSettings,
  sameSettings,
  STANDARD_SETTINGS,
  type LayoutSettings,
  type Panels,
  type ResultsPosition,
  type SavedLayout,
} from './layout/layoutModel'

export type { Panels, ResultsPosition } from './layout/layoutModel'

export type SidebarView =
  'files' | 'connections' | 'schema' | 'git' | 'history' | 'sessions'

/** The size of the controls and the space around them. */
export type Density = 'comfortable' | 'compact'

export type Dialog =
  'preferences' | 'clone' | 'palette' | 'shortcuts' | 'layout'

/** The connection that the connection form edits. */
export type ConnectionEditing = { profile: ConnectionProfile; isNew: boolean }

export const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const

type Persisted = LayoutSettings & {
  density: Density
  sidebarView: SidebarView
  /** The layout that the window shows. `null` after a change that no layout has. */
  layoutId: string | null
  /** The layouts of the user. The built-in layouts are not here. */
  customLayouts: SavedLayout[]
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
  /** Shows the layout with the identifier `id`. An unknown identifier changes nothing. */
  applyLayout: (id: string) => void
  /** Shows the settings. The layout identifier is the layout with the same settings. */
  applySettings: (settings: LayoutSettings) => void
  /** Adds a custom layout, or replaces the custom layout with the same identifier. */
  saveLayout: (layout: SavedLayout) => void
  deleteLayout: (id: string) => void
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
  openDialog: (dialog: Dialog) => void
  closeDialog: () => void
  editConnection: (editing: ConnectionEditing | null) => void
  setCursor: (cursor: { line: number; column: number } | null) => void
}

const STORAGE_KEY = 'tabloxide.shell'

const DEFAULTS: Persisted = {
  ...STANDARD_SETTINGS,
  density: 'comfortable',
  sidebarView: 'files',
  layoutId: 'standard',
  customLayouts: [],
  zoom: 1,
}

/** Returns the layout settings of the state. */
export function settingsOf(state: LayoutSettings): LayoutSettings {
  const {
    panels,
    resultsPosition,
    assistantPlacement,
    sidebarSide,
    sidebarWidth,
    editorSize,
  } = state
  return {
    panels,
    resultsPosition,
    assistantPlacement,
    sidebarSide,
    sidebarWidth,
    editorSize,
  }
}

/** Returns the built-in layouts and the custom layouts. */
export function allLayouts(customLayouts: SavedLayout[]): SavedLayout[] {
  return [...BUILT_IN_LAYOUTS, ...customLayouts]
}

/** Returns the identifier of the first layout with the same settings, or `null`. */
function matchingLayout(
  settings: LayoutSettings,
  customLayouts: SavedLayout[],
): string | null {
  return (
    allLayouts(customLayouts).find((layout) =>
      sameSettings(layout.settings, settings),
    )?.id ?? null
  )
}

type Stored = Partial<Persisted> & { layout?: string }

function readCustomLayouts(value: unknown): SavedLayout[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (item): item is SavedLayout =>
        typeof item?.id === 'string' && typeof item?.name === 'string',
    )
    .map((item) => ({
      id: item.id,
      name: item.name,
      settings: normalizeSettings(item.settings),
      isBuiltIn: false,
    }))
}

/** Reads the stored layout. A missing or damaged value gives the defaults. */
function load(): Persisted {
  try {
    const stored = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? '{}',
    ) as Stored
    const customLayouts = readCustomLayouts(stored.customLayouts)
    const settings = normalizeSettings(stored)
    // An earlier version stored the name of a built-in layout in `layout`.
    const layoutId =
      stored.layoutId !== undefined
        ? stored.layoutId
        : stored.layout === 'standard' || stored.layout === 'simple'
          ? stored.layout
          : null
    const isKnown = allLayouts(customLayouts).some(
      (layout) => layout.id === layoutId,
    )
    return {
      ...DEFAULTS,
      ...settings,
      sidebarView: stored.sidebarView ?? DEFAULTS.sidebarView,
      density: stored.density === 'compact' ? 'compact' : 'comfortable',
      customLayouts,
      layoutId: isKnown ? layoutId : null,
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
    const persisted: Persisted = {
      ...settingsOf(state),
      density: state.density,
      sidebarView: state.sidebarView,
      layoutId: state.layoutId,
      customLayouts: state.customLayouts,
      zoom: state.zoom,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
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
  /** Changes the layout settings. The layout identifier follows the new settings. */
  const changeSettings = (patch: Partial<LayoutSettings>) => {
    const settings = normalizeSettings({ ...settingsOf(get()), ...patch })
    change({
      ...settings,
      layoutId: matchingLayout(settings, get().customLayouts),
    })
  }
  const setPanel = (panel: keyof Panels, value: boolean) =>
    changeSettings({ panels: { ...get().panels, [panel]: value } })

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
    setResultsPosition: (resultsPosition) =>
      changeSettings({ resultsPosition }),
    setDensity: (density) => {
      change({ density })
      applyDensity(density)
    },
    applyLayout: (id) => {
      const layout = allLayouts(get().customLayouts).find(
        (item) => item.id === id,
      )
      if (layout) change({ ...layout.settings, layoutId: layout.id })
    },
    applySettings: (settings) => changeSettings(settings),
    saveLayout: (layout) => {
      if (layout.isBuiltIn) return
      const stored = { ...layout, settings: normalizeSettings(layout.settings) }
      const others = get().customLayouts.filter((item) => item.id !== layout.id)
      const customLayouts = [...others, stored]
      change({
        customLayouts,
        layoutId: matchingLayout(settingsOf(get()), customLayouts),
      })
    },
    deleteLayout: (id) => {
      const customLayouts = get().customLayouts.filter((item) => item.id !== id)
      change({
        customLayouts,
        layoutId: matchingLayout(settingsOf(get()), customLayouts),
      })
    },
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

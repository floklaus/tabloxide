/** The layout of the main window: which panels show, where, and how large. */

export type Panels = {
  sidebar: boolean
  assistant: boolean
  results: boolean
  statusBar: boolean
}

/** Where the results are: below the editor, beside it, or as a tab in the editor card. */
export type ResultsPosition = 'below' | 'beside' | 'tab'

/** Where the assistant is: in its own column on the right, or below the editor. */
export type AssistantPlacement = 'right' | 'below-editor'

export type SidebarSide = 'left' | 'right'

export type LayoutSettings = {
  panels: Panels
  resultsPosition: ResultsPosition
  assistantPlacement: AssistantPlacement
  sidebarSide: SidebarSide
  /** The width of the sidebar in pixels. */
  sidebarWidth: number
  /** The height of the editor in percent of its column. */
  editorSize: number
}

export type SavedLayout = {
  id: string
  name: string
  settings: LayoutSettings
  /** A built-in layout cannot change. */
  isBuiltIn: boolean
}

export const SIDEBAR_WIDTH = { min: 160, max: 480 } as const
export const EDITOR_SIZE = { min: 20, max: 80 } as const
export const MAX_LAYOUT_NAME = 40

const STANDARD: LayoutSettings = {
  panels: { sidebar: true, assistant: false, results: true, statusBar: true },
  resultsPosition: 'below',
  assistantPlacement: 'right',
  sidebarSide: 'left',
  sidebarWidth: 280,
  editorSize: 60,
}

export const BUILT_IN_LAYOUTS: SavedLayout[] = [
  { id: 'standard', name: 'Standard', settings: STANDARD, isBuiltIn: true },
  {
    id: 'simple',
    name: 'Simple',
    settings: {
      ...STANDARD,
      panels: {
        sidebar: false,
        assistant: false,
        results: true,
        statusBar: false,
      },
    },
    isBuiltIn: true,
  },
]

export const STANDARD_SETTINGS = STANDARD

const clamp = (
  value: number,
  limits: { min: number; max: number },
  fallback: number,
) =>
  Number.isFinite(value)
    ? Math.min(Math.max(Math.round(value), limits.min), limits.max)
    : fallback

/** Returns settings with each value in its range. Unknown values get the standard value. */
export function normalizeSettings(
  value: Partial<LayoutSettings> | undefined,
): LayoutSettings {
  const input = value ?? {}
  return {
    panels: { ...STANDARD.panels, ...input.panels },
    resultsPosition: ['below', 'beside', 'tab'].includes(
      input.resultsPosition ?? '',
    )
      ? (input.resultsPosition as ResultsPosition)
      : STANDARD.resultsPosition,
    assistantPlacement:
      input.assistantPlacement === 'below-editor' ? 'below-editor' : 'right',
    sidebarSide: input.sidebarSide === 'right' ? 'right' : 'left',
    sidebarWidth: clamp(
      input.sidebarWidth ?? NaN,
      SIDEBAR_WIDTH,
      STANDARD.sidebarWidth,
    ),
    editorSize: clamp(
      input.editorSize ?? NaN,
      EDITOR_SIZE,
      STANDARD.editorSize,
    ),
  }
}

/** The panels that the user can move, and their slots. */
export type MovablePanel = 'sidebar' | 'results' | 'assistant'

export type Slot = {
  value: string
  label: string
}

export const SLOTS: Record<MovablePanel, Slot[]> = {
  sidebar: [
    { value: 'left', label: 'Left side of the window' },
    { value: 'right', label: 'Right side of the window' },
  ],
  results: [
    { value: 'below', label: 'Below the editor' },
    { value: 'beside', label: 'Beside the editor' },
    { value: 'tab', label: 'Tab in the editor' },
  ],
  assistant: [
    { value: 'right', label: 'Own column on the right' },
    { value: 'below-editor', label: 'Below the editor' },
  ],
}

/** Returns the slot of a panel in the settings. */
export function slotOf(settings: LayoutSettings, panel: MovablePanel): string {
  if (panel === 'sidebar') return settings.sidebarSide
  if (panel === 'results') return settings.resultsPosition
  return settings.assistantPlacement
}

/** Moves a panel to a slot. A slot that is not valid for the panel changes nothing. */
export function moveToSlot(
  settings: LayoutSettings,
  panel: MovablePanel,
  slot: string,
): LayoutSettings {
  if (!SLOTS[panel].some((item) => item.value === slot)) return settings
  const panels = { ...settings.panels, [panel]: true }
  if (panel === 'sidebar')
    return { ...settings, panels, sidebarSide: slot as SidebarSide }
  if (panel === 'results') {
    return { ...settings, panels, resultsPosition: slot as ResultsPosition }
  }
  return { ...settings, panels, assistantPlacement: slot as AssistantPlacement }
}

/** A short text that tells what the layout shows. */
export function describeSettings(settings: LayoutSettings): string {
  const { panels } = settings
  const parts: string[] = []
  if (panels.sidebar) parts.push(`sidebar on the ${settings.sidebarSide}`)
  parts.push('editor')
  if (panels.results) {
    parts.push(
      settings.resultsPosition === 'tab'
        ? 'results as a tab'
        : `results ${settings.resultsPosition} the editor`,
    )
  }
  if (panels.assistant) {
    parts.push(
      settings.assistantPlacement === 'right'
        ? 'assistant on the right'
        : 'assistant below the editor',
    )
  }
  const text = parts.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function sameSettings(a: LayoutSettings, b: LayoutSettings): boolean {
  return (
    JSON.stringify(normalizeSettings(a)) ===
    JSON.stringify(normalizeSettings(b))
  )
}

/** Returns a name that no layout has, for example "Layout 2". */
export function unusedName(layouts: SavedLayout[], base: string): string {
  const names = new Set(layouts.map((layout) => layout.name.toLowerCase()))
  if (!names.has(base.toLowerCase())) return base
  for (let number = 2; ; number += 1) {
    const candidate = `${base} ${number}`
    if (!names.has(candidate.toLowerCase())) return candidate
  }
}

/** Returns a message if the name is not valid for a layout, or `null`. */
export function nameProblem(
  name: string,
  layouts: SavedLayout[],
  ownId: string | null,
): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Enter a name.'
  if (trimmed.length > MAX_LAYOUT_NAME) {
    return `Use a maximum of ${MAX_LAYOUT_NAME} characters.`
  }
  const isUsed = layouts.some(
    (layout) =>
      layout.id !== ownId &&
      layout.name.toLowerCase() === trimmed.toLowerCase(),
  )
  return isUsed ? 'A layout with this name exists.' : null
}

import type { ComponentType } from 'react'
import type { Column, Row } from '../results/gridModel'

/** The result that a view shows. A view gets the rows that the application loaded. */
export type ResultData = {
  columns: Column[]
  rows: Row[]
  /** `true` if the server has more rows and the view can ask for them. */
  hasMore: boolean
  /** Asks for the next rows. The view gets them as a longer `rows`. */
  onNeedMore: () => void
  /** `false` if the result has rows that are not loaded. */
  isComplete: boolean
  /** The number of rows of the complete result. `null` if it is not known. */
  totalRows: number | null
}

export type ViewProps = ResultData & {
  /**
   * The settings of the view, as the view gave them to `onSettings` or as the
   * view settings file has them. The view owns this value and must check it.
   * `undefined`: the view uses its defaults.
   */
  settings: unknown
  onSettings: (settings: unknown) => void
  /**
   * The view tells the host the settings that it shows now, also when they are
   * its defaults. The host needs them to save the view. `undefined`: the view
   * shows nothing that the host can save.
   */
  onShownSettings?: (settings: unknown) => void
}

/** One view of a result. The built-in views and, later, the view packs have this form. */
export type ResultView = {
  /** The identifier of the view in the view settings file. */
  id: string
  /** The name of the view in the view switch. */
  name: string
  /**
   * How well the view fits the columns of a result, from 0 to 1. The score 0
   * hides the view for this result.
   */
  accepts: (columns: Column[]) => number
  Component: ComponentType<ViewProps>
}

/** The identifier of the grid. It is the default view of each result. */
export const GRID_VIEW_ID = 'grid'
export const CHART_VIEW_ID = 'chart'

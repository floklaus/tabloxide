import type { Column } from '../results/gridModel'
import { CHART_COLUMN_ACTIONS } from './chart/chartFromColumns'
import { ChartView } from './chart/ChartView'
import { chartScore } from './chart/proposeChart'
import { GridView } from './GridView'
import { ProfileView } from './profile/ProfileView'
import {
  CHART_VIEW_ID,
  GRID_VIEW_ID,
  PROFILE_VIEW_ID,
  type ResultView,
} from './viewTypes'

/** The score of the column profile. It is lower than each score of the chart view. */
const PROFILE_SCORE = 0.4

const GRID: ResultView = {
  id: GRID_VIEW_ID,
  name: 'Grid',
  accepts: () => 1,
  Component: GridView,
}

/** The built-in views other than the grid. */
const OTHER_VIEWS: ResultView[] = [
  {
    id: CHART_VIEW_ID,
    name: 'Chart',
    accepts: chartScore,
    Component: ChartView,
    columnActions: CHART_COLUMN_ACTIONS,
  },
  {
    id: PROFILE_VIEW_ID,
    name: 'Profile',
    // The profile fits each result with columns. A chart that fits is before it.
    accepts: (columns) => (columns.length === 0 ? 0 : PROFILE_SCORE),
    Component: ProfileView,
    hasSettings: false,
  },
]

/**
 * The views that accept a result. The grid is always the first view. The other
 * views follow with the best score first.
 */
export function viewsFor(columns: Column[]): ResultView[] {
  const scored = OTHER_VIEWS.map((view) => ({
    view,
    score: view.accepts(columns),
  }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
  return [GRID, ...scored.map((item) => item.view)]
}

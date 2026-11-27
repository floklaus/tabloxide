import { ResultGrid } from '../results/ResultGrid'
import type { ViewProps } from './viewTypes'

/** The grid as a view. It is the first view and the accessible form of each result. */
export function GridView({ columns, rows, hasMore, onNeedMore }: ViewProps) {
  return (
    <ResultGrid
      columns={columns}
      rows={rows}
      hasMore={hasMore}
      onNeedMore={onNeedMore}
    />
  )
}

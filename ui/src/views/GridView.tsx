import { ResultGrid } from '../results/ResultGrid'
import type { ViewProps } from './viewTypes'

/** The grid as a view. It is the first view and the accessible form of each result. */
export function GridView(props: ViewProps) {
  const { columns, rows, hasMore, onNeedMore, columnActions } = props
  return (
    <ResultGrid
      columns={columns}
      rows={rows}
      hasMore={hasMore}
      onNeedMore={onNeedMore}
      columnActions={columnActions}
    />
  )
}

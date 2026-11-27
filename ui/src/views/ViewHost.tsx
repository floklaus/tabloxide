import { useMemo } from 'react'
import { sqlTabIdOf, useTabsStore } from '../tabs/tabsStore'
import { viewsFor } from './registry'
import { useStatementNumber } from './statementNumber'
import { statementViews, useViewStore } from './viewStore'
import { GRID_VIEW_ID, type ResultData } from './viewTypes'

type Props = ResultData & {
  /** The start of the statement in the script. It identifies the statement. */
  statementFrom: number
  /** The position of the statement in the run, from 0. */
  runIndex: number
}

/**
 * Shows one result in the view that the user selected. The host is the only part
 * that knows the views. A view gets the data and its settings, and nothing else.
 */
export function ViewHost(props: Props) {
  const { statementFrom, runIndex, ...data } = props
  // A result without a tab has the empty identifier, as its query state has.
  const tabId = useTabsStore(sqlTabIdOf) ?? ''
  const statement = useStatementNumber(statementFrom, runIndex + 1)
  const state = useViewStore((store) => statementViews(store, tabId, statement))
  const change = useViewStore((store) => store.change)
  const views = useMemo(() => viewsFor(data.columns), [data.columns])
  // A view that does not accept the new columns gives its place to the grid.
  const view = views.find((item) => item.id === state.view) ?? views[0]
  // The number of the statement comes from the backend a moment after the result.
  const canChange = statement !== null

  return (
    <>
      {views.length > 1 && (
        <div
          className="view-switch"
          role="group"
          aria-label="View of the result"
        >
          {views.map((item) => (
            <button
              key={item.id}
              type="button"
              className="button button--small"
              aria-pressed={item.id === view.id}
              disabled={!canChange}
              onClick={() =>
                canChange && change(tabId, statement, { view: item.id })
              }
            >
              {item.name}
            </button>
          ))}
        </div>
      )}
      <view.Component
        // The grid of a different statement starts without the sort of the last one.
        key={`${view.id}-${runIndex}-${statementFrom}`}
        {...data}
        settings={
          view.id === GRID_VIEW_ID ? undefined : state.settings[view.id]
        }
        onSettings={(settings) =>
          canChange &&
          change(tabId, statement, {
            settings: { ...state.settings, [view.id]: settings },
          })
        }
      />
    </>
  )
}

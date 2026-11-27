import { useCallback, useEffect, useMemo, useState } from 'react'
import { sqlTabIdOf, useTabsStore } from '../tabs/tabsStore'
import { viewsFor } from './registry'
import { SavedViews } from './SavedViews'
import { useStatementNumber } from './statementNumber'
import { savedViewsOf, viewFilePath, type SavedView } from './viewFile'
import { useViewFileStore } from './viewFileStore'
import { statementViews, useViewStore } from './viewStore'
import { GRID_VIEW_ID, type ResultData } from './viewTypes'

type Props = ResultData & {
  /** The start of the statement in the script. It identifies the statement. */
  statementFrom: number
  /** The position of the statement in the run, from 0. */
  runIndex: number
}

/** The path of the view settings file of the active tab. `null` for a tab without a file. */
function useViewFilePath(): string | null {
  const queryPath = useTabsStore(
    (state) =>
      state.tabs.find((tab) => tab.id === sqlTabIdOf(state))?.path ?? null,
  )
  return queryPath === null ? null : viewFilePath(queryPath)
}

/**
 * Shows one result in the view that the user selected. The host is the only part
 * that knows the views. A view gets the data and its settings, and nothing else.
 * The host also reads and writes the view settings file.
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

  const filePath = useViewFilePath()
  const loaded = useViewFileStore((store) =>
    filePath === null ? undefined : store.files[filePath],
  )
  const load = useViewFileStore((store) => store.load)
  // Each run reads the file again. A different program can change it, for example Git.
  useEffect(() => {
    if (filePath !== null) void load(filePath)
  }, [filePath, load, data.columns])

  /** The settings that the view shows, with the view that told them. */
  const [shown, setShown] = useState<{ view: string; settings: unknown }>()
  const viewId = view.id
  // The view tells its settings in an effect. The function must stay the same.
  const onShownSettings = useCallback(
    (settings: unknown) => setShown({ view: viewId, settings }),
    [viewId],
  )
  const apply = (saved: SavedView) =>
    canChange &&
    change(tabId, statement, {
      view: saved.view,
      settings: { ...state.settings, [saved.view]: saved.settings },
      savedName: saved.name,
    })
  const select = (id: string) => {
    if (!canChange) return
    // The first saved view of the statement is the start of a view without settings.
    const saved =
      loaded?.status === 'ok' && state.settings[id] === undefined
        ? savedViewsOf(loaded.file, statement, id)[0]
        : undefined
    if (saved) apply(saved)
    else change(tabId, statement, { view: id })
  }

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
              onClick={() => select(item.id)}
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
        onShownSettings={onShownSettings}
      />
      {view.id !== GRID_VIEW_ID && canChange && (
        <SavedViews
          path={filePath}
          loaded={loaded}
          statement={statement}
          view={view.id}
          settings={shown?.view === view.id ? shown.settings : undefined}
          savedName={state.savedName}
          onApply={apply}
          onSavedName={(savedName) => change(tabId, statement, { savedName })}
        />
      )}
    </>
  )
}

import { useState } from 'react'
import { activeQueryStore } from '../query/queryStore'
import {
  fileName,
  savedViewsOf,
  withoutSavedView,
  withSavedView,
  type SavedView,
} from './viewFile'
import { useViewFileStore, type LoadedViewFile } from './viewFileStore'

type Props = {
  /** The path of the view settings file. `null` for a tab without a file. */
  path: string | null
  loaded: LoadedViewFile | undefined
  statement: number
  /** The identifier of the view that shows. */
  view: string
  /** The settings that the view shows. `undefined`: there is nothing to save. */
  settings: unknown
  /** The name of the saved view that the settings came from. */
  savedName: string | null
  onApply: (saved: SavedView) => void
  onSavedName: (name: string | null) => void
}

const NOT_SAVED = ''

function notify(text: string): void {
  activeQueryStore().getState().setNotice(text)
}

/** The name field and the buttons. A new saved view gives the form a new start. */
function SaveForm(props: Props & { path: string; names: string[] }) {
  const { path, statement, view, settings, savedName, names } = props
  const update = useViewFileStore((state) => state.update)
  const [name, setName] = useState(savedName ?? '')
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = name.trim()

  const run = async (
    change: Parameters<typeof update>[1],
    done: () => void,
  ) => {
    setIsBusy(true)
    const failure = await update(path, change)
    setIsBusy(false)
    setError(failure)
    if (failure === null) done()
  }
  const save = () =>
    run(
      (file) =>
        withSavedView(file, { name: trimmed, statement, view, settings }),
      () => {
        props.onSavedName(trimmed)
        notify(`Saved the view "${trimmed}" to ${fileName(path)}.`)
      },
    )
  const remove = (target: string) =>
    run(
      (file) => withoutSavedView(file, statement, target),
      () => {
        props.onSavedName(null)
        notify(`Removed the view "${target}" from ${fileName(path)}.`)
      },
    )

  return (
    <>
      <label className="chart__field">
        <span>Name of the view</span>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="button button--small"
        disabled={isBusy || trimmed === '' || settings === undefined}
        title={`Writes the view to ${fileName(path)}, next to the query file.`}
        onClick={() => void save()}
      >
        {names.includes(trimmed) ? 'Save view' : 'Save as new view'}
      </button>
      {savedName !== null && names.includes(savedName) && (
        <button
          type="button"
          className="button button--small"
          disabled={isBusy}
          onClick={() => void remove(savedName)}
        >
          Remove view
        </button>
      )}
      {error !== null && (
        <p className="saved-views__error" role="alert">
          {error}
        </p>
      )}
    </>
  )
}

/**
 * The saved views of a result. The host shows this bar with each view other than
 * the grid. The views are in the view settings file next to the query file.
 */
export function SavedViews(props: Props) {
  const { path, loaded, statement, view, savedName } = props
  if (path === null) {
    return (
      <p className="saved-views saved-views__hint">
        To save this view, save the query to a file first.
      </p>
    )
  }
  if (loaded === undefined) return null
  if (loaded.status === 'invalid') {
    return (
      <p className="saved-views saved-views__error" role="alert">
        The application cannot use the view file {fileName(path)}.{' '}
        {loaded.error} Correct the file or remove it from the folder. Then run
        the statement again.
      </p>
    )
  }
  const saved =
    loaded.status === 'ok' ? savedViewsOf(loaded.file, statement, view) : []
  const names = saved.map((item) => item.name)
  const selected =
    savedName !== null && names.includes(savedName) ? savedName : NOT_SAVED

  return (
    <div className="saved-views" role="group" aria-label="Saved views">
      {saved.length > 0 && (
        <label className="chart__field">
          <span>Saved view</span>
          <select
            value={selected}
            onChange={(event) => {
              const found = saved.find(
                (item) => item.name === event.target.value,
              )
              if (found) props.onApply(found)
              else props.onSavedName(null)
            }}
          >
            <option value={NOT_SAVED}>Not saved</option>
            {names.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
      <SaveForm key={selected} {...props} path={path} names={names} />
    </div>
  )
}

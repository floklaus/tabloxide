/**
 * The view settings file of a query file. It is next to the query file, for
 * example `revenue.sql` and `revenue.view.json`, thus it is in the Git
 * repository of the user. `docs/Visualization Design.md` gives the format.
 */

export const VIEW_FILE_VERSION = 1
const SUFFIX = '.view.json'

/** One saved view of the result of a statement. */
export type SavedView = {
  name: string
  /** The number of the statement in the query file, from 1. */
  statement: number
  /** The identifier of the view, for example `chart`. */
  view: string
  /** The settings of the view. The view owns this value and checks it. */
  settings: unknown
}

export type ViewFile = {
  version: typeof VIEW_FILE_VERSION
  views: SavedView[]
}

export const EMPTY_VIEW_FILE: ViewFile = {
  version: VIEW_FILE_VERSION,
  views: [],
}

/** Returns the path of the view settings file of a query file. */
export function viewFilePath(queryPath: string): string {
  const slash = queryPath.lastIndexOf('/')
  const dot = queryPath.lastIndexOf('.')
  // A dot at the start of the name is not the start of an extension.
  const base = dot > slash + 1 ? queryPath.slice(0, dot) : queryPath
  return `${base}${SUFFIX}`
}

export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function directoryOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSavedView(value: unknown): value is SavedView {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    Number.isInteger(value.statement) &&
    (value.statement as number) >= 1 &&
    typeof value.view === 'string' &&
    'settings' in value
  )
}

/**
 * Reads the text of a view settings file. Returns the reason as a sentence if
 * the text is not valid. The parts that this version does not know stay in the
 * value, thus a save does not remove them.
 */
export function parseViewFile(
  text: string,
): { file: ViewFile } | { error: string } {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { error: 'The file is not valid JSON.' }
  }
  if (!isRecord(value)) return { error: 'The file is not a JSON object.' }
  if (value.version !== VIEW_FILE_VERSION) {
    return {
      error: `The file has the version ${JSON.stringify(value.version)}. This version of the application reads the version ${VIEW_FILE_VERSION}.`,
    }
  }
  if (!Array.isArray(value.views)) {
    return { error: 'The file has no list "views".' }
  }
  const bad = value.views.findIndex((item) => !isSavedView(item))
  if (bad >= 0) {
    return {
      error: `The view ${bad + 1} of the file needs a name, a statement number, a view, and settings.`,
    }
  }
  return { file: value as ViewFile }
}

/** The text of the file. Each setting is on its own line, thus a Git diff is easy to read. */
export function serializeViewFile(file: ViewFile): string {
  return `${JSON.stringify(file, null, 2)}\n`
}

/** The saved views of one statement for one view, in the sequence of the file. */
export function savedViewsOf(
  file: ViewFile,
  statement: number,
  view: string,
): SavedView[] {
  return file.views.filter(
    (item) => item.statement === statement && item.view === view,
  )
}

function isSame(a: SavedView, b: Pick<SavedView, 'statement' | 'name'>) {
  return a.statement === b.statement && a.name === b.name
}

/**
 * Returns the file with the view. A view with the same name for the same
 * statement gets the new content at its position. A new view goes to the end.
 */
export function withSavedView(file: ViewFile, view: SavedView): ViewFile {
  const exists = file.views.some((item) => isSame(item, view))
  return {
    ...file,
    views: exists
      ? file.views.map((item) =>
          isSame(item, view) ? { ...item, ...view } : item,
        )
      : [...file.views, view],
  }
}

export function withoutSavedView(
  file: ViewFile,
  statement: number,
  name: string,
): ViewFile {
  return {
    ...file,
    views: file.views.filter((item) => !isSame(item, { statement, name })),
  }
}

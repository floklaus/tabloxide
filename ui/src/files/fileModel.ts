import type { FileEntry } from '../bindings'

/** The listing of one directory of the workspace. */
export type Listing =
  | { status: 'loading' }
  | { status: 'loaded'; entries: FileEntry[] }
  | { status: 'failed'; message: string }

/** The path of the workspace root. */
export const ROOT = ''

/** One row of the file tree: a file, a folder, or a note in place of a listing. */
export type FileRow =
  | {
      type: 'entry'
      key: string
      entry: FileEntry
      /** The level in the tree, from 1. */
      level: number
      isOpen: boolean
      parentKey: string | null
    }
  | {
      type: 'note'
      key: string
      text: string
      isError: boolean
      level: number
    }

/** Returns the path of the directory that contains `path`. */
export function parentOf(path: string): string {
  const end = path.lastIndexOf('/')
  return end < 0 ? ROOT : path.slice(0, end)
}

type Input = {
  listings: Record<string, Listing>
  expanded: ReadonlySet<string>
  filter: string
}

function matches(entry: FileEntry, text: string): boolean {
  return entry.name.toLowerCase().includes(text)
}

/** `true` if a loaded listing below `directory` has an entry that matches. */
function hasMatch(
  listings: Record<string, Listing>,
  directory: string,
  text: string,
): boolean {
  const listing = listings[directory]
  if (listing?.status !== 'loaded') return false
  return listing.entries.some(
    (entry) =>
      matches(entry, text) ||
      (entry.is_directory && hasMatch(listings, entry.path, text)),
  )
}

/**
 * The visible rows of the tree, in their sequence. Without a filter, the rows are
 * the entries of the open folders. With a filter, the rows are the loaded entries
 * whose name contains the text, and the folders that contain them. The filter
 * cannot find entries in a folder that did not load.
 */
export function buildFileRows({ listings, expanded, filter }: Input) {
  const text = filter.trim().toLowerCase()
  const rows: FileRow[] = []
  const walk = (directory: string, level: number) => {
    const listing = listings[directory]
    const parentKey = directory === ROOT ? null : directory
    if (!listing || listing.status === 'loading') {
      if (!text && directory !== ROOT) {
        rows.push({
          type: 'note',
          key: `note:${directory}`,
          text: 'Loading…',
          isError: false,
          level,
        })
      }
      return
    }
    if (listing.status === 'failed') {
      if (!text && directory !== ROOT) {
        rows.push({
          type: 'note',
          key: `note:${directory}`,
          text: listing.message,
          isError: true,
          level,
        })
      }
      return
    }
    for (const entry of listing.entries) {
      const isMatchBelow =
        text !== '' &&
        entry.is_directory &&
        hasMatch(listings, entry.path, text)
      if (text && !matches(entry, text) && !isMatchBelow) continue
      const isOpen =
        entry.is_directory && (expanded.has(entry.path) || isMatchBelow)
      rows.push({
        type: 'entry',
        key: entry.path,
        entry,
        level,
        isOpen,
        parentKey,
      })
      if (isOpen) walk(entry.path, level + 1)
    }
  }
  walk(ROOT, 1)
  return rows
}

/** The status line: the number of folders and files that show. */
export function fileStatus(rows: FileRow[]): string {
  const entries = rows.filter((row) => row.type === 'entry')
  const folders = entries.filter((row) => row.entry.is_directory).length
  const files = entries.length - folders
  return `${folders} ${folders === 1 ? 'folder' : 'folders'}, ${files} ${
    files === 1 ? 'file' : 'files'
  }`
}

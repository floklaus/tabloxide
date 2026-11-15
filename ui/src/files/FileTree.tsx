import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { commands, type FileEntry } from '../bindings'
import { toMessage } from '../lib/errors'
import { useWorkspaceChangeStore } from '../workspace/watch'
import { useTabsStore } from '../tabs/tabsStore'

type Listing =
  | { status: 'loading' }
  | { status: 'loaded'; entries: FileEntry[] }
  | { status: 'failed'; message: string }

const ROOT = ''
const INDENT_REM = 0.9

async function list(directory: string): Promise<Listing> {
  try {
    const result = await commands.fileList(directory)
    return result.status === 'ok'
      ? { status: 'loaded', entries: result.data }
      : { status: 'failed', message: result.error.message }
  } catch (error) {
    return { status: 'failed', message: toMessage(error) }
  }
}

/** Returns the path of the directory that contains `path`. */
function parentOf(path: string): string {
  const end = path.lastIndexOf('/')
  return end < 0 ? ROOT : path.slice(0, end)
}

/** The note that shows in place of the tree while the root has no entry to show. */
function renderRootNote(listing: Listing | undefined) {
  if (!listing || listing.status === 'loading') {
    return <p className="files__note">Loading…</p>
  }
  if (listing.status === 'failed') {
    return (
      <p className="files__note files__note--error" role="alert">
        {listing.message}
      </p>
    )
  }
  if (listing.entries.length === 0) {
    return <p className="files__note">The workspace folder is empty.</p>
  }
  return null
}

/** The files of the workspace. The tree loads a directory only when the user opens it. */
export function FileTree() {
  const [listings, setListings] = useState<Record<string, Listing>>({})
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set([ROOT]))
  const openFile = useTabsStore((state) => state.openFile)
  const activePath = useTabsStore(
    (state) => state.tabs.find((tab) => tab.id === state.activeId)?.path,
  )

  // A directory without a listing shows as "Loading…".
  const load = useCallback(async (directory: string) => {
    const listing = await list(directory)
    setListings((current) => ({ ...current, [directory]: listing }))
  }, [])

  useEffect(() => {
    let isActive = true
    void list(ROOT).then((listing) => {
      if (isActive) setListings((current) => ({ ...current, [ROOT]: listing }))
    })
    return () => {
      isActive = false
    }
  }, [])

  // Only one tree item is in the Tab key sequence. The arrow keys move between the items.
  const [focusPath, setFocusPath] = useState<string | null>(null)
  const visiblePaths = (directory: string): string[] => {
    const listing = listings[directory]
    if (listing?.status !== 'loaded') return []
    return listing.entries.flatMap((entry) =>
      entry.is_directory && expanded.has(entry.path)
        ? [entry.path, ...visiblePaths(entry.path)]
        : [entry.path],
    )
  }
  const visible = visiblePaths(ROOT)
  const tabStop =
    focusPath !== null && visible.includes(focusPath) ? focusPath : visible[0]

  const refresh = () => {
    for (const directory of expanded) void load(directory)
  }
  // A different program changed files. Read the open directories again.
  const changeCount = useWorkspaceChangeStore((state) => state.count)
  const expandedRef = useRef(expanded)
  useEffect(() => {
    expandedRef.current = expanded
  }, [expanded])
  useEffect(() => {
    if (changeCount === 0) return
    for (const directory of expandedRef.current) void load(directory)
  }, [changeCount, load])
  const toggle = (directory: string) => {
    const next = new Set(expanded)
    if (!next.delete(directory)) {
      next.add(directory)
      void load(directory)
    }
    setExpanded(next)
  }

  /** The keyboard behaviour of the ARIA tree view pattern. */
  const onTreeKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]'),
    )
    const index = items.indexOf(event.target as HTMLElement)
    if (index < 0) return
    const item = items[index]
    const path = item.dataset.path ?? ROOT
    const isOpen = item.getAttribute('aria-expanded')
    const focusPathItem = (target: string) =>
      items.find((candidate) => candidate.dataset.path === target)?.focus()
    const actions: Record<string, (() => void) | undefined> = {
      ArrowDown: () => items[index + 1]?.focus(),
      ArrowUp: () => items[index - 1]?.focus(),
      Home: () => items[0].focus(),
      End: () => items[items.length - 1].focus(),
      ArrowRight: () => {
        if (isOpen === 'false') toggle(path)
        else if (isOpen === 'true')
          focusPathItem(visible[visible.indexOf(path) + 1])
      },
      ArrowLeft: () => {
        if (isOpen === 'true') toggle(path)
        else focusPathItem(parentOf(path))
      },
    }
    const action = actions[event.key]
    if (!action) return
    event.preventDefault()
    action()
  }

  const renderDirectory = (directory: string, depth: number) => {
    const listing = listings[directory]
    const indent = { paddingLeft: `${depth * INDENT_REM}rem` }
    // A tree can contain only tree items. Thus a note is a presentation item.
    if (!listing || listing.status === 'loading') {
      return (
        <li className="files__note" style={indent} role="none">
          Loading…
        </li>
      )
    }
    if (listing.status === 'failed') {
      return (
        <li
          className="files__note files__note--error"
          style={indent}
          role="none"
        >
          <span role="alert">{listing.message}</span>
        </li>
      )
    }
    return listing.entries.map((entry) => {
      const isOpen = expanded.has(entry.path)
      return (
        <li key={entry.path} role="none">
          {entry.is_directory ? (
            <button
              type="button"
              role="treeitem"
              className="files__item"
              style={indent}
              data-path={entry.path}
              tabIndex={entry.path === tabStop ? 0 : -1}
              onFocus={() => setFocusPath(entry.path)}
              aria-expanded={isOpen}
              onClick={() => toggle(entry.path)}
            >
              <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span> {entry.name}
            </button>
          ) : (
            <button
              type="button"
              role="treeitem"
              className="files__item"
              style={indent}
              data-path={entry.path}
              tabIndex={entry.path === tabStop ? 0 : -1}
              onFocus={() => setFocusPath(entry.path)}
              aria-current={entry.path === activePath}
              onClick={() => void openFile(entry.path)}
            >
              {entry.name}
            </button>
          )}
          {entry.is_directory && isOpen && (
            <ul role="group">{renderDirectory(entry.path, depth + 1)}</ul>
          )}
        </li>
      )
    })
  }

  // A tree without a tree item is not valid. Thus a note replaces the tree.
  const rootNote = renderRootNote(listings[ROOT])

  return (
    <section className="files" aria-label="Files">
      <div className="connections__header">
        <h2 className="pane__title">Files</h2>
        <button type="button" className="link-button" onClick={refresh}>
          Refresh
        </button>
      </div>
      {rootNote ?? (
        <ul
          className="files__tree"
          role="tree"
          aria-label="Workspace files"
          onKeyDown={onTreeKeyDown}
        >
          {renderDirectory(ROOT, 0)}
        </ul>
      )}
    </section>
  )
}

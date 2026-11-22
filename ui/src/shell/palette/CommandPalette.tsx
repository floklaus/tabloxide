import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { useShellStore } from '../shellStore'
import { parseQuery, search, type PaletteEntry } from './paletteSearch'
import { commandEntries, fileEntries, schemaEntries } from './paletteSources'

/** Reads the files, and the schema objects after the first word, while the palette is open. */
function useAsyncEntries(query: string): PaletteEntry[] {
  const [files, setFiles] = useState<PaletteEntry[]>([])
  const [schema, setSchema] = useState<PaletteEntry[]>([])
  const wantsSchema =
    parseQuery(query).words.length > 0 || query.trimStart().startsWith('@')

  useEffect(() => {
    let isActive = true
    void fileEntries().then((entries) => {
      if (isActive) setFiles(entries)
    })
    return () => {
      isActive = false
    }
  }, [])

  // The catalog opens a database session. The palette reads it only for a search.
  useEffect(() => {
    if (!wantsSchema) return
    let isActive = true
    void schemaEntries().then((entries) => {
      if (isActive) setSchema(entries)
    })
    return () => {
      isActive = false
    }
  }, [wantsSchema])

  return useMemo(() => [...files, ...schema], [files, schema])
}

/** Searches the commands, the files, the schema objects, and the settings (Ctrl+K). */
export function CommandPalette() {
  const close = useShellStore((state) => state.closeDialog)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const commands = useMemo(() => commandEntries(), [])
  const loaded = useAsyncEntries(query)
  const results = useMemo(
    () => search([...commands, ...loaded], query),
    [commands, loaded, query],
  )
  const listId = useId()
  const previous = useRef<Element | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const selected = Math.min(active, Math.max(results.length - 1, 0))

  useEffect(() => {
    previous.current = document.activeElement
    return () => {
      if (previous.current instanceof HTMLElement) previous.current.focus()
    }
  }, [])

  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [selected])

  const runEntry = (entry: PaletteEntry | undefined) => {
    if (!entry) return
    close()
    entry.run()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = results.length
    const actions: Record<string, () => void> = {
      ArrowDown: () => setActive(count === 0 ? 0 : (selected + 1) % count),
      ArrowUp: () =>
        setActive(count === 0 ? 0 : (selected - 1 + count) % count),
      Enter: () => runEntry(results[selected]),
      Escape: () => close(),
    }
    const action = actions[event.key]
    if (!action) return
    event.preventDefault()
    event.stopPropagation()
    action()
  }

  return (
    <div
      className="palette__backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <input
          className="palette__input"
          type="text"
          role="combobox"
          aria-label="Search or run a command"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            results[selected] ? `${listId}-${selected}` : undefined
          }
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
        />
        <p className="palette__hint">
          Type &gt; for commands, @ for schema objects
        </p>
        <ul
          hidden={results.length === 0}
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label="Results"
          className="palette__list"
        >
          {results.map((entry, index) => {
            const previous = results[index - 1]
            const heading = previous?.group !== entry.group ? entry.group : null
            return [
              heading && (
                <li
                  key={`group-${heading}`}
                  role="presentation"
                  className="palette__group"
                >
                  {heading}
                </li>
              ),
              <li
                key={entry.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === selected}
                className="palette__option"
                onMouseMove={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runEntry(entry)}
              >
                <span className="palette__label">{entry.label}</span>
                {entry.detail && (
                  <span className="palette__detail">{entry.detail}</span>
                )}
                {entry.shortcut && (
                  <span className="palette__shortcut" aria-hidden="true">
                    {entry.shortcut}
                  </span>
                )}
              </li>,
            ]
          })}
        </ul>
        {results.length === 0 && (
          <p role="status" className="palette__empty">
            Nothing matches.
          </p>
        )}
        <p className="palette__footer" aria-hidden="true">
          ↑↓ to move · Enter to run · Esc to close
        </p>
      </div>
    </div>
  )
}

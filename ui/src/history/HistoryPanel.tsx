import { useCallback, useEffect, useState } from 'react'
import { commands, type HistoryEntry_Serialize } from '../bindings'
import { ConfirmDialog } from '../connections/ConfirmDialog'
import { toMessage } from '../lib/errors'
import { activeQueryStore } from '../query/queryStore'
import { useTabsStore } from '../tabs/tabsStore'

export type HistoryEntry = HistoryEntry_Serialize

/** Time without a key press before the search starts. */
const SEARCH_DELAY_MS = 250
/** Prefix of an entry that has no statement text. The backend writes it. */
const NOT_RECORDED_PREFIX = '-- Not recorded'

const timeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'medium',
})

function describe(entry: HistoryEntry): string {
  const time =
    entry.elapsed_ms < 1000
      ? `${entry.elapsed_ms} ms`
      : `${(entry.elapsed_ms / 1000).toFixed(2)} s`
  if (entry.status === 'cancelled') return `Cancelled, ${time}`
  if (entry.status === 'failed') return `Failed, ${time}`
  return entry.rows === null ? time : `${entry.rows} rows, ${time}`
}

type Props = {
  /** Shows the results pane after a run starts from the history. */
  onRun: () => void
}

export function HistoryPanel({ onRun }: Props) {
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isConfirming, setIsConfirming] = useState(false)
  const newTab = useTabsStore((state) => state.newTab)
  const setConnection = useTabsStore((state) => state.setConnection)

  const search = useCallback(async (text: string) => {
    try {
      const result = await commands.historySearch(text)
      if (result.status === 'ok') {
        setEntries(result.data)
        setError(null)
      } else {
        setError(result.error.message)
      }
    } catch (failure) {
      setError(toMessage(failure))
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => void search(query), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [query, search])

  const openInTab = (entry: HistoryEntry) => {
    const id = newTab(entry.sql)
    setConnection(id, entry.connection_id)
  }
  const runAgain = (entry: HistoryEntry) => {
    const tabs = useTabsStore.getState()
    const tab = tabs.tabs.find((item) => item.id === tabs.activeId)
    const connectionId = tab?.connectionId ?? entry.connection_id
    if (tab && !tab.connectionId) setConnection(tab.id, connectionId)
    void activeQueryStore()
      .getState()
      .run(entry.sql, { type: 'all' }, connectionId)
    onRun()
  }
  const clear = async () => {
    setIsConfirming(false)
    try {
      const result = await commands.historyClear()
      if (result.status === 'error') setError(result.error.message)
    } catch (failure) {
      setError(toMessage(failure))
    }
    await search(query)
  }

  return (
    <div className="history">
      <div className="results__bar">
        <input
          type="search"
          className="history__search"
          aria-label="Search the history"
          placeholder="Search the history"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          type="button"
          className="button button--small button--danger"
          disabled={entries.length === 0}
          onClick={() => setIsConfirming(true)}
        >
          Clear history
        </button>
      </div>
      {error && (
        <p className="message message--error" role="alert">
          {error}
        </p>
      )}
      {entries.length === 0 && !error && (
        <p className="pane__hint">
          {query ? 'No entry contains this text.' : 'The history is empty.'}
        </p>
      )}
      <ul className="history__list" aria-label="Query history">
        {entries.map((entry) => {
          const hasText = !entry.sql.startsWith(NOT_RECORDED_PREFIX)
          return (
            <li key={entry.id} className="history__entry">
              <div className="history__meta">
                <span>{timeFormat.format(entry.executed_at_secs * 1000)}</span>
                <span>{entry.connection_name}</span>
                <span className={`history__status--${entry.status}`}>
                  {describe(entry)}
                </span>
              </div>
              <pre className="history__sql">{entry.sql}</pre>
              {entry.error && <p className="history__error">{entry.error}</p>}
              {hasText && (
                <div className="history__actions">
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => openInTab(entry)}
                  >
                    Open in a new tab
                  </button>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => runAgain(entry)}
                  >
                    Run again
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {isConfirming && (
        <ConfirmDialog
          title="Clear the history?"
          message="This deletes all history entries of this workspace. You cannot undo this."
          confirmLabel="Clear history"
          onConfirm={() => void clear()}
          onCancel={() => setIsConfirming(false)}
        />
      )}
    </div>
  )
}

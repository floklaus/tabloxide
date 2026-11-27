import { AiAction } from '../assistant/AiAction'
import { useResultsViewStore } from '../results/resultsViewStore'
import { Icon } from '../shell/icons'
import { StatusMark } from '../view/StatusMark'
import {
  HISTORY_STATUS,
  dayName,
  durationText,
  explainEntry,
  hasText,
  openInTab,
  runAgain,
  timeText,
  useHistoryStore,
} from './historyStore'
import { countText } from '../lib/countText'

const TITLES = {
  ok: 'Query',
  failed: 'Failed query',
  cancelled: 'Cancelled query',
}

/** The detail tab of a history entry: its statement, its result, and its actions. */
export function HistoryDetail({ id }: { id: number }) {
  const entry = useHistoryStore((state) =>
    state.entries.find((item) => item.id === id),
  )
  if (!entry) {
    return (
      <p className="pane__hint">
        The history has no entry with this number now.
      </p>
    )
  }
  const state = HISTORY_STATUS[entry.status]
  const canUse = hasText(entry)
  return (
    <div className="table-detail">
      <div className="table-detail__header">
        <StatusMark status={state.status} label={state.label} />
        <h3 className="table-detail__title">{TITLES[entry.status]}</h3>
        <span className="view__spacer" />
        <button
          type="button"
          className="button button--small"
          disabled={!canUse}
          onClick={() => openInTab(entry)}
        >
          <Icon name="external" size={14} />
          Open in a new tab
        </button>
        <button
          type="button"
          className="button button--small"
          disabled={!canUse}
          onClick={() => {
            runAgain(entry)
            useResultsViewStore.getState().setView('results')
          }}
        >
          <Icon name="play" size={14} />
          Run again
        </button>
        <button
          type="button"
          className="button button--small"
          disabled={!canUse}
          title="Reads the plan of the statement on the connection of the entry. The statement does not run."
          onClick={() => explainEntry(entry)}
        >
          Explain
        </button>
      </div>
      <p className="results__status">
        {[
          entry.connection_name,
          `${dayName(entry.executed_at_secs).toLowerCase()} ${timeText(entry.executed_at_secs)}`,
          durationText(entry),
          entry.rows === null ? null : countText(entry.rows, 'row'),
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <pre className="history-detail__sql">{entry.sql}</pre>
      {entry.error && (
        <div className="view-state view-state--error" role="alert">
          <p className="view-state__detail">{entry.error}</p>
          {canUse && (
            <AiAction
              label="Explain and fix"
              title="The AI explains the error and proposes a fix. The request sends the statement, the error, and the structure of the database. It sends no rows."
              request={() => ({
                task: 'query-error',
                text: 'Explain the error and fix the statement.',
                context: {
                  type: 'query-error',
                  statement: entry.sql,
                  message: entry.error ?? '',
                  detail: null,
                  position: null,
                  hint: null,
                  code: null,
                },
              })}
            />
          )}
        </div>
      )}
      <p className="results__status">
        The history keeps the SQL text, the connection, the time, and the
        result. It does not keep rows.
      </p>
    </div>
  )
}

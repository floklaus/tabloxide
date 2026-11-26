import { AiAction } from '../assistant/AiAction'
import type { ActionRequest } from '../assistant/assistantStore'
import { DiffView } from '../git/DiffView'
import { PlanView } from '../plan/PlanView'
import { HistoryPanel } from '../history/HistoryPanel'
import {
  activeQueryStore,
  MAX_LOADED_ROWS,
  useQuery,
} from '../query/queryStore'
import type { QueryError, StatementReport } from '../query/queryStore'
import type { Location } from '../bindings'
import { TableDetail } from '../schema/TableDetail'
import { sqlTabForTools } from '../tabs/tabsStore'
import { AskAboutRows } from './AskAboutRows'
import { ResultGrid } from './ResultGrid'
import { useResultsViewStore, type ResultsView } from './resultsViewStore'

const PREVIEW_LENGTH = 48
const numberFormat = new Intl.NumberFormat('en-US')

function count(value: number, noun: string): string {
  return `${numberFormat.format(value)} ${noun}${value === 1 ? '' : 's'}`
}

function elapsed(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`
}

function summary(statement: StatementReport): string {
  const { outcome } = statement
  if (outcome.type === 'failed') {
    return outcome.error.kind === 'cancelled' ? 'Cancelled' : 'Failed'
  }
  if (outcome.type === 'command') return count(outcome.affected_rows, 'row')
  return count(outcome.total_rows ?? outcome.rows.length, 'row')
}

function preview(sql: string, statement: StatementReport): string {
  const text = sql
    .slice(statement.range.from, statement.range.to)
    .replace(/\s+/g, ' ')
  return text.length > PREVIEW_LENGTH
    ? `${text.slice(0, PREVIEW_LENGTH)}…`
    : text
}

const ERROR_TITLES: Record<QueryError['kind'], string> = {
  database: 'The statement failed',
  cancelled: 'The statement was cancelled',
  timeout: 'The statement exceeded the query timeout',
  'connection-lost': 'The connection closed',
  other: 'The statement failed',
}

/** The errors that the AI can explain. A cancel or a lost connection is not one. */
const FIXABLE: ReadonlySet<QueryError['kind']> = new Set(['database', 'other'])

/** Makes the request of "Explain and fix" for the statement that failed. */
function fixRequest(
  error: QueryError,
  range: StatementReport['range'],
): ActionRequest {
  const sql = activeQueryStore().getState().ranSql
  const original = sql.slice(range.from, range.to)
  const tab = sqlTabForTools()
  return {
    task: 'query-error',
    text: 'Explain the error and fix the statement.',
    context: {
      type: 'query-error',
      statement: original,
      message: error.message,
      detail: error.detail,
      position: error.position,
      hint: error.hint,
      code: error.code,
    },
    ...(tab
      ? {
          replace: {
            tabId: tab.id,
            tabTitle: tab.title,
            from: range.from,
            to: range.to,
            document: sql,
          },
        }
      : {}),
  }
}

function ErrorMessage(props: {
  error: QueryError
  location: Location | null
  /** The statement that failed. Without it, the AI action is not available. */
  range?: StatementReport['range']
}) {
  const { error, location, range } = props
  const setJumpTo = useQuery((state) => state.setJumpTo)
  const canFix = range !== undefined && FIXABLE.has(error.kind)
  return (
    <div className="message message--error" role="alert">
      <p className="message__title">{ERROR_TITLES[error.kind]}</p>
      <p className="message__detail">{error.message}</p>
      {error.detail && <p className="message__detail">{error.detail}</p>}
      {error.hint && <p className="message__detail">Hint: {error.hint}</p>}
      {error.code && (
        <p className="message__detail">Error code: {error.code}</p>
      )}
      {(location || canFix) && (
        <div className="message__actions">
          {canFix && (
            <AiAction
              label="Explain and fix"
              title="The AI explains the error and proposes a fix. The request sends the statement, the error, and the structure of the database. It sends no rows."
              request={() => fixRequest(error, range)}
            />
          )}
          {location && (
            <button
              type="button"
              className="link-button"
              onClick={() => setJumpTo(location.offset)}
            >
              Go to line {location.line}, column {location.column}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function RowsStatus(props: { statement: StatementReport; index: number }) {
  const { statement, index } = props
  const open = useQuery((state) => state.open)
  const isFetching = useQuery((state) => state.isFetching)
  const stopReason = useQuery((state) => state.stopReason)
  const { outcome } = statement
  if (outcome.type !== 'rows') return null

  const loaded = outcome.rows.length
  const total = outcome.total_rows
  const isOpen = open?.index === index
  let text = count(loaded, 'row')
  if (isOpen) {
    text += isFetching ? ' loaded. Loading more…' : ' loaded. Scroll for more.'
  } else if (!outcome.is_complete && stopReason === 'row-limit') {
    text += ` loaded. The row limit of ${numberFormat.format(MAX_LOADED_ROWS)} stopped the fetch.`
  } else if (!outcome.is_complete && stopReason === 'export') {
    text += ' loaded. The export closed this result.'
  } else if (!outcome.is_complete && stopReason === 'assistant') {
    text += ' loaded. The assistant used the session and closed this result.'
  } else if (!outcome.is_complete && stopReason === 'plan') {
    text += ' loaded. The plan read used the session and closed this result.'
  } else if (!outcome.is_complete) {
    text += ' loaded. The fetch stopped before the end.'
  } else if (total !== null && total > loaded) {
    text = `The first ${numberFormat.format(loaded)} of ${count(total, 'row')}. To see all rows, run a statement that only reads data as the last statement.`
  }
  return (
    <span className="results__status" role="status">
      {text} ({elapsed(statement.elapsed_ms)})
    </span>
  )
}

function StatementView(props: { statement: StatementReport; index: number }) {
  const { statement, index } = props
  const open = useQuery((state) => state.open)
  const fetchError = useQuery((state) => state.fetchError)
  const isExporting = useQuery((state) => state.isExporting)
  const fetchMore = useQuery((state) => state.fetchMore)
  const stopFetch = useQuery((state) => state.stopFetch)
  const exportCsv = useQuery((state) => state.exportCsv)
  const { outcome } = statement

  if (outcome.type === 'failed') {
    return (
      <ErrorMessage
        error={outcome.error}
        location={outcome.location}
        range={statement.range}
      />
    )
  }
  if (outcome.type === 'command') {
    return (
      <p className="results__status" role="status">
        The statement is complete. {count(outcome.affected_rows, 'row')}{' '}
        affected ({elapsed(statement.elapsed_ms)}).
      </p>
    )
  }
  const isOpen = open?.index === index
  return (
    <>
      {fetchError && isLast(index) && (
        <ErrorMessage error={fetchError} location={null} />
      )}
      <ResultGrid
        key={`${index}-${statement.range.from}`}
        columns={outcome.columns}
        rows={outcome.rows}
        hasMore={isOpen}
        onNeedMore={() => void fetchMore()}
      />
      <div className="results__bar results__bar--footer">
        <RowsStatus statement={statement} index={index} />
        <span className="title-bar__spacer" />
        {isOpen && (
          <button
            type="button"
            className="button button--small"
            onClick={() => void stopFetch()}
          >
            Stop fetch
          </button>
        )}
        <AskAboutRows
          columns={outcome.columns}
          rows={outcome.rows}
          totalRows={outcome.total_rows}
        />
        <button
          type="button"
          className="button button--small"
          disabled={isExporting}
          title="The export runs the statement again and writes all rows to a file."
          onClick={() => void exportCsv(index)}
        >
          {isExporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>
    </>
  )
}

/** Only the last statement of a run can have an open result and thus a fetch error. */
function isLast(index: number): boolean {
  return index === activeQueryStore().getState().statements.length - 1
}

function Results() {
  const hasConnection = useQuery((state) => state.session !== null)
  const runState = useQuery((state) => state.runState)
  const statements = useQuery((state) => state.statements)
  const selected = useQuery((state) => state.selected)
  const ranSql = useQuery((state) => state.ranSql)
  const notice = useQuery((state) => state.notice)
  const select = useQuery((state) => state.select)
  const setNotice = useQuery((state) => state.setNotice)
  const statement = statements[selected]

  return (
    <>
      {notice && (
        <div className="banner" role="status">
          <span>{notice}</span>
          <button
            type="button"
            className="link-button"
            onClick={() => setNotice(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      {runState !== 'idle' && (
        <p className="results__status" role="status">
          {runState === 'running' ? 'Running…' : 'Cancelling…'}
        </p>
      )}
      {runState === 'idle' && !statement && (
        <p className="pane__hint">
          {hasConnection
            ? 'Run a statement to see its result here.'
            : 'Select a connection, then run a statement.'}
        </p>
      )}
      {statements.length > 1 && (
        <ol className="results__statements" aria-label="Statements of the run">
          {statements.map((item, index) => (
            <li key={index}>
              <button
                type="button"
                className="results__statement"
                aria-current={index === selected}
                onClick={() => select(index)}
              >
                <span className="results__sql">{preview(ranSql, item)}</span>
                <span>{summary(item)}</span>
                <span>{elapsed(item.elapsed_ms)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {statement && <StatementView statement={statement} index={selected} />}
    </>
  )
}

export function ResultsPane() {
  const view = useResultsViewStore((state) => state.view)
  const setView = useResultsViewStore((state) => state.setView)
  const views: { id: ResultsView; label: string }[] = [
    { id: 'results', label: 'Results' },
    { id: 'history', label: 'History' },
    { id: 'table', label: 'Table' },
    { id: 'plan', label: 'Plan' },
    { id: 'diff', label: 'Diff' },
  ]

  return (
    <section className="pane results" aria-label="Results">
      <div className="results__views" role="tablist" aria-label="Results views">
        {views.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className="results__view"
            aria-selected={view === item.id}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="results__content">
        {view === 'results' && <Results />}
        {view === 'history' && (
          <HistoryPanel onRun={() => setView('results')} />
        )}
        {view === 'table' && <TableDetail />}
        {view === 'plan' && <PlanView />}
        {view === 'diff' && <DiffView />}
      </div>
    </section>
  )
}

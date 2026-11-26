import { useState, type FormEvent } from 'react'
import { runAiAction } from '../assistant/assistantStore'
import type { Column_Serialize as Column } from '../bindings'
import { Modal } from '../connections/Modal'
import { usePreferencesStore } from '../preferences/preferencesStore'
import { Icon } from '../shell/icons'
import { sqlTabOf, useTabsStore } from '../tabs/tabsStore'
import { useWorkspaceStore } from '../workspace/workspaceStore'

type Props = {
  columns: Column[]
  /** The rows that the grid has loaded. */
  rows: (string | null)[][]
  /** The number of rows of the result, or `null` while the result is open. */
  totalRows: number | null
}

const numberFormat = new Intl.NumberFormat('en-US')

const PRODUCTION =
  'A production connection never sends rows to the AI. No setting changes this.'

/** The connection of the SQL tab, or `undefined`. */
function useConnection() {
  const connectionId = useTabsStore((state) => sqlTabOf(state)?.connectionId)
  return useWorkspaceStore((state) =>
    state.workspace?.connections.find(
      (connection) => connection.id === connectionId,
    ),
  )
}

/**
 * "Ask about these rows": the only AI action that sends rows. A confirmation tells
 * the number of rows, the columns, and the connection before the rows go. For a
 * production connection, the action is not available.
 */
export function AskAboutRows({ columns, rows, totalRows }: Props) {
  const connection = useConnection()
  const limit = usePreferencesStore(
    (state) => state.preferences.assistant.rows_for_ai,
  )
  const [isOpen, setIsOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const count = Math.min(limit, rows.length)
  const isProduction = connection?.environment === 'production'

  const send = (event: FormEvent) => {
    event.preventDefault()
    const text = question.trim()
    if (!text) return
    setIsOpen(false)
    setQuestion('')
    void runAiAction({
      task: 'rows',
      text,
      context: {
        type: 'rows',
        columns: columns.map(({ name, type_name }) => ({ name, type_name })),
        rows: rows.slice(0, count),
        total_rows: totalRows,
      },
    })
  }

  const total =
    totalRows === null
      ? `${numberFormat.format(rows.length)} loaded`
      : numberFormat.format(totalRows)

  return (
    <>
      <button
        type="button"
        className="button button--small ai-action"
        disabled={isProduction || !connection || count === 0}
        title={
          isProduction
            ? PRODUCTION
            : 'Ask the AI a question about the rows of this result. A confirmation comes first.'
        }
        onClick={() => setIsOpen(true)}
      >
        <Icon name="sparkle" size={14} />
        Ask about these rows
      </button>
      {isOpen && connection && (
        <Modal title="Send rows to Anthropic?" onClose={() => setIsOpen(false)}>
          <form className="rows-confirm" onSubmit={send}>
            <p>
              Ask about these rows sends data from the result. The other AI
              actions send no rows.
            </p>
            <dl className="rows-confirm__facts">
              <dt>Rows</dt>
              <dd>
                The first {numberFormat.format(count)} of {total} rows.
                Preferences › AI assistant sets the number.
              </dd>
              <dt>Columns</dt>
              <dd>{columns.map((column) => column.name).join(', ')}</dd>
              <dt>Connection</dt>
              <dd>
                {connection.name}{' '}
                <span className={`badge badge--${connection.environment}`}>
                  {connection.environment}
                </span>
              </dd>
            </dl>
            <label className="field">
              <span className="field__label">Your question</span>
              <textarea
                rows={3}
                value={question}
                placeholder="For example: which customers have the highest revenue?"
                onChange={(event) => setQuestion(event.target.value)}
              />
            </label>
            <p className="field__hint">
              A production connection never sends rows. For a production
              connection, this action is not available.
            </p>
            <div className="modal__actions">
              <button
                type="button"
                className="button"
                onClick={() => setIsOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button button--primary"
                disabled={!question.trim()}
              >
                Send {numberFormat.format(count)} {count === 1 ? 'row' : 'rows'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}

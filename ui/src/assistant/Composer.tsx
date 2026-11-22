import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Modal } from '../connections/Modal'
import { useAssistantStore } from './assistantStore'
import { useSession, useSessionStore } from './sessionContext'

/** The request field, the plan analysis, and the Send and Stop buttons. */
export function Composer(props: {
  hasStop?: boolean
  /** `false` if a different view of the same session shows the confirmation. */
  hasConfirm?: boolean
}) {
  const { hasStop = true, hasConfirm = true } = props
  const store = useSessionStore()
  const hasKey = useAssistantStore((state) => state.hasKey)
  const draft = useSession((state) => state.draft)
  const status = useSession((state) => state.status)
  const pendingAnalyze = useSession((state) => state.pendingAnalyze)
  const [measures, setMeasures] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const requestId = useId()
  const isBusy = status !== 'idle'
  const canType = hasKey !== false
  const session = () => store.getState()

  // The Stop button and the key input go away when their work is done. If one of
  // them had the focus, the focus moves to the request field, not to the page.
  useEffect(() => {
    if (!isBusy && canType && document.activeElement === document.body) {
      inputRef.current?.focus({ preventScroll: true })
    }
  }, [isBusy, canType])

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    if (event.nativeEvent.isComposing) return
    event.preventDefault()
    void session().send()
  }

  return (
    <>
      <div className="assistant__form">
        <label className="assistant__label" htmlFor={requestId}>
          Request
        </label>
        <textarea
          id={requestId}
          ref={inputRef}
          rows={3}
          value={draft}
          placeholder="Describe the SQL that you need"
          onChange={(event) => session().setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="assistant__plan">
          <button
            type="button"
            className="button button--small"
            disabled={isBusy}
            title="Read the plan of the statement at the cursor, and ask for its analysis"
            onClick={() => void session().analyzePlan(measures)}
          >
            Analyze plan
          </button>
          <label className="field--check">
            <input
              type="checkbox"
              checked={measures}
              onChange={(event) => setMeasures(event.target.checked)}
            />
            <span>Measure the times (runs the statement)</span>
          </label>
        </div>
        <div className="assistant__form-actions">
          <button
            type="button"
            className="button button--small button--primary"
            disabled={isBusy || !draft.trim()}
            onClick={() => void session().send()}
          >
            Send
          </button>
          {hasStop && isBusy && (
            <button
              type="button"
              className="button button--small button--danger"
              onClick={() => void session().stop()}
            >
              Stop
            </button>
          )}
        </div>
      </div>
      <p className="pane__hint assistant__keys">
        Enter sends. Shift+Enter adds a line.
      </p>

      {hasConfirm && pendingAnalyze && (
        <Modal
          title="Run the statement?"
          onClose={() => session().cancelAnalyze()}
        >
          <p>
            EXPLAIN ANALYZE runs the statement on the connection{' '}
            <strong>{pendingAnalyze.connectionName}</strong> (
            {pendingAnalyze.environment}). The rule of this environment asks
            before each run.
          </p>
          <div className="modal__actions">
            <button
              type="button"
              className="button"
              onClick={() => session().cancelAnalyze()}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void session().confirmAnalyze()}
            >
              Run and analyze
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}

import { Modal } from '../connections/Modal'
import { useRunConfirmStore } from './runConfirm'

/** Asks the user before a destructive statement or a run on a production connection. */
export function RunConfirmDialog() {
  const pending = useRunConfirmStore((state) => state.pending)
  const confirm = useRunConfirmStore((state) => state.confirm)
  const cancel = useRunConfirmStore((state) => state.cancel)
  if (!pending) return null

  return (
    <Modal title="Run the statements?" onClose={cancel}>
      {pending.isProduction && (
        <p className="message message--error">
          <strong>{pending.connectionName}</strong> is a production connection.
        </p>
      )}
      {pending.risky.length > 0 && (
        <>
          <p>These statements are destructive. You cannot undo them.</p>
          <ul className="confirm__list">
            {pending.risky.map((statement, index) => (
              <li key={index}>
                <code>{statement.text}</code>
                <span className="field__hint">{statement.reason}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="modal__actions">
        <button type="button" className="button" onClick={cancel}>
          Cancel
        </button>
        <button
          type="button"
          className="button button--danger"
          onClick={confirm}
        >
          Run
        </button>
      </div>
    </Modal>
  )
}

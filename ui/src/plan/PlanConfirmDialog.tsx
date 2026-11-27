import { useState } from 'react'
import { Modal } from '../connections/Modal'
import { usePlanStore } from './planStore'

/**
 * Asks the user before Explain and measure, because the database runs the
 * statement. A production connection always asks.
 */
export function PlanConfirmDialog() {
  const pending = usePlanStore((state) => state.pending)
  const confirm = usePlanStore((state) => state.confirm)
  const cancel = usePlanStore((state) => state.cancel)
  const [skipsNextTime, setSkipsNextTime] = useState(false)
  if (!pending) return null
  const isProduction = pending.environment === 'production'

  return (
    <Modal title="Explain and measure?" onClose={cancel}>
      <p className={isProduction ? 'message message--error' : undefined}>
        The database runs the statement on{' '}
        <strong>{pending.connectionName}</strong> ({pending.environment}) and
        measures each step. The run can take as long as a normal run.
        {isProduction && ' A production connection always asks.'}
      </p>
      <pre className="plan__statement">{pending.statement.trim()}</pre>
      {!isProduction && (
        <label className="field--check">
          <input
            type="checkbox"
            checked={skipsNextTime}
            onChange={(event) => setSkipsNextTime(event.target.checked)}
          />
          <span>Do not ask again for this connection</span>
        </label>
      )}
      <div className="modal__actions">
        <button type="button" className="button" onClick={cancel}>
          Cancel
        </button>
        <button
          type="button"
          className={`button ${isProduction ? 'button--danger' : 'button--primary'}`}
          onClick={() => {
            confirm(skipsNextTime)
            setSkipsNextTime(false)
          }}
        >
          Explain and measure
        </button>
      </div>
    </Modal>
  )
}

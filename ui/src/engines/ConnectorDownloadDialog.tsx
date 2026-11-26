import { useState } from 'react'
import type { DownloadEvent, Engine } from '../bindings'
import { Modal } from '../connections/Modal'
import { downloadConnector, formatBytes } from './connectorActions'
import { engineLabel } from './engineStore'

type Props = {
  engine: Engine
  /** Called after the install. The engine can then be used. */
  onInstalled: () => void
  onClose: () => void
}

type Step =
  | { type: 'confirm' }
  | { type: 'index' }
  | { type: 'download'; version: string; size: number; received: number }
  | { type: 'checking'; version: string }
  | { type: 'installed'; version: string }
  | { type: 'failed'; message: string }

function nextStep(step: Step, event: DownloadEvent): Step {
  switch (event.type) {
    case 'loading-index':
      return { type: 'index' }
    case 'downloading':
      return {
        type: 'download',
        version: event.version,
        size: event.size,
        received: 0,
      }
    case 'progress':
      return step.type === 'download'
        ? { ...step, received: event.received }
        : step
    case 'checking':
      return step.type === 'download'
        ? { type: 'checking', version: step.version }
        : step
  }
}

/**
 * Asks before the download of an official connector, then shows the progress.
 * Tabloxide makes no network request for connectors before the user selects Download.
 */
export function ConnectorDownloadDialog({
  engine,
  onInstalled,
  onClose,
}: Props) {
  const [step, setStep] = useState<Step>({ type: 'confirm' })
  const name = engineLabel(engine)
  const isBusy =
    step.type === 'index' ||
    step.type === 'download' ||
    step.type === 'checking'

  const start = async () => {
    setStep({ type: 'index' })
    const result = await downloadConnector(engine, (event) =>
      setStep((current) => nextStep(current, event)),
    )
    if (result.status === 'installed') {
      setStep({ type: 'installed', version: result.package.version })
    } else if (result.status === 'failed') {
      setStep({ type: 'failed', message: result.message })
    }
  }

  return (
    <Modal
      title={`Download the ${name} connector`}
      onClose={isBusy ? () => undefined : onClose}
    >
      {step.type === 'confirm' && (
        <>
          <p>
            Tabloxide connects to {name} with a connector. A connector is a
            separate program. Tabloxide does not have it yet.
          </p>
          <dl className="connector__facts">
            <dt>Source</dt>
            <dd>
              The list of connectors at tabloxide.org. The file comes from the
              GitHub releases of the project.
            </dd>
            <dt>Check</dt>
            <dd>
              Tabloxide checks the signature of the list and the checksum of the
              file before it keeps the file.
            </dd>
          </dl>
          <p className="message message--warning">
            The connector runs as a program with your permissions. It gets the
            password of each {name} connection.
          </p>
          <p className="form__hint">
            Tabloxide sends no request before you select Download.
          </p>
        </>
      )}
      {step.type === 'index' && (
        <p role="status">Loading the list of connectors…</p>
      )}
      {step.type === 'download' && (
        <div role="status">
          <p>
            Downloading {name} connector {step.version}:{' '}
            {formatBytes(step.received)} of {formatBytes(step.size)}
          </p>
          <progress
            className="connector__progress"
            max={step.size}
            value={step.received}
            aria-label="Download progress"
          />
        </div>
      )}
      {step.type === 'checking' && (
        <p role="status">Checking the checksum and unpacking the connector…</p>
      )}
      {step.type === 'installed' && (
        <p role="status" className="message message--ok">
          The {name} connector {step.version} is installed. It starts with the
          first connection and stops when Tabloxide closes.
        </p>
      )}
      {step.type === 'failed' && (
        <p role="alert" className="message message--error">
          {step.message}
        </p>
      )}

      <div className="modal__actions">
        {step.type === 'confirm' && (
          <>
            <button type="button" className="button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void start()}
            >
              Download
            </button>
          </>
        )}
        {step.type === 'failed' && (
          <>
            <button type="button" className="button" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void start()}
            >
              Retry
            </button>
          </>
        )}
        {step.type === 'installed' && (
          <button
            type="button"
            className="button button--primary"
            onClick={onInstalled}
          >
            Continue
          </button>
        )}
      </div>
    </Modal>
  )
}

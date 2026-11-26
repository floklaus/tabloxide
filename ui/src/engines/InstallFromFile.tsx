import { useEffect, useRef, useState } from 'react'
import type { PackageInfo } from '../bindings'
import { Modal } from '../connections/Modal'
import {
  choosePackage,
  inspectPackage,
  installPackage,
} from './connectorActions'

type Props = {
  /** Called with the engine after the install. */
  onInstalled: (engine: string) => void
  onClose: () => void
}

type Step =
  | { type: 'reading' }
  | { type: 'confirm'; path: string; package: PackageInfo }
  | { type: 'installing' }
  | { type: 'installed'; package: PackageInfo }
  | { type: 'failed'; message: string }

/**
 * Installs a connector from a package file. A package without the signature of the
 * Tabloxide project needs a confirmation that names the risk. The confirmation is
 * for this one file.
 */
export function InstallFromFile({ onInstalled, onClose }: Props) {
  const [step, setStep] = useState<Step>({ type: 'reading' })
  const hasStarted = useRef(false)

  const install = async (path: string, sha256: string, confirmed: boolean) => {
    setStep({ type: 'installing' })
    const result = await installPackage(path, sha256, confirmed)
    if (result.status === 'installed') {
      setStep({ type: 'installed', package: result.package })
    } else if (result.status === 'failed') {
      setStep({ type: 'failed', message: result.message })
    } else {
      setStep({ type: 'confirm', path, package: result.package })
    }
  }

  const start = async () => {
    const path = await choosePackage()
    if (path === null) {
      onClose()
      return
    }
    setStep({ type: 'reading' })
    const result = await inspectPackage(path)
    if (result.status === 'failed') {
      setStep({ type: 'failed', message: result.message })
    } else if (result.status === 'needs-confirmation') {
      setStep({ type: 'confirm', path, package: result.package })
    } else {
      await install(path, result.package.sha256, false)
    }
  }

  useEffect(() => {
    // Strict mode runs an effect two times. The file dialog must open once.
    if (hasStarted.current) return
    hasStarted.current = true
    void start()
    // `start` reads only stable values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (step.type === 'confirm') {
    const { package: info, path } = step
    return (
      <Modal
        title="Install a connector from a different source?"
        onClose={onClose}
      >
        <p>
          The file {info.displayName} connector {info.version} does not have the
          signature of the Tabloxide project.
        </p>
        <dl className="connector__facts">
          <dt>Publisher</dt>
          <dd>{info.publisher ?? 'Unknown'}</dd>
          <dt>Checksum</dt>
          <dd className="connector__checksum">{info.sha256}</dd>
        </dl>
        <p className="message message--error">
          A connector is a program with your permissions. This connector can
          read the passwords and the data of its connections. Install it only if
          you trust its publisher.
        </p>
        <p className="form__hint">
          The confirmation is for this version only. A new version asks again.
        </p>
        <div className="modal__actions">
          <button type="button" className="button" onClick={onClose} autoFocus>
            Cancel
          </button>
          <button
            type="button"
            className="button button--danger"
            onClick={() => void install(path, info.sha256, true)}
          >
            Install
          </button>
        </div>
      </Modal>
    )
  }

  const isBusy = step.type === 'reading' || step.type === 'installing'
  return (
    <Modal
      title="Install a connector"
      onClose={isBusy ? () => undefined : onClose}
    >
      {step.type === 'reading' && <p role="status">Reading the package…</p>}
      {step.type === 'installing' && <p role="status">Installing…</p>}
      {step.type === 'installed' && (
        <p role="status" className="message message--ok">
          The {step.package.displayName} connector {step.package.version} is
          installed.
        </p>
      )}
      {step.type === 'failed' && (
        <p role="alert" className="message message--error">
          {step.message}
        </p>
      )}
      <div className="modal__actions">
        {step.type === 'failed' && (
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        )}
        {step.type === 'installed' && (
          <button
            type="button"
            className="button button--primary"
            onClick={() => onInstalled(step.package.engine)}
          >
            Continue
          </button>
        )}
      </div>
    </Modal>
  )
}

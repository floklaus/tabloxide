import { useEffect } from 'react'
import { usePreferencesStore } from '../preferences/preferencesStore'
import { useUpdateStore } from './updateStore'

/**
 * Checks for a newer version at the start if the preferences permit it, and shows a
 * notice when a newer version is available. The user can install it or defer it.
 */
export function UpdateNotice() {
  const check = useUpdateStore((state) => state.check)
  const isDeferred = useUpdateStore((state) => state.isDeferred)
  const isInstalling = useUpdateStore((state) => state.isInstalling)
  const error = useUpdateStore((state) => state.error)
  const install = useUpdateStore((state) => state.install)
  const defer = useUpdateStore((state) => state.defer)
  const dismissError = useUpdateStore((state) => state.dismissError)

  useEffect(() => {
    let isActive = true
    void (async () => {
      await usePreferencesStore.getState().load()
      const { preferences, error: loadError } = usePreferencesStore.getState()
      // Without the preferences, the application does not know the choice of the
      // user. Then it does not send a request.
      if (isActive && !loadError && preferences.check_for_updates) {
        await useUpdateStore.getState().checkNow()
      }
    })()
    return () => {
      isActive = false
    }
  }, [])

  if (check?.status !== 'available' || isDeferred) return null

  return (
    <section className="update-notice" aria-label="Update">
      <p className="update-notice__title">
        Tabloxide {check.version} is available.
      </p>
      <p className="field__hint">
        You use version {check.current_version}. The install closes the
        application and starts it again. Save your files first.
      </p>
      {check.notes && (
        <details>
          <summary>Release notes</summary>
          <p className="update-notice__notes">{check.notes}</p>
        </details>
      )}
      {error && (
        <p className="message message--error" role="alert">
          {error}{' '}
          <button type="button" className="link-button" onClick={dismissError}>
            Dismiss
          </button>
        </p>
      )}
      {isInstalling && <p role="status">Downloading and installing…</p>}
      <div className="modal__actions">
        <button
          type="button"
          className="button"
          disabled={isInstalling}
          onClick={defer}
        >
          Later
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={isInstalling}
          onClick={() => void install()}
        >
          Install and restart
        </button>
      </div>
    </section>
  )
}

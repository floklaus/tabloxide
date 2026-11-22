import type { UpdateCheck } from '../bindings'
import { useUpdateStore } from './updateStore'

function resultText(check: UpdateCheck | null): string | null {
  switch (check?.status) {
    case undefined:
      return null
    case 'not-configured':
      return 'This build of the application cannot update itself. Install a release build to get updates.'
    case 'up-to-date':
      return 'You use the newest version.'
    case 'available':
      return `Version ${check.version} is available.`
  }
}

type Props = {
  isEnabled: boolean
  onChange: (isEnabled: boolean) => void
}

/** The update setting of the preferences, and a button for a check now. */
export function UpdateSettings({ isEnabled, onChange }: Props) {
  const check = useUpdateStore((state) => state.check)
  const isChecking = useUpdateStore((state) => state.isChecking)
  const error = useUpdateStore((state) => state.error)
  const checkNow = useUpdateStore((state) => state.checkNow)
  const text = resultText(check)

  return (
    <fieldset className="form__group">
      <legend>Updates</legend>
      <label className="field field--check">
        <input
          type="checkbox"
          checked={isEnabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>Check for a newer version when the application starts</span>
      </label>
      <p className="field__hint">
        The check sends a request to the release page of the project. The
        request contains no data of your workspace.
      </p>
      <div className="git__row">
        <button
          type="button"
          className="button button--small"
          disabled={isChecking}
          onClick={() => void checkNow()}
        >
          Check now
        </button>
        {isChecking && <span role="status">Checking…</span>}
        {!isChecking && text && <span role="status">{text}</span>}
      </div>
      {error && (
        <p className="message message--error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  )
}

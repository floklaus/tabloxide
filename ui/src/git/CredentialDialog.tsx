import { useState, type FormEvent } from 'react'
import { Modal } from '../connections/Modal'
import { useRemoteStore, type CredentialRequest } from './remoteStore'

function Question({ request }: { request: CredentialRequest }) {
  const answer = useRemoteStore((state) => state.answer)
  // The answer stays in this component. It goes to Git and to no other place.
  const [value, setValue] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void answer(value)
  }

  return (
    <Modal title="Git needs your answer" onClose={() => void answer(null)}>
      <form onSubmit={submit}>
        <label className="field">
          <span className="field__label">{request.prompt}</span>
          <input
            type={request.isSecret ? 'password' : 'text'}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <p className="pane__hint">
          The application sends your answer to Git and does not store it. To
          store it, configure a credential helper or an SSH agent for Git.
        </p>
        <div className="modal__actions">
          <button
            type="button"
            className="button"
            onClick={() => void answer(null)}
          >
            Cancel
          </button>
          <button type="submit" className="button button--primary">
            Continue
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** Asks the user for a credential when Git or SSH needs one during a remote operation. */
export function CredentialDialog() {
  const request = useRemoteStore((state) => state.requests[0])
  // The key gives each question a new, empty field.
  return request ? <Question key={request.id} request={request} /> : null
}

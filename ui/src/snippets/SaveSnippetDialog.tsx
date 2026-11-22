import { useId, useState, type FormEvent } from 'react'
import { Modal } from '../connections/Modal'
import { isValidSnippetName, saveSnippet, SNIPPET_FOLDER } from './snippets'

type Props = {
  /** The text of the new snippet. */
  template: string
  onClose: () => void
}

/** Saves SQL text as a snippet of the workspace. */
export function SaveSnippetDialog({ template, onClose }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const trimmed = name.trim()
  const hintId = useId()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setIsSaving(true)
    const message = await saveSnippet(trimmed, description, template)
    setIsSaving(false)
    if (message) setError(message)
    else onClose()
  }

  return (
    <Modal title="Save as snippet" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span className="field__label">Name</span>
          <input
            value={name}
            maxLength={64}
            aria-describedby={hintId}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <p id={hintId} className="field__hint">
          Type the name in the editor to insert the snippet. The file is{' '}
          {SNIPPET_FOLDER}/{trimmed || 'name'}.sql in the workspace. A file with
          the same name is replaced.
        </p>
        <label className="field">
          <span className="field__label">Description</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <p className="field__hint">
          Write {'${name}'} in a snippet file for a field that you fill in. The
          Tab key moves to the next field.
        </p>
        <pre className="snippet__preview">{template}</pre>
        {error && (
          <p className="message message--error" role="alert">
            {error}
          </p>
        )}
        <div className="modal__actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="button button--primary"
            disabled={isSaving || !isValidSnippetName(trimmed)}
          >
            Save
          </button>
        </div>
      </form>
    </Modal>
  )
}

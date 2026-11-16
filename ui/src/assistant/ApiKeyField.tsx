import { useId, useRef, useState } from 'react'
import { useAssistantStore } from './assistantStore'

/**
 * The input for the API key of the AI service. The key goes to the credential store
 * of the operating system immediately. It is not a part of a form.
 */
export function ApiKeyField() {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const hasKey = useAssistantStore((state) => state.hasKey)
  const saveKey = useAssistantStore((state) => state.saveKey)
  const deleteKey = useAssistantStore((state) => state.deleteKey)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (!value.trim()) return
    const message = await saveKey(value)
    setError(message)
    if (message === null) setValue('')
  }
  const remove = async () => {
    setError(await deleteKey())
    // The button is gone after the removal. The focus must not go to the page.
    inputRef.current?.focus()
  }

  return (
    <div className="field">
      <label className="field__label" htmlFor={inputId}>
        API key of Anthropic
      </label>
      <input
        id={inputId}
        ref={inputRef}
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          // The field can be in a form. The Enter key must not submit that form.
          event.preventDefault()
          void save()
        }}
      />
      <p className="field__hint" role="status">
        {hasKey
          ? 'A key is stored. Enter a new key to replace it.'
          : 'No key is stored.'}{' '}
        The application keeps the key in the credential store of the operating
        system.
      </p>
      <div className="assistant__key-actions">
        <button
          type="button"
          className="button button--small"
          disabled={!value.trim()}
          onClick={() => void save()}
        >
          Save the key
        </button>
        {hasKey && (
          <button
            type="button"
            className="link-button link-button--danger"
            onClick={() => void remove()}
          >
            Remove the key
          </button>
        )}
      </div>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

import { useEffect, useRef, type KeyboardEvent } from 'react'
import { Icon } from '../shell/icons'
import { sqlTabIdOf, useTabsStore } from '../tabs/tabsStore'
import { useInlineChange } from './inlineChange'

const NOTE =
  'A request sends the selection, the instruction, and the structure of the database. It sends no rows.'

/**
 * The box of an AI change of the selection (Ctrl+I). It asks for the instruction,
 * shows the progress, and gives the buttons for the proposal in the editor.
 */
export function InlineChange() {
  const state = useInlineChange()
  const sqlTabId = useTabsStore(sqlTabIdOf)
  const inputRef = useRef<HTMLInputElement>(null)
  const acceptRef = useRef<HTMLButtonElement>(null)
  const { phase, tabId, close } = state

  // The change belongs to its tab. A different tab closes it.
  useEffect(() => {
    if (phase !== 'closed' && tabId !== sqlTabId) close()
  }, [phase, tabId, sqlTabId, close])

  // The focus stays in the box, so that Enter, Ctrl+Enter, and Esc operate.
  useEffect(() => {
    if (phase === 'instruction') inputRef.current?.focus()
    if (phase === 'preview') acceptRef.current?.focus()
  }, [phase])

  if (phase === 'closed' || tabId !== sqlTabId) return null

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (phase === 'preview') state.reject()
      else close()
    } else if (
      event.key === 'Enter' &&
      (event.ctrlKey || event.metaKey) &&
      phase === 'preview'
    ) {
      event.preventDefault()
      state.accept()
    }
  }

  return (
    <section
      className="inline-change"
      aria-label="Change the selection with AI"
      onKeyDown={onKeyDown}
    >
      {phase === 'instruction' && (
        <form
          className="inline-change__row"
          onSubmit={(event) => {
            event.preventDefault()
            void state.submit()
          }}
        >
          <Icon name="sparkle" size={16} />
          <label className="visually-hidden" htmlFor="inline-change-input">
            Instruction for the change
          </label>
          <input
            ref={inputRef}
            id="inline-change-input"
            type="text"
            value={state.instruction}
            placeholder="Tell the AI how to change the text"
            disabled={!state.original}
            onChange={(event) => state.setInstruction(event.target.value)}
          />
          <button
            type="submit"
            className="button button--small button--primary"
            disabled={!state.original || !state.instruction.trim()}
          >
            Send
          </button>
          <button
            type="button"
            className="button button--small"
            onClick={close}
          >
            Cancel
          </button>
        </form>
      )}
      {phase === 'waiting' && (
        <div className="inline-change__row">
          <Icon name="sparkle" size={16} />
          <span role="status" className="inline-change__status">
            The AI changes the text…
          </span>
          <button
            type="button"
            className="button button--small"
            onClick={close}
          >
            Stop
          </button>
        </div>
      )}
      {phase === 'preview' && (
        <div className="inline-change__row">
          <Icon name="sparkle" size={16} />
          <span className="inline-change__status">
            The editor shows the proposed text below the removed text.
          </span>
          <button
            ref={acceptRef}
            type="button"
            className="button button--small button--primary"
            aria-keyshortcuts="Control+Enter"
            onClick={state.accept}
          >
            Accept
          </button>
          <button
            type="button"
            className="button button--small"
            onClick={state.reject}
          >
            Reject
          </button>
          <button
            type="button"
            className="button button--small"
            onClick={state.changeAgain}
          >
            Change again
          </button>
        </div>
      )}
      {phase === 'preview' && state.risk && (
        <p className="inline-change__risk" role="note">
          {state.risk}
        </p>
      )}
      {state.error && (
        <p className="message message--error inline-change__error" role="alert">
          {state.error}
        </p>
      )}
      <p className="inline-change__hint">
        {phase === 'preview'
          ? `Ctrl+Enter accepts. Esc rejects. ${state.sent ?? ''}`.trim()
          : `Enter sends. Esc closes. ${NOTE}`}
      </p>
    </section>
  )
}

import { useState } from 'react'
import { onlyCodeBlock } from '../assistant/answerSegments'
import { runHiddenAction } from '../assistant/assistantStore'
import { Icon } from '../shell/icons'

type Props = {
  message: string
  onMessage: (message: string) => void
  /** `true` if there are no staged changes. */
  disabled: boolean
}

/** The text of the answer as a commit message. A code block gives its content. */
function messageOf(answer: string): string {
  return (onlyCodeBlock(answer) ?? answer).trim()
}

/**
 * The AI action of the commit message field. The AI writes the message from the
 * staged diff. The message goes into the field, not into the assistant panel.
 */
export function CommitMessageAi({ message, onMessage, disabled }: Props) {
  const [isWriting, setIsWriting] = useState(false)
  const [written, setWritten] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isConfirming, setIsConfirming] = useState(false)

  const write = async () => {
    setIsConfirming(false)
    setIsWriting(true)
    setError(null)
    try {
      const session = await runHiddenAction({
        task: 'commit-message',
        text: 'Write a commit message for the staged changes.',
        context: { type: 'staged-changes' },
      })
      if (!session) return
      const state = session.getState()
      const answer = state.messages[state.messages.length - 1]
      if (state.error || answer?.role !== 'assistant') {
        setError(state.error ?? 'The AI wrote no message.')
        return
      }
      const text = messageOf(answer.text)
      onMessage(text)
      setWritten(text)
      setSent(state.messages[state.messages.length - 2]?.sent ?? null)
    } finally {
      setIsWriting(false)
    }
  }

  // The text of the user is not lost without a question.
  const start = () => {
    if (message.trim() && message !== written) setIsConfirming(true)
    else void write()
  }

  const isShown = written !== null && message === written
  return (
    <div className="git__ai">
      {isConfirming ? (
        <div className="git__row" role="group" aria-label="Replace the message">
          <span>Replace your message with a message of the AI?</span>
          <button
            type="button"
            className="button button--small"
            onClick={() => void write()}
          >
            Replace
          </button>
          <button
            type="button"
            className="button button--small"
            onClick={() => setIsConfirming(false)}
          >
            Keep my message
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="button button--small ai-action"
          disabled={disabled || isWriting}
          title="The AI writes the message from the staged diff and the last commit subjects. The request sends no rows."
          onClick={start}
        >
          <Icon name="sparkle" size={14} />
          {isWriting
            ? 'Writing…'
            : written === null
              ? 'Write the message with AI'
              : 'Write again'}
        </button>
      )}
      {isShown && (
        <p className="git__ai-note">
          The AI wrote this message from the staged diff. Read it and change it
          before you commit. {sent ?? ''}
        </p>
      )}
      {error && (
        <p className="message message--error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

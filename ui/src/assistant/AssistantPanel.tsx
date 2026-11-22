import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Modal } from '../connections/Modal'
import { activeEditor } from '../editor/editorBridge'
import { Icon } from '../shell/icons'
import { splitAnswer } from './answerSegments'
import { ApiKeyField } from './ApiKeyField'
import {
  useAssistantStore,
  type AssistantMessage,
  type AssistantStatus,
  type SchemaInfo,
} from './assistantStore'

const STATUS_TEXT: Record<AssistantStatus, string> = {
  idle: '',
  'reading-plan': 'Reading the plan from the database…',
  'reading-schema': 'Reading the schema from the database…',
  waiting: 'Waiting for the answer…',
  answering: 'The answer is in progress…',
}

function CodeBlock(props: {
  code: string
  canInsert: boolean
  isComplete: boolean
}) {
  const { code, canInsert, isComplete } = props
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="assistant__block">
      {/* The block can scroll. The keyboard needs the focus to scroll it. */}
      <pre className="assistant__code" tabIndex={0}>
        <code>{code}</code>
      </pre>
      {canInsert && (
        <div className="assistant__block-actions">
          <button
            type="button"
            className="button button--small"
            disabled={!isComplete}
            title="Insert the SQL at the cursor of the editor. The application does not run it."
            onClick={() => activeEditor()?.insertText(`${code}\n`)}
          >
            Insert
          </button>
          <button
            type="button"
            className="button button--small"
            disabled={!isComplete}
            onClick={() => void copy()}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
    </div>
  )
}

function Message({ message }: { message: AssistantMessage }) {
  const isAssistant = message.role === 'assistant'
  return (
    <div className={`assistant__message assistant__message--${message.role}`}>
      <p className="assistant__who visually-hidden">
        {isAssistant ? 'Assistant' : 'You'}
      </p>
      {splitAnswer(message.text).map((segment, index) =>
        segment.type === 'text' ? (
          <p key={index} className="assistant__text">
            {segment.text}
          </p>
        ) : (
          <CodeBlock
            key={index}
            code={segment.code}
            canInsert={isAssistant}
            isComplete={segment.isComplete}
          />
        ),
      )}
      {message.note && <p className="assistant__note">{message.note}</p>}
    </div>
  )
}

function schemaText(schema: SchemaInfo | null): string {
  if (!schema) return 'The tab has no connection. The request has no schema.'
  const { relations, detailed } = schema
  if (detailed < relations) {
    return `The request has the columns of ${detailed} of ${relations} tables and views. For the others, it has only the name.`
  }
  return `The request has the structure of ${relations} tables and views.`
}

/** The side panel of the AI assistant. */
export function AssistantPanel() {
  const hasKey = useAssistantStore((state) => state.hasKey)
  const messages = useAssistantStore((state) => state.messages)
  const answer = useAssistantStore((state) => state.answer)
  const draft = useAssistantStore((state) => state.draft)
  const status = useAssistantStore((state) => state.status)
  const schema = useAssistantStore((state) => state.schema)
  const refreshesSchema = useAssistantStore((state) => state.refreshesSchema)
  const error = useAssistantStore((state) => state.error)
  const pendingAnalyze = useAssistantStore((state) => state.pendingAnalyze)
  const store = useAssistantStore.getState
  const [measures, setMeasures] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const requestId = useId()
  const isBusy = status !== 'idle'
  const hasConversation = messages.length > 0 || answer !== ''
  // The answer in progress is the last item. It keeps its position when it is
  // complete. Thus React keeps its elements, and the focus stays in it.
  const shown: AssistantMessage[] = answer
    ? [...messages, { role: 'assistant', text: answer }]
    : messages
  const isAnswerComplete =
    !isBusy && messages[messages.length - 1]?.role === 'assistant'
  const canType = hasKey !== false

  useEffect(() => {
    void useAssistantStore.getState().loadStatus()
  }, [])

  // The newest text must be visible while the answer comes.
  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [messages, answer])

  // The Stop button and the key input go away when their work is done. If one of
  // them had the focus, the focus moves to the request field, not to the page.
  useEffect(() => {
    if (!isBusy && canType && document.activeElement === document.body) {
      inputRef.current?.focus({ preventScroll: true })
    }
  }, [isBusy, canType])

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    if (event.nativeEvent.isComposing) return
    event.preventDefault()
    void store().send()
  }

  return (
    <section className="pane assistant" aria-label="Assistant">
      <div className="assistant__bar">
        <h2 className="pane__title">Assistant</h2>
        <span className="title-bar__spacer" />
        <button
          type="button"
          className="icon-link"
          aria-label="New conversation"
          title="New conversation"
          disabled={isBusy || !hasConversation}
          onClick={() => store().clear()}
        >
          <Icon name="plus" size={16} />
        </button>
      </div>

      <p className="pane__hint assistant__privacy">
        Each request sends the conversation and the structure of the connected
        database to Anthropic. It does not send rows, passwords, or connection
        settings. The application does not run the SQL of an answer.
      </p>

      {hasKey === false && (
        <div className="assistant__setup">
          <p>The assistant needs an API key.</p>
          <ApiKeyField />
        </div>
      )}

      {hasKey !== false && (
        <>
          {/*
            The conversation can scroll. The keyboard needs the focus to scroll it.
            It is not a live region: the text comes in many small parts, and a
            screen reader would read each part. The status line tells the progress.
          */}
          <div
            ref={logRef}
            className="assistant__log"
            role="region"
            aria-label="Conversation"
            tabIndex={0}
          >
            {!hasConversation && (
              <p className="pane__hint">
                Describe the SQL that you need, for example a query, an index,
                or a change of a table. Or put the cursor in a statement and
                select Analyze plan.
              </p>
            )}
            {shown.map((message, index) => (
              <Message key={index} message={message} />
            ))}
          </div>

          {hasConversation && (
            <p className="assistant__schema">
              {schemaText(schema)}{' '}
              {schema && (
                <button
                  type="button"
                  className="link-button"
                  aria-disabled={refreshesSchema}
                  onClick={() => store().requestSchemaRefresh()}
                >
                  {refreshesSchema
                    ? 'The next request reads the schema again'
                    : 'Read the schema again'}
                </button>
              )}
            </p>
          )}

          <p
            className={
              isBusy ? 'assistant__status' : 'assistant__status visually-hidden'
            }
            role="status"
          >
            {isBusy
              ? STATUS_TEXT[status]
              : isAnswerComplete
                ? 'The answer is complete.'
                : ''}
          </p>
          {error && (
            <div className="message message--error" role="alert">
              <p className="message__detail">{error}</p>
            </div>
          )}

          <div className="assistant__form">
            <label className="assistant__label" htmlFor={requestId}>
              Request
            </label>
            <textarea
              id={requestId}
              ref={inputRef}
              rows={3}
              value={draft}
              placeholder="Describe the SQL that you need"
              onChange={(event) => store().setDraft(event.target.value)}
              onKeyDown={onKeyDown}
            />
            <div className="assistant__plan">
              <button
                type="button"
                className="button button--small"
                disabled={isBusy}
                title="Read the plan of the statement at the cursor, and ask for its analysis"
                onClick={() => void store().analyzePlan(measures)}
              >
                Analyze plan
              </button>
              <label className="field--check">
                <input
                  type="checkbox"
                  checked={measures}
                  onChange={(event) => setMeasures(event.target.checked)}
                />
                <span>Measure the times (runs the statement)</span>
              </label>
            </div>
            <div className="assistant__form-actions">
              <button
                type="button"
                className="button button--small button--primary"
                disabled={isBusy || !draft.trim()}
                onClick={() => void store().send()}
              >
                Send
              </button>
              {isBusy && (
                <button
                  type="button"
                  className="button button--small button--danger"
                  onClick={() => void store().stop()}
                >
                  Stop
                </button>
              )}
            </div>
          </div>
          <p className="pane__hint assistant__keys">
            Enter sends. Shift+Enter adds a line.
          </p>
        </>
      )}

      {pendingAnalyze && (
        <Modal
          title="Run the statement?"
          onClose={() => store().cancelAnalyze()}
        >
          <p>
            EXPLAIN ANALYZE runs the statement on the connection{' '}
            <strong>{pendingAnalyze.connectionName}</strong> (
            {pendingAnalyze.environment}). The rule of this environment asks
            before each run.
          </p>
          <div className="modal__actions">
            <button
              type="button"
              className="button"
              onClick={() => store().cancelAnalyze()}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void store().confirmAnalyze()}
            >
              Run and analyze
            </button>
          </div>
        </Modal>
      )}
    </section>
  )
}

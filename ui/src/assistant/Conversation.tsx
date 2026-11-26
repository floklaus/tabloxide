import { useEffect, useRef, useState } from 'react'
import { activeEditor } from '../editor/editorBridge'
import { sqlTabIdOf, useTabsStore } from '../tabs/tabsStore'
import { splitAnswer } from './answerSegments'
import type {
  AssistantMessage,
  AssistantStatus,
  ReplaceTarget,
} from './assistantSession'
import { useSession, useSessionStore } from './sessionContext'
import { schemaText } from './sessionText'

const STATUS_TEXT: Record<AssistantStatus, string> = {
  idle: '',
  'reading-plan': 'Reading the plan from the database…',
  'reading-schema': 'Reading the schema from the database…',
  waiting: 'Waiting for the answer…',
  answering: 'The answer is in progress…',
}

/** Copies `text` to the clipboard. Returns `true` if the copy worked. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * Tells why the answer cannot replace the text of `target`, or `null` if it can.
 * The tab must be the SQL tab of the editor, and its text must not have changed.
 */
function useReplaceBlock(target: ReplaceTarget | undefined): string | null {
  return useTabsStore((state) => {
    if (!target) return null
    if (sqlTabIdOf(state) !== target.tabId) {
      return `Open the tab ${target.tabTitle} to replace the statement.`
    }
    const tab = state.tabs.find((item) => item.id === target.tabId)
    if (tab?.content !== target.document) {
      return 'The text in the editor changed after the run. Copy the SQL.'
    }
    return null
  })
}

function CodeBlock(props: {
  code: string
  canInsert: boolean
  isComplete: boolean
  replace?: ReplaceTarget
}) {
  const { code, canInsert, isComplete, replace } = props
  const [copied, setCopied] = useState(false)
  const replaceBlock = useReplaceBlock(replace)
  return (
    <div className="assistant__block">
      {/* The block can scroll. The keyboard needs the focus to scroll it. */}
      <pre className="assistant__code" tabIndex={0}>
        <code>{code}</code>
      </pre>
      {canInsert && (
        <div className="assistant__block-actions">
          {replace && (
            <button
              type="button"
              className="button button--small"
              disabled={!isComplete || replaceBlock !== null}
              title={
                replaceBlock ??
                'Replace the statement in the editor. The application does not run it.'
              }
              onClick={() =>
                activeEditor()?.replaceRange(replace.from, replace.to, code)
              }
            >
              Replace in the editor
            </button>
          )}
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
            onClick={() => void copyText(code).then(setCopied)}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
    </div>
  )
}

function Message({
  message,
  replace,
}: {
  message: AssistantMessage
  /** The text that a code block of the answer can replace. */
  replace?: ReplaceTarget
}) {
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
            replace={isAssistant ? replace : undefined}
          />
        ),
      )}
      {message.note && <p className="assistant__note">{message.note}</p>}
      {message.sent && <p className="assistant__sent">{message.sent}</p>}
    </div>
  )
}

/** The messages of the session, the schema line, the status line, and the error. */
export function Conversation(props: {
  emptyHint: string
  /** The name of the conversation region. Each view needs a unique name. */
  label?: string
}) {
  const { emptyHint, label = 'Conversation' } = props
  const store = useSessionStore()
  const messages = useSession((state) => state.messages)
  const answer = useSession((state) => state.answer)
  const status = useSession((state) => state.status)
  const schema = useSession((state) => state.schema)
  const refreshesSchema = useSession((state) => state.refreshesSchema)
  const error = useSession((state) => state.error)
  const logRef = useRef<HTMLDivElement>(null)
  const isBusy = status !== 'idle'
  const hasConversation = messages.length > 0 || answer !== ''
  // The answer in progress is the last item. It keeps its position when it is
  // complete. Thus React keeps its elements, and the focus stays in it.
  const shown: AssistantMessage[] = answer
    ? [...messages, { role: 'assistant', text: answer }]
    : messages
  const isAnswerComplete =
    !isBusy && messages[messages.length - 1]?.role === 'assistant'

  // The newest text must be visible while the answer comes.
  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [messages, answer])

  return (
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
        aria-label={label}
        tabIndex={0}
      >
        {!hasConversation && <p className="pane__hint">{emptyHint}</p>}
        {shown.map((message, index) => (
          <Message
            key={index}
            message={message}
            // An answer can replace the text of the request before it.
            replace={shown[index - 1]?.replace}
          />
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
              onClick={() => store.getState().requestSchemaRefresh()}
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
    </>
  )
}

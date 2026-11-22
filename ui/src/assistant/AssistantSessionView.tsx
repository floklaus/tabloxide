import { useStore } from 'zustand'
import { Icon } from '../shell/icons'
import { ApiKeyField } from './ApiKeyField'
import { labelOf, sessionStore, useAssistantStore } from './assistantStore'
import { Composer } from './Composer'
import { Conversation } from './Conversation'
import { ProposedChanges } from './ProposedChanges'
import { SessionContext, useSession, useSessionStore } from './sessionContext'
import { DEFAULT_TITLE, LABEL_TEXT } from './sessionLabels'
import { EMPTY_HINT, PRIVACY_TEXT, schemaText } from './sessionText'
import { stepsOf, type StepState } from './sessionSteps'

const STEP_TEXT: Record<StepState, string> = {
  done: 'Done',
  active: 'In progress',
  failed: 'Not complete',
  pending: 'Not started',
}

function Steps() {
  const lastTask = useSession((state) => state.lastTask)
  const phases = useSession((state) => state.phases)
  const status = useSession((state) => state.status)
  const outcome = useSession((state) => state.outcome)
  const steps = stepsOf({ lastTask, phases, status, outcome })
  if (steps.length === 0) return null
  return (
    <ol className="session__steps" aria-label="Steps of the last request">
      {steps.map((step) => (
        <li
          key={step.phase}
          className={`session__step session__step--${step.state}`}
        >
          <span className="session__step-mark" aria-hidden="true" />
          <span>{step.label}</span>
          <span className="visually-hidden">: {STEP_TEXT[step.state]}</span>
        </li>
      ))}
    </ol>
  )
}

function Context() {
  const context = useSession((state) => state.context)
  const schema = useSession((state) => state.schema)
  return (
    <section className="session__context" aria-labelledby="session-context">
      <h3 id="session-context" className="session__heading">
        Context
      </h3>
      {!context && <p className="pane__hint">The session has no request.</p>}
      {context && (
        <ul className="session__facts">
          <li>
            <Icon name="connections" size={16} />
            <span>{context.connectionName ?? 'No connection'}</span>
            {context.environment && (
              <span className={`badge badge--${context.environment}`}>
                {context.environment}
              </span>
            )}
          </li>
          <li>
            <Icon name="files" size={16} />
            <span>{context.tabTitle}</span>
          </li>
          {context.connectionName && schema && (
            <li>
              <Icon name="schema" size={16} />
              <span>{schemaText(schema)}</span>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

function Header() {
  const store = useSessionStore()
  const state = useStore(store)
  const label = labelOf(state)
  const isBusy = state.status !== 'idle'
  return (
    <div className="session__header">
      <h2 className="session__title">{state.title ?? DEFAULT_TITLE}</h2>
      {label !== 'new' && (
        <span className={`session__badge session__badge--${label}`}>
          {LABEL_TEXT[label]}
        </span>
      )}
      <span className="title-bar__spacer" />
      {isBusy && (
        <button
          type="button"
          className="button"
          onClick={() => void store.getState().stop()}
        >
          Stop
        </button>
      )}
    </div>
  )
}

/** An assistant session in an editor tab: the conversation, its steps, and its SQL. */
export function AssistantSessionView({ sessionId }: { sessionId: string }) {
  // The selector makes the view render again when the session list changes.
  useAssistantStore((state) => state.sessions)
  const hasKey = useAssistantStore((state) => state.hasKey)
  const store = sessionStore(sessionId)
  if (!store) {
    return (
      <div className="session session--gone">
        <p className="pane__hint">
          The session is not available. Close the tab.
        </p>
      </div>
    )
  }
  return (
    <SessionContext.Provider value={store}>
      <section className="session" aria-label="Assistant session">
        <div className="session__main">
          <Header />
          <Steps />
          {hasKey === false ? (
            <div className="assistant__setup">
              <p>The assistant needs an API key.</p>
              <ApiKeyField />
            </div>
          ) : (
            <>
              <Conversation
                emptyHint={EMPTY_HINT}
                label="Conversation of the session"
              />
              <div className="session__composer">
                <Composer hasStop={false} />
              </div>
            </>
          )}
        </div>
        <aside className="session__aside" aria-label="Session details">
          <ProposedChanges />
          <Context />
          <p className="pane__hint assistant__privacy">{PRIVACY_TEXT}</p>
        </aside>
      </section>
    </SessionContext.Provider>
  )
}

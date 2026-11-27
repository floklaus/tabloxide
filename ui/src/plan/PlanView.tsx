import { useState } from 'react'
import { activeSession } from '../assistant/assistantStore'
import { useShellStore } from '../shell/shellStore'
import { READING_GUIDE, totalText } from './planGlossary'
import { milliseconds } from './planFormat'
import { costliest, type Plan } from './planModel'
import { PlanStep } from './PlanStep'
import { usePlanStore } from './planStore'
import { usePlanTarget } from './planTarget'

type Mode = 'steps' | 'original'

/** The JSON of the engine with indents. The text stays as it is if it is not JSON. */
function formatted(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2)
  } catch {
    return json
  }
}

const request = (measure: boolean) =>
  void usePlanStore.getState().request(measure)

/** The Plan tab before the first plan: the statement at the cursor and the actions. */
function Start() {
  const statement = usePlanTarget((state) => state.statement)
  const explain = usePlanTarget((state) => state.explain)
  const measure = usePlanTarget((state) => state.measure)
  const hasStatement = statement.trim() !== ''
  return (
    <div className="plan-start">
      <p className="plan-start__title">
        {hasStatement
          ? 'Explain the statement at the cursor'
          : 'Put the cursor in a statement.'}
      </p>
      {hasStatement && (
        <pre className="plan__statement">{statement.trim()}</pre>
      )}
      <div className="plan-start__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={explain !== null}
          aria-keyshortcuts="Control+E"
          onClick={() => request(false)}
        >
          Explain
          <span className="query__key" aria-hidden="true">
            Ctrl+E
          </span>
        </button>
        <button
          type="button"
          className="button"
          disabled={measure !== null}
          aria-keyshortcuts="Control+Shift+E"
          onClick={() => request(true)}
        >
          Explain and measure
          <span className="query__key" aria-hidden="true">
            Ctrl+Shift+E
          </span>
        </button>
      </div>
      {hasStatement && (explain ?? measure) && (
        <p className="field__hint">{(explain ?? measure)?.message}</p>
      )}
      <ul className="plan-start__help">
        <li>
          Explain shows the estimate of the planner. The database does not run
          the statement.
        </li>
        <li>
          Explain and measure runs the statement and measures each step. A
          confirmation comes first.
        </li>
      </ul>
    </div>
  )
}

/** Opens the assistant panel and asks for an analysis of the plan. */
function askTheAi(measure: boolean) {
  const shell = useShellStore.getState()
  if (!shell.panels.assistant) shell.togglePanel('assistant')
  void activeSession().getState().analyzePlan(measure)
}

/** The statement, the mode, and the actions of a plan. */
function Header({
  isMeasured,
  hasSteps,
  statement,
  mode,
  onMode,
}: {
  isMeasured: boolean
  hasSteps: boolean
  statement: string | null
  mode: Mode
  onMode: (mode: Mode) => void
}) {
  return (
    <div className="plan-header">
      {statement && (
        <pre className="plan__statement plan-header__statement">
          {statement.trim()}
        </pre>
      )}
      <div className="plan-header__bar">
        <span className="badge">{isMeasured ? 'Measured' : 'Estimate'}</span>
        <div className="segmented" role="radiogroup" aria-label="Plan view">
          {(
            [
              ['steps', 'Steps'],
              ['original', 'Original'],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={`segmented__option ${mode === value ? 'segmented__option--selected' : ''}`}
            >
              <input
                type="radio"
                name="plan-view"
                className="visually-hidden"
                value={value}
                checked={mode === value}
                disabled={value === 'steps' && !hasSteps}
                onChange={() => onMode(value)}
              />
              {label}
            </label>
          ))}
        </div>
        <span className="title-bar__spacer" />
        <button
          type="button"
          className="button button--small"
          onClick={() => void usePlanStore.getState().again()}
        >
          Explain again
        </button>
        <button
          type="button"
          className="button button--small"
          title="Opens the assistant. It reads the plan again and analyzes it."
          onClick={() => askTheAi(isMeasured)}
        >
          Ask the AI
        </button>
      </div>
    </div>
  )
}

function Summary({ plan }: { plan: Plan }) {
  const parts = [
    plan.isAnalyzed
      ? 'The database ran the statement and measured each step.'
      : 'Estimates of the planner. The database did not run the statement.',
    plan.totalTime === null ? null : `Total: ${milliseconds(plan.totalTime)}.`,
    plan.planningTime === null
      ? null
      : `Planning: ${milliseconds(plan.planningTime)}.`,
  ].filter(Boolean)
  return <p className="results__status">{parts.join(' ')}</p>
}

/** The data of the complete statement, each value with its explanation. */
function Totals({ plan }: { plan: Plan }) {
  if (plan.totals.length === 0) return null
  return (
    <details className="plan__card">
      <summary>Totals of the statement</summary>
      <dl className="plan__details">
        {plan.totals.map(([key, value]) => {
          const text = plan.totalTexts?.[key] ?? totalText(key)
          return (
            <div key={key}>
              <dt>{key}</dt>
              <dd>
                <span className="plan__value">{value}</span>
                {text && <span className="plan__explain">{text}</span>}
              </dd>
            </div>
          )
        })}
      </dl>
    </details>
  )
}

function ReadingGuide() {
  return (
    <details className="plan__card">
      <summary>How to read this plan</summary>
      <ul className="plan__guide">
        {READING_GUIDE.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
    </details>
  )
}

/** The execution plan of a statement as a tree. The costliest steps are marked. */
export function PlanView() {
  const status = usePlanStore((state) => state.status)
  const plan = usePlanStore((state) => state.plan)
  const statement = usePlanStore((state) => state.statement)
  const text = usePlanStore((state) => state.text)
  const isMeasured = usePlanStore((state) => state.isMeasured)
  const error = usePlanStore((state) => state.error)
  const [showsFields, setShowsFields] = useState(true)
  const [mode, setMode] = useState<Mode>('steps')

  if (status === 'idle') return <Start />
  if (status === 'reading') return <p role="status">Reading the plan…</p>
  if (status === 'failed') {
    return (
      <>
        <p className="message message--error" role="alert">
          {error ?? 'The plan is not available.'}
        </p>
        <Start />
      </>
    )
  }
  return (
    <div className="plan">
      <Header
        isMeasured={isMeasured}
        hasSteps={plan !== null}
        statement={statement}
        mode={plan ? mode : 'original'}
        onMode={setMode}
      />
      {!plan && (
        <p className="field__hint">
          The engine gives this plan only as text. The steps are not available.
        </p>
      )}
      {mode === 'original' || !plan ? (
        <pre className="plan__original" aria-label="Original plan">
          {formatted(text ?? '')}
        </pre>
      ) : (
        <Steps
          plan={plan}
          showsFields={showsFields}
          onFields={setShowsFields}
        />
      )}
    </div>
  )
}

function Steps({
  plan,
  showsFields,
  onFields,
}: {
  plan: Plan
  showsFields: boolean
  onFields: (showsFields: boolean) => void
}) {
  return (
    <>
      <div className="plan__bar-top">
        <Summary plan={plan} />
        <label className="field--check">
          <input
            type="checkbox"
            checked={showsFields}
            onChange={(event) => onFields(event.target.checked)}
          />
          <span>Show all fields of each step</span>
        </label>
      </div>
      <ReadingGuide />
      <Totals plan={plan} />
      <ul className="plan__tree" aria-label="Plan steps">
        <PlanStep
          node={plan.root}
          plan={plan}
          hot={costliest(plan)}
          showsFields={showsFields}
        />
      </ul>
    </>
  )
}

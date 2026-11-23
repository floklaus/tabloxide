import { useState } from 'react'
import { READING_GUIDE, totalText } from './planGlossary'
import { milliseconds } from './planFormat'
import { costliest, type Plan } from './planModel'
import { PlanStep } from './PlanStep'
import { usePlanStore } from './planStore'

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
          const text = totalText(key)
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
  const error = usePlanStore((state) => state.error)
  const [showsFields, setShowsFields] = useState(true)

  if (status === 'idle') {
    return (
      <p className="pane__hint">
        Put the cursor in a statement, then select Explain or Explain analyze in
        the editor bar. Explain analyze runs the statement, thus it is available
        only for a statement that reads data.
      </p>
    )
  }
  if (status === 'reading') return <p role="status">Reading the plan…</p>
  if (status === 'failed' || !plan) {
    return (
      <p className="message message--error" role="alert">
        {error ?? 'The plan is not available.'}
      </p>
    )
  }
  return (
    <div className="plan">
      <div className="plan__bar-top">
        <Summary plan={plan} />
        <label className="field--check">
          <input
            type="checkbox"
            checked={showsFields}
            onChange={(event) => setShowsFields(event.target.checked)}
          />
          <span>Show all fields of each step</span>
        </label>
      </div>
      <ReadingGuide />
      <Totals plan={plan} />
      {statement && <pre className="plan__statement">{statement.trim()}</pre>}
      <ul className="plan__tree" aria-label="Plan steps">
        <PlanStep
          node={plan.root}
          plan={plan}
          hot={costliest(plan)}
          showsFields={showsFields}
        />
      </ul>
    </div>
  )
}

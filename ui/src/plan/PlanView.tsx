import { costliest, type Plan, type PlanNode } from './planModel'
import { usePlanStore } from './planStore'

const numbers = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const percent = new Intl.NumberFormat(undefined, {
  style: 'percent',
  maximumFractionDigits: 0,
})

function milliseconds(value: number): string {
  return value < 1000
    ? `${numbers.format(value)} ms`
    : `${numbers.format(value / 1000)} s`
}

function measureText(node: PlanNode, isAnalyzed: boolean): string | null {
  if (isAnalyzed && node.selfTime !== null) return milliseconds(node.selfTime)
  if (node.selfCost !== null) return `cost ${numbers.format(node.selfCost)}`
  return null
}

function rowsText(node: PlanNode): string | null {
  const parts = [
    node.estimatedRows === null
      ? null
      : `${numbers.format(node.estimatedRows)} expected`,
    node.actualRows === null
      ? null
      : `${numbers.format(node.actualRows)} actual`,
  ].filter(Boolean)
  return parts.length > 0 ? `rows: ${parts.join(', ')}` : null
}

function misestimateText(factor: number): string {
  return factor > 0
    ? `${factor} times more rows than expected`
    : `${-factor} times fewer rows than expected`
}

type NodeProps = { node: PlanNode; plan: Plan; hot: Set<string> }

function PlanStep({ node, plan, hot }: NodeProps) {
  const isHot = hot.has(node.id)
  const measure = measureText(node, plan.isAnalyzed)
  const rows = rowsText(node)
  return (
    <li className={`plan__step${isHot ? ' plan__step--hot' : ''}`}>
      <details open>
        <summary className="plan__summary">
          <span className="plan__operation">{node.operation}</span>
          {node.target && <span className="plan__target">{node.target}</span>}
          {isHot && <span className="badge badge--production">costly</span>}
          {node.misestimate !== null && (
            <span className="badge badge--staging">
              {misestimateText(node.misestimate)}
            </span>
          )}
          <span className="plan__numbers">
            {[
              measure,
              node.share === null ? null : percent.format(node.share),
              rows,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          {node.share !== null && (
            <span className="plan__bar" aria-hidden="true">
              <span style={{ width: `${Math.round(node.share * 100)}%` }} />
            </span>
          )}
        </summary>
        {node.details.length > 0 && (
          <dl className="plan__details">
            {node.details.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {node.children.length > 0 && (
          <ul className="plan__children">
            {node.children.map((child) => (
              <PlanStep key={child.id} node={child} plan={plan} hot={hot} />
            ))}
          </ul>
        )}
      </details>
    </li>
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

/** The execution plan of a statement as a tree. The costliest steps are marked. */
export function PlanView() {
  const status = usePlanStore((state) => state.status)
  const plan = usePlanStore((state) => state.plan)
  const statement = usePlanStore((state) => state.statement)
  const error = usePlanStore((state) => state.error)

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
      <Summary plan={plan} />
      {statement && <pre className="plan__statement">{statement.trim()}</pre>}
      <ul className="plan__tree" aria-label="Plan steps">
        <PlanStep node={plan.root} plan={plan} hot={costliest(plan)} />
      </ul>
    </div>
  )
}

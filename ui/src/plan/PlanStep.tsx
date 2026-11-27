import {
  fieldInfo,
  GROUP_LABELS,
  GROUP_ORDER,
  operationText,
  type FieldGroup,
} from './planGlossary'
import {
  measureText,
  misestimateText,
  numbersSentence,
  percent,
  rowsText,
} from './planFormat'
import { hintsOf } from './planHints'
import type { Plan, PlanNode } from './planModel'

type StepProps = {
  node: PlanNode
  plan: Plan
  hot: Set<string>
  showsFields: boolean
}

/** All fields of a step in groups, each field with its explanation. */
function Fields({ node }: { node: PlanNode }) {
  const groups = new Map<FieldGroup, [string, string, string | null][]>()
  for (const [key, value] of node.details) {
    const info = fieldInfo(key)
    const group = node.fieldGroups?.[key] ?? info.group
    groups.set(group, [
      ...(groups.get(group) ?? []),
      [key, value, node.fieldTexts?.[key] ?? info.text],
    ])
  }
  return (
    <div className="plan__fields">
      {GROUP_ORDER.filter((group) => groups.has(group)).map((group) => (
        <section key={group} className="plan__group">
          <h4 className="plan__group-title">{GROUP_LABELS[group]}</h4>
          <dl className="plan__details">
            {groups.get(group)?.map(([key, value, text]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>
                  <span className="plan__value">{value}</span>
                  {text && <span className="plan__explain">{text}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}

/** One step of the plan with its explanation, its hints, its fields, and its child steps. */
export function PlanStep({ node, plan, hot, showsFields }: StepProps) {
  const isHot = hot.has(node.id)
  const measure = measureText(node, plan.isAnalyzed)
  const rows = rowsText(node)
  const about =
    node.about !== undefined
      ? node.about
      : operationText(plan.engine, node.operation)
  const hints = plan.hints
    ? plan.hints
        .filter((hint) => hint.step === node.id)
        .map((hint) => ({
          level: hint.level,
          text: `${hint.title}. ${hint.text}`,
        }))
    : hintsOf(node, plan, hot)
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
        <div className="plan__body">
          <p className="plan__about">
            {about ?? 'Tabloxide has no explanation for this step.'}{' '}
            {numbersSentence(node, plan.isAnalyzed)}
          </p>
          {hints.length > 0 && (
            <ul
              className="plan__hints"
              aria-label={`Hints for ${node.operation}`}
            >
              {hints.map((hint) => (
                <li
                  key={hint.text}
                  className={`plan__hint plan__hint--${hint.level}`}
                >
                  <span className="plan__hint-level">
                    {hint.level === 'warning' ? 'Check' : 'Note'}
                  </span>{' '}
                  {hint.text}
                </li>
              ))}
            </ul>
          )}
          {showsFields && node.details.length > 0 && <Fields node={node} />}
        </div>
        {node.children.length > 0 && (
          <ul className="plan__children">
            {node.children.map((child) => (
              <PlanStep
                key={child.id}
                node={child}
                plan={plan}
                hot={hot}
                showsFields={showsFields}
              />
            ))}
          </ul>
        )}
      </details>
    </li>
  )
}

import type { Plan, PlanNode } from './planModel'

/** A remark about a step. A `warning` is a probable cause of a slow statement. */
export type Hint = { level: 'warning' | 'info'; text: string }

function misestimateHint(node: PlanNode): Hint | null {
  if (node.misestimate === null) return null
  const factor = Math.abs(node.misestimate)
  const direction = node.misestimate > 0 ? 'more' : 'fewer'
  return {
    level: 'warning',
    text: `The step returned ${factor} times ${direction} rows than the planner expected. With a wrong estimate, the planner can select a slow join or scan. ANALYZE on the tables updates their statistics. For conditions on related columns, CREATE STATISTICS can help.`,
  }
}

function costlyHint(node: PlanNode, plan: Plan, hot: Set<string>): Hint | null {
  if (!hot.has(node.id) || node.share === null) return null
  const what = plan.isAnalyzed ? 'time' : 'estimated cost'
  return {
    level: 'info',
    text: `This step has ${Math.round(node.share * 100)} % of the ${what} of the statement, without its child steps. Look at this step first.`,
  }
}

/**
 * Returns the remarks about a step: the hints of the view for all engines, then the
 * hints of the engine. `hot` has the identifiers of the costliest steps.
 */
export function hintsOf(node: PlanNode, plan: Plan, hot: Set<string>): Hint[] {
  const own = [costlyHint(node, plan, hot), misestimateHint(node)].filter(
    (hint): hint is Hint => hint !== null,
  )
  const engine = plan.hints
    .filter((hint) => hint.step === node.id)
    .map((hint) => ({ level: hint.level, text: `${hint.title}. ${hint.text}` }))
  return [...own, ...engine]
}

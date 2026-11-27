import type {
  FieldGroup,
  HintLevel,
  PlanStep_Serialize,
  Plan_Serialize,
} from '../bindings'

/**
 * One step of an execution plan. The adapter or the connector of the engine makes
 * the steps (docs/Plan Design.md). The view adds the identifiers, the shares, and
 * the misestimates.
 */
export type PlanNode = {
  /** The path of the step in the tree, for example `0.1.0`. */
  id: string
  /** The operation, for example `Hash Join` or `IXSCAN`. */
  operation: string
  /** The table, the collection, or the index that the step reads. */
  target: string | null
  /** The explanation of the operation from the engine, or `null`. */
  about: string | null
  /** All other data of the step as the engine names it. The values are text. */
  details: [string, string][]
  /** The explanations of the fields, by field name. */
  fieldTexts: Record<string, string>
  /** The sections of the fields, by field name. */
  fieldGroups: Record<string, FieldGroup>
  /** How many times the step ran. Only for a measured plan. */
  loops: number | null
  /** The number of rows that the planner expected. */
  estimatedRows: number | null
  /** The number of rows that the step returned. Only for a measured plan. */
  actualRows: number | null
  /** The cost of this step without its child steps, in the unit of the plan. */
  selfCost: number | null
  /** The time of this step without its child steps, in milliseconds. */
  selfTime: number | null
  /**
   * The part of this step in the total, from 0 to 1. The total is the time of a
   * measured plan, else the cost. `null` if the plan has neither.
   */
  share: number | null
  /**
   * How many times the actual row count is larger or smaller than the estimate.
   * `null` if the difference is less than `MISESTIMATE_FACTOR` or a count is missing.
   */
  misestimate: number | null
  children: PlanNode[]
}

/** A hint of the engine. The step is the path, for example `0.1`. */
export type EngineHint = {
  step: string
  level: HintLevel
  title: string
  text: string
}

export type Plan = {
  root: PlanNode
  isAnalyzed: boolean
  /** The data of the complete statement, for example the memory or the trigger times. */
  totals: [string, string][]
  /** The explanations of the totals, by name. */
  totalTexts: Record<string, string>
  /** The total time in milliseconds. Only for a measured plan. */
  totalTime: number | null
  /** The time of the planner in milliseconds, if the engine gives it. */
  planningTime: number | null
  /** The hints of the engine. */
  hints: EngineHint[]
  /** The unit of the cost, for example `cost units` or `documents`. */
  costUnit: string
}

/** A difference of this factor or more between estimate and result is a misestimate. */
export const MISESTIMATE_FACTOR = 10

type RawNode = Omit<PlanNode, 'id' | 'share' | 'misestimate' | 'children'> & {
  children: RawNode[]
}

const sum = (values: (number | null)[]): number =>
  values.reduce<number>((total, value) => total + (value ?? 0), 0)

function inclusiveCost(node: RawNode): number {
  return (node.selfCost ?? 0) + sum(node.children.map(inclusiveCost))
}

function inclusiveTime(node: RawNode): number {
  return (node.selfTime ?? 0) + sum(node.children.map(inclusiveTime))
}

function misestimate(node: RawNode): number | null {
  const { estimatedRows: estimate, actualRows: actual } = node
  if (estimate === null || actual === null) return null
  const factor = Math.max(actual, 1) / Math.max(estimate, 1)
  const size = Math.max(factor, 1 / factor)
  if (size < MISESTIMATE_FACTOR) return null
  return factor >= 1 ? Math.round(size) : -Math.round(size)
}

function finish(
  node: RawNode,
  id: string,
  total: number | null,
  measure: (node: RawNode) => number | null,
): PlanNode {
  const value = measure(node)
  return {
    ...node,
    id,
    share: total && value !== null ? value / total : null,
    misestimate: misestimate(node),
    children: node.children.map((child, index) =>
      finish(child, `${id}.${index}`, total, measure),
    ),
  }
}

function texts(
  fields: { name: string; explanation: string | null }[],
): Record<string, string> {
  return Object.fromEntries(
    fields.flatMap((field) =>
      field.explanation === null ? [] : [[field.name, field.explanation]],
    ),
  )
}

function rawNode(step: PlanStep_Serialize): RawNode {
  return {
    operation: step.operation,
    target: step.target,
    about: step.explanation,
    details: step.fields.map((field) => [field.name, field.value]),
    fieldTexts: texts(step.fields),
    fieldGroups: Object.fromEntries(
      step.fields.map((field) => [field.name, field.group]),
    ),
    loops: step.loops,
    estimatedRows: step.estimatedRows,
    actualRows: step.actualRows,
    selfCost: step.selfCost,
    selfTime: step.selfMs,
    children: step.children.map(rawNode),
  }
}

/**
 * Reads a plan in the common form of an adapter or a connector. A measured plan
 * with times gives the shares of the time, else the shares of the cost.
 */
export function fromCommon(plan: Plan_Serialize): Plan {
  const raw = rawNode(plan.root)
  const useTime = plan.isMeasured && inclusiveTime(raw) > 0
  const measure = (node: RawNode) => (useTime ? node.selfTime : node.selfCost)
  const total = useTime ? inclusiveTime(raw) : inclusiveCost(raw) || null
  return {
    root: finish(raw, '0', total, measure),
    isAnalyzed: plan.isMeasured,
    totals: plan.totals.map((field) => [field.name, field.value]),
    totalTexts: texts(plan.totals),
    totalTime: plan.totalMs,
    planningTime: plan.planningMs,
    hints: plan.hints,
    costUnit: plan.costUnit,
  }
}

/** Returns the steps of the plan, each step before its children. */
export function flatten(node: PlanNode): PlanNode[] {
  return [node, ...node.children.flatMap(flatten)]
}

/** Returns the identifiers of the `count` steps with the largest share. */
export function costliest(plan: Plan, count = 3): Set<string> {
  return new Set(
    flatten(plan.root)
      .filter((node) => (node.share ?? 0) > 0)
      .sort((a, b) => (b.share ?? 0) - (a.share ?? 0))
      .slice(0, count)
      .map((node) => node.id),
  )
}

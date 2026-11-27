import type {
  Engine,
  FieldGroup,
  PlanStep_Serialize,
  Plan_Serialize,
} from '../bindings'

/** One step of an execution plan, in a form that does not depend on the engine. */
export type PlanNode = {
  /** The path of the step in the tree, for example `0.1.0`. */
  id: string
  /** The operation, for example `Hash Join` or `HASH_JOIN`. */
  operation: string
  /** The table or the index that the step reads. */
  target: string | null
  /**
   * All other data of the step as the engine names it, for example the filter, the
   * join condition, or the buffer reads. The values are text.
   */
  details: [string, string][]
  /** How many times the step ran. Only after ANALYZE, and only for PostgreSQL. */
  loops: number | null
  /** The number of rows that the planner expected. */
  estimatedRows: number | null
  /** The number of rows that the step returned. Only after ANALYZE. */
  actualRows: number | null
  /** The cost of this step without its child steps, in the unit of the planner. */
  selfCost: number | null
  /** The time of this step without its child steps, in milliseconds. Only after ANALYZE. */
  selfTime: number | null
  /**
   * The part of this step in the total, from 0 to 1. The total is the time after
   * ANALYZE, else the cost. `null` if the plan has neither.
   */
  share: number | null
  /**
   * How many times the actual row count is larger or smaller than the estimate.
   * `null` if the difference is less than `MISESTIMATE_FACTOR` or a count is missing.
   */
  misestimate: number | null
  /**
   * The explanation of the operation from the engine. `undefined` if the engine
   * gives none. Then the view uses the glossary of the application.
   */
  about?: string | null
  /** The explanations of the fields from the engine, by field name. */
  fieldTexts?: Record<string, string>
  /** The sections of the fields from the engine, by field name. */
  fieldGroups?: Record<string, FieldGroup>
  children: PlanNode[]
}

/** A hint from the engine. The step is the path, for example `0.1`. */
export type EngineHint = {
  step: string
  level: 'info' | 'warning'
  title: string
  text: string
}

export type Plan = {
  engine: Engine
  root: PlanNode
  isAnalyzed: boolean
  /** The data of the complete statement, for example the memory or the trigger times. */
  totals: [string, string][]
  /** The total time in milliseconds. Only after ANALYZE. */
  totalTime: number | null
  /** The time of the planner in milliseconds, if the engine gives it. */
  planningTime: number | null
  /**
   * The hints of the engine. `undefined` if the plan comes from the JSON of the
   * engine. Then the view makes its own hints.
   */
  hints?: EngineHint[]
  /** The explanations of the totals from the engine, by name. */
  totalTexts?: Record<string, string>
  /** The unit of the cost, for example `documents`. */
  costUnit?: string
}

/** A difference of this factor or more between estimate and result is a misestimate. */
export const MISESTIMATE_FACTOR = 10

type Json = Record<string, unknown>

type RawNode = Omit<PlanNode, 'id' | 'share' | 'misestimate' | 'children'> & {
  children: RawNode[]
}

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function number(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
}

function text(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (Array.isArray(value)) {
    if (value.length === 0) return null
    return value
      .map((item) => (isObject(item) ? JSON.stringify(item) : String(item)))
      .join(', ')
  }
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (isObject(value)) return JSON.stringify(value)
  return String(value)
}

/** Returns the fields of `object` as text, without the keys in `skip`. */
function fieldsOf(object: Json, skip: Set<string>): [string, string][] {
  return Object.entries(object).flatMap(([key, value]) => {
    const shown = skip.has(key) ? null : text(value)
    return shown === null ? [] : [[key, shown] as [string, string]]
  })
}

const sum = (values: (number | null)[]): number =>
  values.reduce<number>((total, value) => total + (value ?? 0), 0)

// PostgreSQL

/** The fields of a PostgreSQL step that the step summary shows, or that are the tree. */
const POSTGRES_STRUCTURE = new Set(['Node Type', 'Plans'])

/** The fields of the PostgreSQL plan that `Plan` has as numbers, or that are the tree. */
const POSTGRES_PLAN_STRUCTURE = new Set([
  'Plan',
  'Planning Time',
  'Execution Time',
])

function postgresTarget(node: Json): string | null {
  const relation = text(node['Relation Name'])
  const alias = text(node['Alias'])
  const index = text(node['Index Name'])
  const named =
    relation && alias && alias !== relation
      ? `${relation} AS ${alias}`
      : relation
  const parts = [named, index ? `index ${index}` : null].filter(Boolean)
  const other = text(node['CTE Name']) ?? text(node['Function Name'])
  return parts.length > 0 ? parts.join(', ') : other
}

function postgresNode(node: Json): RawNode {
  const children = (Array.isArray(node['Plans']) ? node['Plans'] : [])
    .filter(isObject)
    .map(postgresNode)
  const loops = number(node['Actual Loops']) ?? 1
  const actualRows = number(node['Actual Rows'])
  // PostgreSQL gives the time of one loop. The time of the step is for all loops.
  const time = number(node['Actual Total Time'])
  const totalTime = time === null ? null : time * loops
  const totalCost = number(node['Total Cost'])
  return {
    operation: text(node['Node Type']) ?? 'Step',
    target: postgresTarget(node),
    details: fieldsOf(node, POSTGRES_STRUCTURE),
    loops: number(node['Actual Loops']),
    estimatedRows: number(node['Plan Rows']),
    // The estimate is for one loop. Compare it with the rows of one loop.
    actualRows: actualRows,
    selfCost:
      totalCost === null
        ? null
        : Math.max(0, totalCost - sum(children.map(inclusiveCost))),
    selfTime:
      totalTime === null
        ? null
        : Math.max(0, totalTime - sum(children.map(inclusiveTime))),
    children,
  }
}

function inclusiveCost(node: RawNode): number {
  return (node.selfCost ?? 0) + sum(node.children.map(inclusiveCost))
}

function inclusiveTime(node: RawNode): number {
  return (node.selfTime ?? 0) + sum(node.children.map(inclusiveTime))
}

type Parsed = Omit<Plan, 'root' | 'engine'> & { raw: RawNode }

function parsePostgres(json: unknown): Parsed {
  const first = Array.isArray(json) ? json[0] : json
  if (!isObject(first) || !isObject(first['Plan'])) {
    throw new Error('The plan of PostgreSQL has no "Plan" object.')
  }
  const raw = postgresNode(first['Plan'])
  const execution = number(first['Execution Time'])
  return {
    raw,
    isAnalyzed: execution !== null,
    totalTime: execution,
    planningTime: number(first['Planning Time']),
    totals: fieldsOf(first, POSTGRES_PLAN_STRUCTURE),
  }
}

// DuckDB

/** Steps that DuckDB adds around the plan of the statement. */
const DUCKDB_WRAPPERS = new Set([
  'RESULT_COLLECTOR',
  'EXECUTE',
  'EXPLAIN_ANALYZE',
  'QUERY',
])

const DUCKDB_HIDDEN = new Set(['Estimated Cardinality', 'Table'])

/** The fields of a DuckDB operator that the step summary shows, or that are the tree. */
const DUCKDB_STRUCTURE = new Set([
  'children',
  'extra_info',
  'name',
  'type',
  'operator_type',
  'timing',
  'operator_timing',
  'operator_cardinality',
  'intermediate_rows',
])

/** The groups of the DuckDB profile with data of the complete statement. */
const DUCKDB_TOTAL_GROUPS = [
  'query',
  'system',
  'io',
  'planner',
  'physical_planner',
]

function duckdbTotals(json: unknown): [string, string][] {
  if (!isObject(json)) return []
  return DUCKDB_TOTAL_GROUPS.flatMap((group) => {
    const values = json[group]
    if (!isObject(values)) return []
    return fieldsOf(values, new Set(['sql'])).map(
      ([key, value]) => [`${group}.${key}`, value] as [string, string],
    )
  })
}

function duckdbNode(node: Json): RawNode {
  const info = isObject(node['extra_info']) ? node['extra_info'] : {}
  const children = (Array.isArray(node['children']) ? node['children'] : [])
    .filter(isObject)
    .map(duckdbNode)
  // DuckDB gives the time of each operator without its children, in seconds.
  const seconds = number(node['timing'] ?? node['operator_timing'])
  return {
    operation:
      text(node['name'] ?? node['type'] ?? node['operator_type']) ?? 'Step',
    target: text(info['Table']),
    details: [
      ...fieldsOf(info, DUCKDB_HIDDEN),
      ...fieldsOf(node, DUCKDB_STRUCTURE),
    ],
    loops: null,
    estimatedRows: number(info['Estimated Cardinality']),
    actualRows: number(
      node['operator_cardinality'] ?? node['intermediate_rows'],
    ),
    selfCost: null,
    selfTime: seconds === null ? null : seconds * 1000,
    children,
  }
}

/** Goes past the steps that DuckDB adds around the plan. */
function unwrapDuckdb(node: Json): Json {
  let current = node
  for (;;) {
    const type = text(current['type'] ?? current['name'])
    const children = Array.isArray(current['children'])
      ? current['children']
      : []
    if (!type || !DUCKDB_WRAPPERS.has(type) || children.length !== 1)
      return current
    if (!isObject(children[0])) return current
    current = children[0]
  }
}

function parseDuckdb(json: unknown): Parsed {
  const isAnalyzed = isObject(json) && Array.isArray(json['operator'])
  const nodes = isAnalyzed ? (json as Json)['operator'] : json
  const first = Array.isArray(nodes) ? nodes[0] : null
  if (!isObject(first)) throw new Error('The plan of DuckDB has no step.')
  const raw = duckdbNode(unwrapDuckdb(first))
  return {
    raw,
    isAnalyzed,
    totalTime: isAnalyzed ? inclusiveTime(raw) : null,
    planningTime: null,
    totals: isAnalyzed ? duckdbTotals(json) : [],
  }
}

// Common

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

/**
 * Reads the JSON plan of an engine. Throws an error with a message for the user if
 * the JSON is not a plan.
 */
export function parsePlan(engine: Engine, jsonText: string): Plan {
  let json: unknown
  try {
    json = JSON.parse(jsonText)
  } catch {
    throw new Error('The plan is not valid JSON.')
  }
  return finishPlan(
    engine,
    engine === 'duckdb' ? parseDuckdb(json) : parsePostgres(json),
  )
}

/** Adds the identifiers, the shares, and the misestimates to the steps. */
function finishPlan(engine: Engine, parsed: Parsed): Plan {
  const { raw, ...rest } = parsed
  const useTime = rest.isAnalyzed && inclusiveTime(raw) > 0
  const measure = (node: RawNode) => (useTime ? node.selfTime : node.selfCost)
  const total = useTime ? inclusiveTime(raw) : inclusiveCost(raw) || null
  return { ...rest, engine, root: finish(raw, '0', total, measure) }
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

function commonNode(step: PlanStep_Serialize): RawNode {
  return {
    operation: step.operation,
    target: step.target,
    details: step.fields.map((field) => [field.name, field.value]),
    loops: step.loops,
    estimatedRows: step.estimatedRows,
    actualRows: step.actualRows,
    selfCost: step.selfCost,
    selfTime: step.selfMs,
    about: step.explanation ?? undefined,
    fieldTexts: texts(step.fields),
    fieldGroups: Object.fromEntries(
      step.fields.map((field) => [field.name, field.group]),
    ),
    children: step.children.map(commonNode),
  }
}

/** Reads a plan in the common form of an adapter or a connector. */
export function fromCommon(engine: Engine, plan: Plan_Serialize): Plan {
  return {
    ...finishPlan(engine, {
      raw: commonNode(plan.root),
      isAnalyzed: plan.isMeasured,
      totalTime: plan.totalMs,
      planningTime: plan.planningMs,
      totals: plan.totals.map((field) => [field.name, field.value]),
    }),
    hints: plan.hints,
    totalTexts: texts(plan.totals),
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

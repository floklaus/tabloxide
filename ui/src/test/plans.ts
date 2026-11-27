import type {
  FieldGroup,
  PlanField_Serialize,
  PlanStep_Serialize,
  Plan_Serialize,
} from '../bindings'

/** Plans in the common form for the tests of the Plan tab. */

const SCAN_TEXT =
  'Reads all rows of the table, from the first to the last, and keeps the rows that agree with the filter.'

function field(
  name: string,
  value: string,
  group: FieldGroup = 'step',
  explanation: string | null = null,
): PlanField_Serialize {
  return { name, value, group, explanation }
}

function step(
  operation: string,
  values: Partial<PlanStep_Serialize> = {},
): PlanStep_Serialize {
  return {
    operation,
    target: null,
    explanation: null,
    fields: [],
    estimatedRows: null,
    actualRows: null,
    loops: null,
    selfCost: null,
    selfMs: null,
    children: [],
    ...values,
  }
}

function scan(table: string, measured: boolean): PlanStep_Serialize {
  return step('Seq Scan', {
    target: table,
    explanation: SCAN_TEXT,
    fields: [
      field(
        'Filter',
        '(id > 5)',
        'step',
        'The condition that the step checks on each row.',
      ),
      field('Plan Width', '8', 'estimate', 'The average size of a row.'),
    ],
    estimatedRows: 100,
    actualRows: measured ? 2000 : null,
    loops: measured ? 1 : null,
    selfCost: table === 't' ? 189 : 20,
    selfMs: measured ? (table === 't' ? 8 : 1) : null,
  })
}

function tree(measured: boolean): PlanStep_Serialize {
  const rows = (estimate: number, actual: number) => ({
    estimatedRows: estimate,
    actualRows: measured ? actual : null,
    loops: measured ? 1 : null,
  })
  return step('Sort', {
    explanation: 'Sorts the rows.',
    ...rows(10, 10),
    selfCost: 5,
    selfMs: measured ? 0.5 : null,
    children: [
      step('Aggregate', {
        explanation: 'Calculates the aggregates.',
        ...rows(10, 10),
        selfCost: 10,
        selfMs: measured ? 1 : null,
        children: [
          step('Hash Join', {
            explanation: 'Joins the rows of two inputs with a hash table.',
            ...rows(95, 95),
            selfCost: 30,
            selfMs: measured ? 2 : null,
            children: [
              scan('t', measured),
              step('Hash', {
                explanation: 'Puts the rows into a hash table.',
                ...rows(100, 100),
                selfCost: 1,
                selfMs: measured ? 0.2 : null,
                children: [scan('u', measured)],
              }),
            ],
          }),
        ],
      }),
    ],
  })
}

/** An estimate of PostgreSQL: six steps, two scans with a filter. */
export const ESTIMATE_PLAN: Plan_Serialize = {
  root: tree(false),
  isMeasured: false,
  totalMs: null,
  planningMs: null,
  costUnit: 'cost units',
  totals: [],
  hints: [],
}

/** A measured plan. The scans return 20 times more rows than expected. */
export const MEASURED_PLAN: Plan_Serialize = {
  root: tree(true),
  isMeasured: true,
  totalMs: 12,
  planningMs: 0.3,
  costUnit: 'cost units',
  totals: [field('JIT', 'off', 'step', 'The just-in-time compilation.')],
  hints: [
    {
      step: '0.0.0.0',
      level: 'warning',
      title: 'Filter removes most rows',
      text: 'An index on the columns of the filter can help.',
    },
  ],
}

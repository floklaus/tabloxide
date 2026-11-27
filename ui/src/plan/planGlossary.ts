import type { FieldGroup } from '../bindings'

/**
 * The sections of the fields of a step. The adapter or the connector of the engine
 * puts each field into a section and explains the field (docs/Plan Design.md).
 */
export const GROUP_LABELS: Record<FieldGroup, string> = {
  step: 'What the step does',
  estimate: 'Estimates of the planner',
  measured: 'Measured when the statement ran',
  memory: 'Memory and disk',
  io: 'Reads and writes',
}

export const GROUP_ORDER: FieldGroup[] = [
  'step',
  'estimate',
  'measured',
  'memory',
  'io',
]

/** How to read a plan. The view shows these points above the tree. */
export const READING_GUIDE = [
  'The database runs the steps from the inside to the outside. The deepest steps read the tables or the collections. Each step gives its rows to the step above it.',
  'Cost is an estimate in the unit of the engine. The summary names the unit. Use it to compare the steps of one plan, not of different plans.',
  'The percentage and the bar show the part of each step in the total, without its child steps. The three largest parts have the mark "costly".',
  'A large difference between the expected and the actual rows means that the statistics of a table are old or not sufficient. Then the planner can select a slow step.',
]

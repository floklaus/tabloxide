import type { ColumnKind } from '../../bindings'

/** How the chart uses a column of each kind. A screen reader gets this word. */
export const KIND_LABELS: Record<ColumnKind, string> = {
  number: 'number',
  temporal: 'date',
  text: 'text',
  boolean: 'true or false',
  json: 'JSON',
  other: 'other type',
}

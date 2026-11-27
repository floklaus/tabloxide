import type { Column } from '../../results/gridModel'

/** Makes a column of a result for a test. */
export function column(name: string, kind: Column['kind']): Column {
  return { name, type_name: null, kind }
}

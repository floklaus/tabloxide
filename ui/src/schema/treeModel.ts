import type {
  RelationDetail_Serialize,
  RelationInfo,
  RelationKind,
  SchemaInfo,
} from '../bindings'

export type RelationDetail = RelationDetail_Serialize

export type Load<T> =
  | { status: 'loading' }
  | { status: 'loaded'; data: T }
  | { status: 'failed'; message: string }

/** One line of the schema tree. The tree is a flat list, so that it can be virtual. */
export type TreeRow =
  | {
      type: 'schema'
      key: string
      schema: string
      isSystem: boolean
      isOpen: boolean
    }
  | {
      type: 'relation'
      key: string
      schema: string
      name: string
      kind: RelationKind
      isOpen: boolean
    }
  | { type: 'group'; key: string; label: string }
  | { type: 'item'; key: string; label: string; detail: string }
  | { type: 'note'; key: string; depth: number; text: string; isError: boolean }

export type TreeInput = {
  schemas: Load<SchemaInfo[]> | null
  relations: Record<string, Load<RelationInfo[]>>
  details: Record<string, Load<RelationDetail>>
  expanded: ReadonlySet<string>
  /** Text that a table name must contain. The comparison ignores case. */
  filter: string
}

export function schemaKey(schema: string): string {
  return `s:${schema}`
}

/** The names can contain each printable character, thus the separator is a NUL character. */
export function relationKey(schema: string, name: string): string {
  return `r:${schema}\u0000${name}`
}

const KIND_LABELS: Record<RelationKind, string> = {
  table: 'table',
  view: 'view',
  'materialized-view': 'materialized view',
  'foreign-table': 'foreign table',
}

export function kindLabel(kind: RelationKind): string {
  return KIND_LABELS[kind]
}

function note<T>(
  key: string,
  depth: number,
  load: Load<T> | undefined,
): TreeRow | null {
  if (!load || load.status === 'loading') {
    return { type: 'note', key, depth, text: 'Loading…', isError: false }
  }
  if (load.status === 'failed') {
    return { type: 'note', key, depth, text: load.message, isError: true }
  }
  return null
}

function detailRows(key: string, detail: RelationDetail): TreeRow[] {
  const item = (group: string, label: string, text: string): TreeRow => ({
    type: 'item',
    key: `${key}/${group}/${label}`,
    label,
    detail: text,
  })
  const group = (label: string, rows: TreeRow[]): TreeRow[] =>
    rows.length === 0
      ? []
      : [{ type: 'group', key: `${key}/${label}`, label }, ...rows]
  const columns = detail.columns.map((column) => {
    const flags = [
      column.data_type,
      column.is_primary_key ? 'primary key' : '',
      column.is_nullable ? '' : 'not null',
    ]
    return item('c', column.name, flags.filter(Boolean).join(', '))
  })
  return [
    ...columns,
    ...group(
      'Indexes',
      detail.indexes.map((index) =>
        item('i', index.name, index.is_unique ? 'unique' : ''),
      ),
    ),
    ...group(
      'Constraints',
      detail.constraints.map((constraint) =>
        item('k', constraint.name, constraint.definition),
      ),
    ),
  ]
}

function relationRows(input: TreeInput, schema: string): TreeRow[] {
  const load = input.relations[schema]
  const pending = note(`${schemaKey(schema)}/note`, 1, load)
  if (pending) return [pending]
  if (load?.status !== 'loaded') return []
  const filter = input.filter.trim().toLowerCase()
  const matches = load.data.filter((relation) =>
    relation.name.toLowerCase().includes(filter),
  )
  if (matches.length === 0) {
    const text = filter ? 'No table contains this text.' : 'No tables.'
    return [
      {
        type: 'note',
        key: `${schemaKey(schema)}/empty`,
        depth: 1,
        text,
        isError: false,
      },
    ]
  }
  return matches.flatMap((relation) => {
    const key = relationKey(schema, relation.name)
    const isOpen = input.expanded.has(key)
    const row: TreeRow = {
      type: 'relation',
      key,
      schema,
      name: relation.name,
      kind: relation.kind,
      isOpen,
    }
    if (!isOpen) return [row]
    const detail = input.details[key]
    const detailPending = note(`${key}/note`, 2, detail)
    if (detailPending) return [row, detailPending]
    return detail?.status === 'loaded'
      ? [row, ...detailRows(key, detail.data)]
      : [row]
  })
}

/** Converts the loaded parts of the schema to the visible lines of the tree. */
export function buildRows(input: TreeInput): TreeRow[] {
  if (input.schemas === null) return []
  const pending = note('schemas/note', 0, input.schemas)
  if (pending) return [pending]
  if (input.schemas.status !== 'loaded') return []
  return input.schemas.data.flatMap((schema) => {
    const key = schemaKey(schema.name)
    const isOpen = input.expanded.has(key)
    const row: TreeRow = {
      type: 'schema',
      key,
      schema: schema.name,
      isSystem: schema.is_system,
      isOpen,
    }
    return isOpen ? [row, ...relationRows(input, schema.name)] : [row]
  })
}

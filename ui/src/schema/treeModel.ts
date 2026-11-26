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
      /** The number of tables and views, after the read. */
      count: number | null
    }
  | {
      type: 'relation'
      key: string
      schema: string
      name: string
      kind: RelationKind
      isOpen: boolean
    }
  | {
      type: 'column'
      key: string
      schema: string
      relation: string
      name: string
      /** The type, with `?` for a column that can be NULL, for example `text?`. */
      typeText: string
      isPrimaryKey: boolean
      isForeignKey: boolean
    }
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

/**
 * Returns the columns of the foreign keys of a relation. A definition starts with
 * `FOREIGN KEY (a, b)`.
 */
export function foreignKeyColumns(detail: RelationDetail): Set<string> {
  const columns = new Set<string>()
  for (const constraint of detail.constraints) {
    if (constraint.kind !== 'foreign-key') continue
    const match = /FOREIGN KEY\s*\(([^)]*)\)/i.exec(constraint.definition)
    for (const name of match?.[1].split(',') ?? []) {
      columns.add(name.trim().replace(/^"|"$/g, ''))
    }
  }
  return columns
}

/**
 * Returns the target of the foreign key of each column, for example
 * `customer (customer_id)`, from definitions such as
 * `FOREIGN KEY (customer_id) REFERENCES customer(customer_id) ON DELETE CASCADE`.
 */
export function foreignKeyTargets(detail: RelationDetail): Map<string, string> {
  const targets = new Map<string, string>()
  for (const constraint of detail.constraints) {
    if (constraint.kind !== 'foreign-key') continue
    const match =
      /FOREIGN KEY\s*\(([^)]*)\)\s*REFERENCES\s+([^\s(]+)\s*\(([^)]*)\)/i.exec(
        constraint.definition,
      )
    if (!match) continue
    const columns = match[1].split(',').map((name) => name.trim())
    const targetColumns = match[3].split(',').map((name) => name.trim())
    columns.forEach((column, index) => {
      targets.set(
        column.replace(/^"|"$/g, ''),
        `${match[2]} (${targetColumns[index] ?? targetColumns[0]})`,
      )
    })
  }
  return targets
}

function columnRows(
  key: string,
  schema: string,
  relation: string,
  detail: RelationDetail,
): TreeRow[] {
  const foreign = foreignKeyColumns(detail)
  return detail.columns.map((column) => ({
    type: 'column',
    key: `${key}/c/${column.name}`,
    schema,
    relation,
    name: column.name,
    typeText: `${column.data_type}${column.is_nullable && !column.is_primary_key ? '?' : ''}`,
    isPrimaryKey: column.is_primary_key,
    isForeignKey: foreign.has(column.name),
  }))
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
      ? [row, ...columnRows(key, schema, relation.name, detail.data)]
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
    const relations = input.relations[schema.name]
    const row: TreeRow = {
      type: 'schema',
      key,
      schema: schema.name,
      isSystem: schema.is_system,
      isOpen,
      count: relations?.status === 'loaded' ? relations.data.length : null,
    }
    return isOpen ? [row, ...relationRows(input, schema.name)] : [row]
  })
}

import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from '@codemirror/autocomplete'
import type {
  ColumnInfo_Serialize as ColumnInfo,
  RelationInfo,
} from '../bindings'
import { getCatalog, getColumns, type Catalog } from './catalogCache'
import {
  completionTarget,
  quoteIfNecessary,
  statementAround,
  tableReferences,
  type CompletionTarget,
  type TableReference,
} from './sqlText'

/** The schemas that a statement uses without a schema name. */
const DEFAULT_SCHEMAS = ['public', 'main']

/** The completion reads the columns of a maximum of this number of tables. */
const MAX_TABLES_WITH_COLUMNS = 10

type Relation = { schema: string; info: RelationInfo }

/** Reads the columns of a table. The completion gives this function, the tests a fake. */
export type ColumnReader = (
  schema: string,
  name: string,
) => Promise<ColumnInfo[]>

const sameName = (a: string, b: string) => a === b || a.toLowerCase() === b

/** The user schemas, with the default schemas first. */
function schemaOrder(catalog: Catalog): string[] {
  const names = Object.keys(catalog.relations)
  const rank = (name: string) => {
    const index = DEFAULT_SCHEMAS.indexOf(name)
    return index === -1 ? DEFAULT_SCHEMAS.length : index
  }
  return [...names].sort((a, b) => rank(a) - rank(b))
}

function allRelations(catalog: Catalog): Relation[] {
  return schemaOrder(catalog).flatMap((schema) =>
    (catalog.relations[schema] ?? []).map((info) => ({ schema, info })),
  )
}

/** Finds a table of the catalog. Without a schema, the first match in the schema order. */
export function findRelation(
  catalog: Catalog,
  schema: string | null,
  name: string,
): Relation | null {
  const candidates = allRelations(catalog).filter(
    (relation) => schema === null || sameName(relation.schema, schema),
  )
  return (
    candidates.find((relation) => sameName(relation.info.name, name)) ?? null
  )
}

function columnOptions(
  columns: ColumnInfo[],
  table: string,
  boost: number,
): Completion[] {
  return columns.map((column) => ({
    label: quoteIfNecessary(column.name),
    type: 'property',
    detail: `${column.data_type} · ${table}`,
    boost,
  }))
}

function relationOptions(
  catalog: Catalog,
  onlySchema: string | null,
): Completion[] {
  const relations = allRelations(catalog)
  const count = new Map<string, number>()
  for (const relation of relations) {
    count.set(relation.info.name, (count.get(relation.info.name) ?? 0) + 1)
  }
  const firstSchema = schemaOrder(catalog)[0]
  return relations
    .filter((relation) => onlySchema === null || relation.schema === onlySchema)
    .map(({ schema, info }) => {
      const label = quoteIfNecessary(info.name)
      // Without a qualifier, a table of a different schema needs its schema name.
      const needsSchema =
        onlySchema === null &&
        (schema !== firstSchema || (count.get(info.name) ?? 0) > 1)
      return {
        label,
        type: info.kind === 'table' ? 'class' : 'interface',
        detail: `${info.kind === 'table' ? 'table' : 'view'} · ${schema}`,
        apply: needsSchema ? `${quoteIfNecessary(schema)}.${label}` : label,
      }
    })
}

function schemaOptions(catalog: Catalog): Completion[] {
  return catalog.schemas
    .filter((schema) => !schema.is_system)
    .map((schema) => ({
      label: quoteIfNecessary(schema.name),
      type: 'namespace',
      detail: 'schema',
    }))
}

/** The table of a qualifier: an alias, a table of the statement, or a table of the catalog. */
function tableOfQualifier(
  catalog: Catalog,
  references: TableReference[],
  qualifier: string[],
): Relation | null {
  if (qualifier.length >= 2) {
    const [schema, name] = qualifier.slice(-2)
    return findRelation(catalog, schema, name)
  }
  const [name] = qualifier
  const reference =
    references.find(
      (item) => item.alias !== null && sameName(item.alias, name),
    ) ??
    references.find((item) => item.alias === null && sameName(item.name, name))
  if (reference) return findRelation(catalog, reference.schema, reference.name)
  return findRelation(catalog, null, name)
}

/** Returns the completion options for a target in a statement. */
export async function completionOptions(
  catalog: Catalog,
  statement: string,
  target: CompletionTarget,
  readColumns: ColumnReader,
): Promise<Completion[]> {
  const references = tableReferences(statement)
  if (target.qualifier.length === 0) {
    const tables = references
      .map((reference) =>
        findRelation(catalog, reference.schema, reference.name),
      )
      .filter((relation) => relation !== null)
      .slice(0, MAX_TABLES_WITH_COLUMNS)
    const columns = await Promise.all(
      tables.map(async (table) =>
        columnOptions(
          await readColumns(table.schema, table.info.name),
          table.info.name,
          2,
        ),
      ),
    )
    return [
      ...columns.flat(),
      ...relationOptions(catalog, null),
      ...schemaOptions(catalog),
    ]
  }
  const table = tableOfQualifier(catalog, references, target.qualifier)
  if (table) {
    return columnOptions(
      await readColumns(table.schema, table.info.name),
      table.info.name,
      0,
    )
  }
  if (target.qualifier.length === 1) {
    const schema = Object.keys(catalog.relations).find((name) =>
      sameName(name, target.qualifier[0]),
    )
    if (schema) return relationOptions(catalog, schema)
  }
  return []
}

/**
 * The completion source of the SQL editor. It completes the schemas, the tables, and the
 * columns of the database of `connectionId`. The keywords come from the SQL language.
 */
export async function completeSql(
  context: CompletionContext,
  connectionId: string | null,
): Promise<CompletionResult | null> {
  if (connectionId === null) return null
  const text = context.state.doc.toString()
  const { statement, start } = statementAround(text, context.pos)
  const target = completionTarget(text.slice(start, context.pos))
  if (target === null) return null
  // After a space, the list opens only on request (Ctrl+Space).
  if (
    !context.explicit &&
    target.prefix === '' &&
    target.qualifier.length === 0
  ) {
    return null
  }
  const catalog = await getCatalog(connectionId)
  if (catalog === null || context.aborted) return null
  const options = await completionOptions(
    catalog,
    statement,
    target,
    (schema, name) => getColumns(connectionId, schema, name),
  )
  if (options.length === 0) return null
  return { from: start + target.from, options, validFor: /^"?[\w$]*$/ }
}

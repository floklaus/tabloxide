import {
  commands,
  type ColumnInfo_Serialize as ColumnInfo,
  type RelationInfo,
  type SchemaInfo,
} from '../bindings'

/**
 * The structure of one database for the completion.
 *
 * Each connection has its own catalog session. Thus a read of the catalog never
 * closes an open result of a query tab. The cache reads the schemas and the tables
 * at the first completion, and the columns of a table only when the completion needs them.
 */
export type Catalog = {
  schemas: SchemaInfo[]
  /** The tables and the views of each schema that is not a system schema. */
  relations: Record<string, RelationInfo[]>
}

/** The cache reads the tables of a maximum of this number of schemas. */
export const MAX_SCHEMAS = 50

/** After a failure, the cache tries again after this time. */
export const RETRY_AFTER_MS = 30_000

type Entry = {
  sessionId: Promise<number | null>
  catalog: Promise<Catalog | null>
  columns: Map<string, Promise<ColumnInfo[]>>
  failedAt: number | null
}

const entries = new Map<string, Entry>()

const columnKey = (schema: string, name: string) => `${schema}\u0000${name}`

async function openSession(connectionId: string): Promise<number | null> {
  try {
    const result = await commands.sessionOpen(connectionId)
    if (result.status === 'ok' && result.data.status === 'connected') {
      return result.data.session.id
    }
  } catch {
    // The completion has no catalog. The editor continues without it.
  }
  return null
}

async function readCatalog(sessionId: number): Promise<Catalog | null> {
  const schemas = await commands.schemaList(sessionId)
  if (schemas.status !== 'ok') return null
  const user = schemas.data
    .filter((schema) => !schema.is_system)
    .slice(0, MAX_SCHEMAS)
  const lists = await Promise.all(
    user.map(async (schema) => {
      const result = await commands.schemaRelations(sessionId, schema.name)
      return [schema.name, result.status === 'ok' ? result.data : []] as const
    }),
  )
  return { schemas: schemas.data, relations: Object.fromEntries(lists) }
}

function startEntry(connectionId: string): Entry {
  const sessionId = openSession(connectionId)
  const entry: Entry = {
    sessionId,
    catalog: sessionId.then(async (id) => {
      if (id === null) return null
      try {
        return await readCatalog(id)
      } catch {
        return null
      }
    }),
    columns: new Map(),
    failedAt: null,
  }
  void entry.catalog.then((catalog) => {
    if (catalog === null) entry.failedAt = Date.now()
  })
  entries.set(connectionId, entry)
  return entry
}

function entryFor(connectionId: string): Entry {
  const entry = entries.get(connectionId)
  const isStale =
    entry?.failedAt != null && Date.now() - entry.failedAt > RETRY_AFTER_MS
  if (entry && !isStale) return entry
  if (entry) void closeEntry(entry)
  return startEntry(connectionId)
}

/** Returns the catalog of a connection, or `null` if the database is not available. */
export function getCatalog(connectionId: string): Promise<Catalog | null> {
  return entryFor(connectionId).catalog
}

/** Returns the columns of one table or view. A failure gives an empty list. */
export function getColumns(
  connectionId: string,
  schema: string,
  name: string,
): Promise<ColumnInfo[]> {
  const entry = entryFor(connectionId)
  const key = columnKey(schema, name)
  const known = entry.columns.get(key)
  if (known) return known
  const columns = entry.sessionId.then(async (id) => {
    if (id === null) return []
    try {
      const result = await commands.schemaRelationDetail(id, schema, name)
      return result.status === 'ok' ? result.data.columns : []
    } catch {
      return []
    }
  })
  entry.columns.set(key, columns)
  return columns
}

async function closeEntry(entry: Entry): Promise<void> {
  const id = await entry.sessionId
  if (id === null) return
  try {
    await commands.sessionClose(id)
  } catch {
    // The session closes with the workspace at the latest.
  }
}

/** Forgets the catalog of a connection, for example after a statement changed the schema. */
export function invalidateCatalog(connectionId: string): void {
  const entry = entries.get(connectionId)
  if (!entry) return
  entries.delete(connectionId)
  void closeEntry(entry)
}

/** Forgets all catalogs and closes their sessions. */
export function resetCatalogs(): void {
  for (const connectionId of [...entries.keys()])
    invalidateCatalog(connectionId)
}

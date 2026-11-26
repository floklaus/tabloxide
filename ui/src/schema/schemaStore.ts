import { create } from 'zustand'
import {
  commands,
  type CommandError,
  type RelationInfo,
  type SchemaInfo,
  type StatementReport_Serialize,
} from '../bindings'
import { invalidateCatalog } from '../completion/catalogCache'
import { toMessage } from '../lib/errors'
import {
  relationKey,
  schemaKey,
  type Load,
  type RelationDetail,
} from './treeModel'

type BrowserSession = { id: number; connectionId: string; database: string }

export type SelectedRelation = { schema: string; name: string }

type CommandResult<T> =
  { status: 'ok'; data: T } | { status: 'error'; error: CommandError }

type SchemaState = {
  /** The schema browser has its own database session. */
  session: BrowserSession | null
  isConnecting: boolean
  error: string | null
  schemas: Load<SchemaInfo[]> | null
  relations: Record<string, Load<RelationInfo[]>>
  details: Record<string, Load<RelationDetail>>
  expanded: ReadonlySet<string>
  filter: string
  /** The table that the detail view shows. */
  selected: SelectedRelation | null
  sample: Load<StatementReport_Serialize> | null

  connect: (connectionId: string) => Promise<void>
  disconnect: () => Promise<void>
  /** Reads the schema again. Keeps the open nodes. */
  refresh: () => Promise<void>
  toggleSchema: (schema: string) => Promise<void>
  toggleRelation: (schema: string, name: string) => Promise<void>
  /** Shows the structure and a row sample of a table in the results pane. */
  selectRelation: (schema: string, name: string) => Promise<void>
  setFilter: (filter: string) => void
  reset: () => void
}

const EMPTY = {
  schemas: null,
  relations: {},
  details: {},
  expanded: new Set<string>(),
  selected: null,
  sample: null,
}

const INITIAL = {
  ...EMPTY,
  session: null,
  isConnecting: false,
  error: null,
  filter: '',
}

async function load<T>(
  command: () => Promise<CommandResult<T>>,
): Promise<Load<T>> {
  try {
    const result = await command()
    return result.status === 'ok'
      ? { status: 'loaded', data: result.data }
      : { status: 'failed', message: result.error.message }
  } catch (error) {
    return { status: 'failed', message: toMessage(error) }
  }
}

export const useSchemaStore = create<SchemaState>((set, get) => {
  /** Runs a read for the session `id`. Ignores the result if the session changed. */
  const read = async <T>(
    id: number,
    command: () => Promise<CommandResult<T>>,
    store: (result: Load<T>) => void,
  ) => {
    const result = await load(command)
    if (get().session?.id === id) store(result)
  }

  const loadSchemas = async (id: number) => {
    set({ schemas: { status: 'loading' } })
    await read(
      id,
      () => commands.schemaList(id),
      (schemas) => set({ schemas }),
    )
  }

  const loadRelations = async (id: number, schema: string) => {
    set({ relations: { ...get().relations, [schema]: { status: 'loading' } } })
    await read(
      id,
      () => commands.schemaRelations(id, schema),
      (result) => set({ relations: { ...get().relations, [schema]: result } }),
    )
  }

  const loadDetail = async (id: number, schema: string, name: string) => {
    const key = relationKey(schema, name)
    set({ details: { ...get().details, [key]: { status: 'loading' } } })
    await read(
      id,
      () => commands.schemaRelationDetail(id, schema, name),
      (result) => set({ details: { ...get().details, [key]: result } }),
    )
  }

  const toggle = (key: string): boolean => {
    const expanded = new Set(get().expanded)
    const isOpen = !expanded.delete(key)
    if (isOpen) expanded.add(key)
    set({ expanded })
    return isOpen
  }

  return {
    ...INITIAL,

    connect: async (connectionId) => {
      if (get().isConnecting) return
      await get().disconnect()
      set({ isConnecting: true, error: null })
      try {
        const result = await commands.sessionOpen(connectionId)
        if (result.status === 'error') {
          set({ error: result.error.message })
        } else if (result.data.status === 'failed') {
          const { detail, advice } = result.data.error
          set({ error: `${detail} ${advice}`.trim() })
        } else {
          const { id, database } = result.data.session
          set({ session: { id, connectionId, database } })
          void loadSchemas(id)
        }
      } catch (error) {
        set({ error: toMessage(error) })
      } finally {
        set({ isConnecting: false })
      }
    },

    disconnect: async () => {
      const { session } = get()
      if (!session) return
      set({ session: null, ...EMPTY })
      try {
        await commands.sessionClose(session.id)
      } catch (error) {
        set({ error: toMessage(error) })
      }
    },

    refresh: async () => {
      const { session, expanded, selected } = get()
      if (!session) return
      // The user expects the completion to know the same structure as the tree.
      invalidateCatalog(session.connectionId)
      set({ relations: {}, details: {} })
      const reads: Promise<void>[] = [loadSchemas(session.id)]
      for (const key of expanded) {
        if (key.startsWith('s:')) {
          reads.push(loadRelations(session.id, key.slice(2)))
        } else {
          const [schema, name] = key.slice(2).split('\u0000')
          reads.push(loadDetail(session.id, schema, name))
        }
      }
      await Promise.all(reads)
      if (selected) await get().selectRelation(selected.schema, selected.name)
    },

    toggleSchema: async (schema) => {
      const { session } = get()
      if (!session) return
      if (toggle(schemaKey(schema)) && !get().relations[schema]) {
        await loadRelations(session.id, schema)
      }
    },

    toggleRelation: async (schema, name) => {
      const { session } = get()
      if (!session) return
      const key = relationKey(schema, name)
      if (toggle(key) && !get().details[key]) {
        await loadDetail(session.id, schema, name)
      }
    },

    selectRelation: async (schema, name) => {
      const { session } = get()
      if (!session) return
      set({ selected: { schema, name }, sample: { status: 'loading' } })
      const isSelected = () => {
        const { selected } = get()
        return selected?.schema === schema && selected.name === name
      }
      await loadDetail(session.id, schema, name)
      await read(
        session.id,
        () => commands.schemaSample(session.id, schema, name),
        (sample) => {
          if (isSelected()) set({ sample })
        },
      )
    },

    setFilter: (filter) => set({ filter }),
    reset: () => set(INITIAL),
  }
})

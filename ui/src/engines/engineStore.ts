import { create } from 'zustand'
import {
  commands,
  type Engine,
  type EngineEntry_Serialize,
  type QueryLanguage_Serialize,
} from '../bindings'
import { toMessage } from '../lib/errors'
import { useWorkspaceStore } from '../workspace/workspaceStore'

/** Names of the engines when the list is not loaded, or when a connector is not installed. */
const KNOWN_LABELS: Record<string, string> = {
  postgres: 'PostgreSQL',
  duckdb: 'DuckDB',
  mongodb: 'MongoDB',
}

/** The languages of the known engines, for the same cases. */
const KNOWN_LANGUAGES: Record<string, QueryLanguage_Serialize> = {
  postgres: 'sql',
  duckdb: 'sql',
  mongodb: 'mongodb-shell',
}

const capabilities = (fileDatabase: boolean, unixSocket: boolean) => ({
  cancel: true,
  unixSocket,
  fileDatabase,
  explainPlan: true,
  measuredPlan: true,
})

/**
 * The engines before the first load. They are the same as the list of the backend
 * without installed connectors.
 */
export const DEFAULT_ENGINES: EngineEntry_Serialize[] = [
  {
    info: {
      engine: 'postgres',
      displayName: 'PostgreSQL',
      language: 'sql',
      defaultPort: 5432,
      capabilities: capabilities(false, true),
    },
    source: { type: 'built-in' },
  },
  {
    info: {
      engine: 'duckdb',
      displayName: 'DuckDB',
      language: 'sql',
      defaultPort: null,
      capabilities: capabilities(true, false),
    },
    source: { type: 'built-in' },
  },
  {
    info: {
      engine: 'mongodb',
      displayName: 'MongoDB',
      language: 'mongodb-shell',
      defaultPort: 27017,
      capabilities: { ...capabilities(false, false), explainPlan: true },
    },
    source: { type: 'available' },
  },
]

type EngineState = {
  /** The built-in engines and the installed connectors. */
  engines: EngineEntry_Serialize[]
  error: string | null
  load: () => Promise<void>
}

export const useEngineStore = create<EngineState>((set) => ({
  engines: DEFAULT_ENGINES,
  error: null,
  load: async () => {
    try {
      const result = await commands.engineList()
      if (result.status === 'ok') set({ engines: result.data, error: null })
      else set({ error: result.error.message })
    } catch (error) {
      set({ error: toMessage(error) })
    }
  },
}))

/** Returns the engine `engine`, if the application can use it now. */
export function findEngine(engine: Engine): EngineEntry_Serialize | undefined {
  return useEngineStore
    .getState()
    .engines.find((entry) => entry.info.engine === engine)
}

/** `true` if the engine gives execution plans. */
export function hasPlanView(entry: EngineEntry_Serialize | undefined): boolean {
  return entry?.info.capabilities.explainPlan ?? false
}

/** Returns the name of an engine for the user, for example "MongoDB". */
export function engineLabel(engine: Engine): string {
  return findEngine(engine)?.info.displayName ?? KNOWN_LABELS[engine] ?? engine
}

/**
 * Returns the query language of an engine. The language of an engine that the
 * application does not know is `unknown`: each statement then needs a confirmation.
 */
export function engineLanguage(engine: Engine): QueryLanguage_Serialize {
  return (
    findEngine(engine)?.info.language ?? KNOWN_LANGUAGES[engine] ?? 'unknown'
  )
}

/** Returns the query language of the connection `connectionId`. */
export function connectionLanguage(
  connectionId: string | null | undefined,
): QueryLanguage_Serialize {
  const connection = useWorkspaceStore
    .getState()
    .workspace?.connections.find((item) => item.id === connectionId)
  return engineLanguage(connection?.engine ?? 'postgres')
}

/**
 * Returns the server text, for example "PostgreSQL 17.2". A version text that
 * already starts with the engine name stays as it is, for example "DuckDB v1.2.0".
 */
export function serverLabel(engine: Engine, version: string): string {
  const label = engineLabel(engine)
  return version.startsWith(label) ? version : `${label} ${version}`
}

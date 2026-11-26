import { engineLanguage } from '../engines/engineStore'
import type { QueryLanguage_Serialize as QueryLanguage } from '../bindings'
import { sqlTabOf, useTabsStore } from '../tabs/tabsStore'
import { useWorkspaceStore } from '../workspace/workspaceStore'

/** The tags of a code block that belong to each query language. */
const TAGS: Partial<Record<QueryLanguage, string[]>> = {
  sql: ['sql', 'postgresql', 'postgres', 'pgsql', 'plpgsql', 'duckdb'],
  'mongodb-shell': ['mongodb', 'mongo', 'mongosh', 'javascript', 'js'],
}

/** The languages for which the AI has a guide. */
export const KNOWN_LANGUAGES: QueryLanguage[] = ['sql', 'mongodb-shell']

/**
 * `true` if a code block with `tag` is in `language`. A block without a tag fits,
 * and each block fits a language that has no guide.
 */
export function fitsLanguage(tag: string, language: QueryLanguage): boolean {
  const name = tag.trim().toLowerCase()
  const tags = TAGS[language]
  return name === '' || tags === undefined || tags.includes(name)
}

/** The query language of the SQL tab, from the engine of its connection. */
export function useTabLanguage(): QueryLanguage {
  const connectionId = useTabsStore((state) => sqlTabOf(state)?.connectionId)
  const engine = useWorkspaceStore(
    (state) =>
      state.workspace?.connections.find(
        (connection) => connection.id === connectionId,
      )?.engine,
  )
  return engineLanguage(engine ?? 'postgres')
}

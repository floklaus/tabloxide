import { useEffect, useState } from 'react'
import { commands, type QueryLanguage_Serialize } from '../bindings'
import { connectionLanguage } from '../engines/engineStore'
import { useQuery } from '../query/queryStore'
import { sqlTabIdOf, useTabsStore } from '../tabs/tabsStore'

type Split = {
  sql: string
  language: QueryLanguage_Serialize
  starts: Promise<number[]>
}

/** The start of each statement of the last script of each tab. */
const splits = new Map<string, Split>()

/** Removes the statements that this module remembers. A test calls it. */
export function resetStatementNumbers(): void {
  splits.clear()
}

/** Asks the backend for the start of each statement of `sql`. The backend runs nothing. */
function statementStarts(
  tabId: string,
  sql: string,
  language: QueryLanguage_Serialize,
): Promise<number[]> {
  const found = splits.get(tabId)
  if (found && found.sql === sql && found.language === language) {
    return found.starts
  }
  const starts = Promise.resolve()
    .then(() => commands.queryPreview(sql, { type: 'all' }, language))
    .then((previews) =>
      Array.isArray(previews) ? previews.map((item) => item.range.from) : [],
    )
    .catch(() => [])
  splits.set(tabId, { sql, language, starts })
  return starts
}

/**
 * Returns the number of a statement in the script of the active tab, from 1.
 * The view settings file uses this number. A run of one statement of a script
 * gives the result the index 0, thus the index in the run is not the number.
 *
 * Returns `null` until the backend gave the statements. Returns `fallback` if
 * the backend does not find the statement.
 */
export function useStatementNumber(
  from: number,
  fallback: number,
): number | null {
  const tabId = useTabsStore(sqlTabIdOf)
  const connectionId = useTabsStore(
    (state) =>
      state.tabs.find((tab) => tab.id === sqlTabIdOf(state))?.connectionId ??
      null,
  )
  const sql = useQuery((state) => state.ranSql)
  const [found, setFound] = useState<{ key: string; number: number } | null>(
    null,
  )
  const key = `${tabId}\n${from}\n${sql}`
  useEffect(() => {
    let isCurrent = true
    const language = connectionLanguage(connectionId)
    void statementStarts(tabId ?? '', sql, language).then((starts) => {
      if (!isCurrent) return
      const index = starts.indexOf(from)
      setFound({ key, number: index < 0 ? fallback : index + 1 })
    })
    return () => {
      isCurrent = false
    }
  }, [tabId, connectionId, sql, from, fallback, key])
  return found?.key === key ? found.number : null
}

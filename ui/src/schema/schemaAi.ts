import { onlyCodeBlock } from '../assistant/answerSegments'
import type { ActionRequest, SessionStore } from '../assistant/assistantStore'
import { sqlTabForTools, useTabsStore } from '../tabs/tabsStore'

type Relation = { schema: string; name: string }

/** The request of "Explain the table". The backend reads the structure. */
export function explainTableRequest({ schema, name }: Relation): ActionRequest {
  return {
    task: 'explain-table',
    text: `Explain the table ${schema}.${name}.`,
    context: { type: 'relation', schema, name },
  }
}

/** The request of "Write a starter query". */
export function starterQueryRequest({ schema, name }: Relation): ActionRequest {
  return {
    task: 'starter-query',
    text: `Write a starter query for ${schema}.${name}.`,
    context: { type: 'relation', schema, name },
  }
}

/**
 * Opens a new tab with the query of the answer. The tab has the connection of the
 * SQL tab. The application does not run the query. An answer without exactly one
 * code block opens no tab. The answer stays in the panel.
 */
export function openStarterQuery(
  { name }: Relation,
  session: SessionStore,
): void {
  const { messages, error } = session.getState()
  const answer = messages[messages.length - 1]
  if (error || answer?.role !== 'assistant') return
  const query = onlyCodeBlock(answer.text)
  if (query === null) return
  const source = sqlTabForTools()
  const tabs = useTabsStore.getState()
  const id = tabs.newTab(`${query}\n`, `${name}: starter query`)
  tabs.setConnection(id, source?.connectionId ?? null)
}

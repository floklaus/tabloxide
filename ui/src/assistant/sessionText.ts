import { splitAnswer } from './answerSegments'
import type { AssistantMessage, SchemaInfo } from './assistantSession'

export const EMPTY_HINT =
  'Describe the statement that you need, for example a query, an index, or a change of a table or a collection. Or put the cursor in a statement and select Analyze plan.'

export const PRIVACY_TEXT =
  'Each request sends the conversation and the structure of the connected database to Anthropic. It does not send rows, passwords, or connection settings. The application does not run the SQL of an answer.'

export function schemaText(schema: SchemaInfo | null): string {
  if (!schema) return 'The tab has no connection. The request has no schema.'
  const { relations, detailed } = schema
  if (detailed < relations) {
    return `The request has the columns of ${detailed} of ${relations} tables and views. For the others, it has only the name.`
  }
  return `The request has the structure of ${relations} tables and views.`
}

/** Returns the complete code blocks of the last answer. */
export function proposedBlocks(messages: AssistantMessage[]): string[] {
  const last = messages[messages.length - 1]
  if (last?.role !== 'assistant') return []
  return splitAnswer(last.text).flatMap((segment) =>
    segment.type === 'code' && segment.isComplete ? [segment.code] : [],
  )
}

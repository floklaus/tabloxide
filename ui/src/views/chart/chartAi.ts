import { onlyCodeBlock } from '../../assistant/answerSegments'
import type {
  ActionRequest,
  SessionStore,
} from '../../assistant/assistantStore'
import type { Column } from '../../results/gridModel'
import {
  incompleteReason,
  missingColumns,
  parseChartSettings,
  type ChartSettings,
} from './chartSettings'

/** The request text when the user gives no question. */
const DEFAULT_QUESTION = 'Propose the most useful chart for this result.'

/**
 * Makes the request of "Propose a chart". It sends the names, the kinds, and the
 * type names of the columns, and the question of the user. It sends no rows.
 */
export function proposeChartRequest(
  columns: Column[],
  question: string,
): ActionRequest {
  return {
    task: 'chart',
    text: question.trim() === '' ? DEFAULT_QUESTION : question.trim(),
    context: {
      type: 'result-columns',
      columns: columns.map(({ name, type_name, kind }) => ({
        name,
        type_name,
        kind,
      })),
    },
  }
}

/**
 * Reads the chart settings from the answer of the AI and checks them against
 * the columns of the result. The application uses only settings that pass each
 * check. Returns the reason as a sentence if a check fails.
 */
export function chartOfAnswer(
  answer: string,
  columns: Column[],
): { settings: ChartSettings } | { error: string } {
  const code = onlyCodeBlock(answer)
  if (code === null) {
    return { error: 'The answer has no chart settings in one code block.' }
  }
  let value: unknown
  try {
    value = JSON.parse(code)
  } catch {
    return { error: 'The chart settings of the answer are not valid JSON.' }
  }
  const parsed = parseChartSettings(value)
  if ('error' in parsed) return parsed
  const missing = missingColumns(parsed.settings, columns)
  if (missing.length > 0) {
    return {
      error:
        missing.length === 1
          ? `The answer uses the column ${missing[0]}. The result does not have this column.`
          : `The answer uses these columns: ${missing.join(', ')}. The result does not have them.`,
    }
  }
  const reason = incompleteReason(parsed.settings)
  if (reason !== null) {
    return {
      error: `The chart settings of the answer are not complete. ${reason}`,
    }
  }
  return parsed
}

/** Reads the chart settings from the last answer of a session. */
export function chartOfSession(
  session: SessionStore,
  columns: Column[],
): { settings: ChartSettings } | { error: string } {
  const { messages, error } = session.getState()
  const answer = messages[messages.length - 1]
  if (error || answer?.role !== 'assistant') {
    return { error: 'The AI gave no answer.' }
  }
  return chartOfAnswer(answer.text, columns)
}

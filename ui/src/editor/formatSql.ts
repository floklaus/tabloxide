import { format } from 'sql-formatter'
import type { Engine } from '../bindings'

/** The SQL dialect of the formatter for each database engine. */
const LANGUAGES: Record<Engine, 'postgresql' | 'duckdb'> = {
  postgres: 'postgresql',
  duckdb: 'duckdb',
}

export type FormatResult =
  { ok: true; text: string } | { ok: false; message: string }

/**
 * Formats SQL text. The keywords keep the case that the user typed.
 * A statement that the formatter cannot read gives a message and no text.
 */
export function formatSql(
  text: string,
  engine: Engine,
  tabWidth: number,
): FormatResult {
  try {
    const formatted = format(text, {
      language: LANGUAGES[engine],
      tabWidth,
      keywordCase: 'preserve',
      linesBetweenQueries: 1,
    })
    // Keep one line feed at the end if the text had one.
    const end = /\n$/.test(text) && !formatted.endsWith('\n') ? '\n' : ''
    return { ok: true, text: formatted + end }
  } catch (error) {
    const reason = error instanceof Error ? error.message.split('\n')[0] : ''
    return {
      ok: false,
      message: `The formatter cannot read this SQL. ${reason}`.trim(),
    }
  }
}

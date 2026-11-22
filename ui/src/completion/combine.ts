import type {
  CompletionContext,
  CompletionResult,
} from '@codemirror/autocomplete'

type Source = (context: CompletionContext) => Promise<CompletionResult | null>

/**
 * Joins the options of more than one completion source. The result uses the start
 * of the first result. A result with a different start is not in the list.
 */
export function combineSources(...sources: Source[]): Source {
  return async (context) => {
    const results = (
      await Promise.all(sources.map((source) => source(context)))
    ).filter((result) => result !== null)
    if (results.length === 0) return null
    const [first] = results
    const fitting = results.filter((result) => result.from === first.from)
    return {
      from: first.from,
      options: fitting.flatMap((result) => result.options),
      validFor: fitting.length === 1 ? first.validFor : /^"?[\w$-]*$/,
    }
  }
}

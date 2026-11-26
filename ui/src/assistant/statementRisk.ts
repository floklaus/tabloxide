import { useEffect, useState } from 'react'
import {
  commands,
  type QueryLanguage_Serialize as QueryLanguage,
} from '../bindings'
import { riskLabel } from '../query/riskLabels'

/**
 * Returns the risks of the statements of `code`, from the classifier of `language`,
 * as one text. Returns `null` if no statement has a risk.
 */
export async function statementRisk(
  code: string,
  language: QueryLanguage,
): Promise<string | null> {
  const previews = await commands.queryPreview(code, { type: 'all' }, language)
  const labels = [
    ...new Set(
      previews.flatMap((preview) =>
        preview.risk ? [riskLabel(preview.risk, language)] : [],
      ),
    ),
  ]
  return labels.length > 0 ? `Before you run it: ${labels.join('. ')}.` : null
}

/** The risk text of `code`, or `null`. It is `null` while `isEnabled` is `false`. */
export function useStatementRisk(
  code: string,
  language: QueryLanguage,
  isEnabled: boolean,
): string | null {
  const [risk, setRisk] = useState<string | null>(null)
  useEffect(() => {
    if (!isEnabled) return
    let isCurrent = true
    statementRisk(code, language)
      .then((text) => {
        if (isCurrent) setRisk(text)
      })
      // Without the check, the block shows no risk. The run confirmation checks again.
      .catch(() => {})
    return () => {
      isCurrent = false
    }
  }, [code, language, isEnabled])
  return isEnabled ? risk : null
}

import { create } from 'zustand'
import { commands, type PlanBlock } from '../bindings'
import { activeEditor } from '../editor/editorBridge'
import { connectionLanguage } from '../engines/engineStore'
import { sqlTabForTools } from '../tabs/tabsStore'
import { useWorkspaceStore } from '../workspace/workspaceStore'

/** The statement that the plan actions use, and the actions that it permits. */
export type PlanTarget = {
  /** The one statement at the cursor, or the selected statements. */
  statement: string
  /** Why Explain is not available, or `null`. */
  explain: PlanBlock | null
  /** Why Explain and measure is not available, or `null`. */
  measure: PlanBlock | null
}

const EMPTY: PlanTarget = { statement: '', explain: null, measure: null }

export const usePlanTarget = create<PlanTarget>(() => EMPTY)

/** The one statement at the cursor, or the selected statements, of the tab. */
export async function targetStatement(content: string): Promise<string> {
  const target = activeEditor()?.getTarget() ?? { type: 'all' as const }
  const language = connectionLanguage(sqlTabForTools()?.connectionId)
  const previews = await commands.queryPreview(content, target, language)
  const first = previews[0]
  const last = previews[previews.length - 1]
  return first ? content.slice(first.range.from, last.range.to) : ''
}

let latest = 0

/**
 * Finds the statement at the cursor and checks it for the plan actions. The editor
 * calls this after each change of the text or of the cursor. Nothing goes to the
 * database.
 */
export async function refreshPlanTarget(): Promise<void> {
  const call = ++latest
  const tab = sqlTabForTools()
  const connection = useWorkspaceStore
    .getState()
    .workspace?.connections.find((item) => item.id === tab?.connectionId)
  if (!tab || !connection) {
    usePlanTarget.setState(EMPTY)
    return
  }
  try {
    const statement = await targetStatement(tab.content)
    const check = await commands.planCheck(
      statement,
      connection.engine ?? 'postgres',
    )
    if (call !== latest) return
    usePlanTarget.setState({
      statement,
      explain: check.explain,
      measure: check.measure,
    })
  } catch {
    // Without the check, the actions stay available. The plan read checks again.
    if (call === latest) usePlanTarget.setState(EMPTY)
  }
}

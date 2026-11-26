import { connectionLanguage } from '../engines/engineStore'
import { create } from 'zustand'
import { commands, type Engine } from '../bindings'
import { activeEditor } from '../editor/editorBridge'
import { toMessage } from '../lib/errors'
import { getQueryStore } from '../query/queryStore'
import { useResultsViewStore } from '../results/resultsViewStore'
import { sqlTabForTools } from '../tabs/tabsStore'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { parsePlan, type Plan } from './planModel'

export type PlanState = {
  status: 'idle' | 'reading' | 'done' | 'failed'
  plan: Plan | null
  /** The statement that the database explained. */
  statement: string | null
  error: string | null
  /** Reads the plan of the statement at the cursor, or of the selection. */
  read: (analyze: boolean) => Promise<void>
  reset: () => void
}

const INITIAL = {
  status: 'idle' as const,
  plan: null,
  statement: null,
  error: null,
}

/** The one statement at the cursor, or the selected statements. */
async function targetStatement(content: string): Promise<string> {
  const target = activeEditor()?.getTarget() ?? { type: 'all' as const }
  const language = connectionLanguage(sqlTabForTools()?.connectionId)
  const previews = await commands.queryPreview(content, target, language)
  const first = previews[0]
  const last = previews[previews.length - 1]
  return first ? content.slice(first.range.from, last.range.to) : ''
}

export const usePlanStore = create<PlanState>((set, get) => ({
  ...INITIAL,

  read: async (analyze) => {
    if (get().status === 'reading') return
    const tab = sqlTabForTools()
    const connection = useWorkspaceStore
      .getState()
      .workspace?.connections.find((item) => item.id === tab?.connectionId)
    useResultsViewStore.getState().setView('plan')
    if (!tab || !connection) {
      set({ ...INITIAL, status: 'failed', error: 'Select a connection first.' })
      return
    }
    const engine: Engine = connection.engine ?? 'postgres'
    set({ ...INITIAL, status: 'reading' })
    try {
      const statement = await targetStatement(tab.content)
      const query = getQueryStore(tab.id)
      if (!query.getState().session)
        await query.getState().connect(connection.id)
      const session = query.getState().session
      if (!session) {
        set({ status: 'failed', error: 'The connection failed.' })
        return
      }
      // The plan read uses the session of the tab and closes its open result.
      if (query.getState().open)
        query.setState({ open: null, stopReason: 'plan' })
      const result = await commands.planRead(session.id, statement, analyze)
      if (result.status === 'error') {
        set({ status: 'failed', error: result.error.message })
      } else if (result.data.status === 'rejected') {
        set({ status: 'failed', error: result.data.message })
      } else if (result.data.status === 'failed') {
        set({ status: 'failed', error: result.data.error.message })
      } else {
        set({
          status: 'done',
          plan: parsePlan(engine, result.data.json),
          statement,
        })
      }
    } catch (error) {
      set({ status: 'failed', error: toMessage(error) })
    }
  },

  reset: () => set(INITIAL),
}))

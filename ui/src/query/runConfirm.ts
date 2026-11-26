import { engineLanguage } from '../engines/engineStore'
import { create } from 'zustand'
import {
  commands,
  type Environment,
  type Risk,
  type RunTarget,
  type StatementPreview_Serialize,
} from '../bindings'
import { toMessage } from '../lib/errors'
import { usePreferencesStore } from '../preferences/preferencesStore'
import { sqlTabForTools } from '../tabs/tabsStore'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { activeQueryStore } from './queryStore'

const PREVIEW_LENGTH = 80

const RISK_LABELS: Record<Risk, string> = {
  drop: 'DROP removes an object',
  truncate: 'TRUNCATE removes all rows',
  alter: 'ALTER changes the structure',
  'delete-without-where': 'DELETE without WHERE removes all rows',
  'update-without-where': 'UPDATE without WHERE changes all rows',
  'write-file': 'The statement writes files on the disk',
  'load-extension': 'The statement adds program code to the database engine',
  overwrite: 'The statement replaces or changes the documents of a collection',
  unchecked: 'The application cannot check this statement',
}

export type RiskyStatement = { text: string; reason: string }

export type PendingRun = {
  sql: string
  target: RunTarget
  connectionId: string
  connectionName: string
  environment: Environment
  /** `true` if the rule of the environment asks before each run. */
  asksAlways: boolean
  risky: RiskyStatement[]
}

type RunConfirmState = {
  /** The run that waits for the confirmation of the user. */
  pending: PendingRun | null
  confirm: () => void
  cancel: () => void
}

function start(run: Pick<PendingRun, 'sql' | 'target' | 'connectionId'>) {
  void activeQueryStore().getState().run(run.sql, run.target, run.connectionId)
}

export const useRunConfirmStore = create<RunConfirmState>((set, get) => ({
  pending: null,
  confirm: () => {
    const { pending } = get()
    set({ pending: null })
    if (pending) start(pending)
  },
  cancel: () => set({ pending: null }),
}))

function toRisky(
  sql: string,
  previews: StatementPreview_Serialize[],
): RiskyStatement[] {
  return previews.flatMap((preview) => {
    if (!preview.risk) return []
    const text = sql
      .slice(preview.range.from, preview.range.to)
      .replace(/\s+/g, ' ')
    const short =
      text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text
    return [{ text: short, reason: RISK_LABELS[preview.risk] }]
  })
}

/**
 * Runs `sql` in the active tab. The preferences have a confirmation rule for each
 * environment. The rule of the environment of the connection decides if the
 * application asks first: never, before a risky statement, or before each run.
 */
export async function requestRun(
  sql: string,
  target: RunTarget,
): Promise<void> {
  const tab = sqlTabForTools()
  const connections = useWorkspaceStore.getState().workspace?.connections ?? []
  const connection = connections.find((item) => item.id === tab?.connectionId)
  if (!connection) return
  const run = { sql, target, connectionId: connection.id }
  const { guardrails } = usePreferencesStore.getState().preferences
  const rule = guardrails[connection.environment]
  if (rule === 'never') {
    start(run)
    return
  }
  let previews: StatementPreview_Serialize[]
  try {
    previews = await commands.queryPreview(
      sql,
      target,
      engineLanguage(connection.engine ?? 'postgres'),
    )
  } catch (error) {
    // Without the preview, the application cannot know the risk. It does not run.
    activeQueryStore().getState().setNotice(toMessage(error))
    return
  }
  const risky = toRisky(sql, previews)
  const asksAlways = rule === 'always' && previews.length > 0
  if (risky.length === 0 && !asksAlways) {
    start(run)
    return
  }
  useRunConfirmStore.setState({
    pending: {
      ...run,
      connectionName: connection.name,
      environment: connection.environment,
      asksAlways,
      risky,
    },
  })
}

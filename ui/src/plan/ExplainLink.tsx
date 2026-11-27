import { findEngine, hasPlanView } from '../engines/engineStore'
import { usePreferencesStore } from '../preferences/preferencesStore'
import { sqlTabForTools } from '../tabs/tabsStore'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { usePlanStore } from './planStore'

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}

/** `true` if the engine of the connection of the SQL tab gives plans. */
function hasPlans(): boolean {
  const connectionId = sqlTabForTools()?.connectionId
  const connection = useWorkspaceStore
    .getState()
    .workspace?.connections.find((item) => item.id === connectionId)
  return (
    connection !== undefined &&
    hasPlanView(findEngine(connection.engine ?? 'postgres'))
  )
}

/**
 * The link "Explain" in the status line of a result. It reads the plan of the
 * statement of the result, not of the statement at the cursor. After a slow
 * statement, the link asks "Took 3.2 s. Explain the statement?".
 */
export function ExplainLink({
  statement,
  elapsedMs,
}: {
  statement: string
  elapsedMs: number
}) {
  const slowMs = usePreferencesStore((state) => state.preferences.slow_query_ms)
  const isReading = usePlanStore((state) => state.status === 'reading')
  if (statement.trim() === '' || !hasPlans()) return null
  const isSlow = elapsedMs >= slowMs
  return (
    <span
      className={isSlow ? 'explain-link explain-link--slow' : 'explain-link'}
    >
      {isSlow && <span>Took {seconds(elapsedMs)}.</span>}
      <button
        type="button"
        className="link-button"
        disabled={isReading}
        title="Reads the plan of this statement. The statement does not run."
        onClick={() => void usePlanStore.getState().explain(statement, false)}
      >
        {isSlow ? 'Explain the statement?' : 'Explain'}
      </button>
    </span>
  )
}

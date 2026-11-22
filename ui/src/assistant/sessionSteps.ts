import type { AssistantStatus, SessionState } from './assistantSession'
import { PHASES } from './assistantSession'

export type StepState = 'done' | 'active' | 'failed' | 'pending'

export type Step = { phase: AssistantStatus; label: string; state: StepState }

const STEP_LABELS: Partial<Record<AssistantStatus, string>> = {
  'reading-plan': 'Read the statement and its plan',
  'reading-schema': 'Read the structure of the database',
  waiting: 'Send the request and wait for the answer',
  answering: 'Write the answer',
}

/**
 * Returns the steps of the last request. A step is done if the request got to a
 * later step. A request can skip the structure read, because the backend keeps the
 * structure of the last request.
 */
export function stepsOf(
  state: Pick<SessionState, 'lastTask' | 'phases' | 'status' | 'outcome'>,
): Step[] {
  if (!state.lastTask) return []
  const phases = PHASES[state.lastTask]
  const reached = phases.filter((phase) => state.phases.includes(phase))
  const last = reached[reached.length - 1]
  const lastIndex = last === undefined ? -1 : phases.indexOf(last)
  return phases.map((phase, index) => {
    const label = STEP_LABELS[phase] ?? phase
    if (state.outcome === 'done') return { phase, label, state: 'done' }
    if (index < lastIndex) return { phase, label, state: 'done' }
    if (index === lastIndex) {
      if (state.status === phase) return { phase, label, state: 'active' }
      if (state.outcome === 'failed' || state.outcome === 'stopped') {
        return { phase, label, state: 'failed' }
      }
      return { phase, label, state: 'done' }
    }
    return { phase, label, state: 'pending' }
  })
}

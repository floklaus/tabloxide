import { relativeTime } from '../lib/relativeTime'
import type { Status } from '../view/StatusMark'
import type { SessionState } from './assistantSession'
import { labelOf, type SessionLabel } from './assistantStore'

export const LABEL_TEXT: Record<SessionLabel, string> = {
  running: 'Running',
  waiting: 'Waiting for you',
  done: 'Done',
  stopped: 'Stopped',
  failed: 'Failed',
  new: 'New',
}

export const DEFAULT_TITLE = 'New conversation'

/** The line under the title of a session, for example "Done · 5 minutes ago". */
export function sessionDetail(state: SessionState, now: number): string {
  const label = labelOf(state)
  if (label === 'new' || label === 'waiting') return LABEL_TEXT[label]
  return `${LABEL_TEXT[label]} · ${relativeTime(state.updatedAt / 1000, now / 1000)}`
}

/** The status mark of each state of a session (view standards, part 1). */
export const LABEL_STATUS: Record<SessionLabel, Status> = {
  running: 'busy',
  waiting: 'warning',
  done: 'ok',
  stopped: 'neutral',
  failed: 'error',
  new: 'neutral',
}

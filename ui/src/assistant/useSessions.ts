import { useMemo, useSyncExternalStore } from 'react'
import { useAssistantStore } from './assistantStore'

function subscribeAll(onChange: () => void): () => void {
  let stops: (() => void)[] = []
  const watchSessions = () => {
    for (const stop of stops) stop()
    stops = useAssistantStore
      .getState()
      .sessions.map((entry) => entry.store.subscribe(onChange))
  }
  watchSessions()
  const stopRegistry = useAssistantStore.subscribe(() => {
    watchSessions()
    onChange()
  })
  return () => {
    stopRegistry()
    for (const stop of stops) stop()
  }
}

function runningCount(): number {
  return useAssistantStore
    .getState()
    .sessions.filter((entry) => entry.store.getState().status !== 'idle').length
}

/** The number of assistant sessions with a request in progress. */
export function useRunningSessions(): number {
  return useSyncExternalStore(subscribeAll, runningCount)
}

const SEPARATOR = '\u0000'

/** The titles of all sessions as one text. A text is stable for the store snapshot. */
function titlesText(): string {
  return useAssistantStore
    .getState()
    .sessions.map((entry) => entry.store.getState().title ?? '')
    .join(SEPARATOR)
}

/** The title of each session, in the sequence of the sessions. `''` for no title. */
export function useSessionTitles(): string[] {
  const text = useSyncExternalStore(subscribeAll, titlesText)
  return useMemo(() => text.split(SEPARATOR), [text])
}

import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { SessionState, SessionStore } from './assistantSession'

/** The session that the assistant parts below the provider show. */
export const SessionContext = createContext<SessionStore | null>(null)

/** Returns the store of the session of the context. */
export function useSessionStore(): SessionStore {
  const store = useContext(SessionContext)
  if (!store)
    throw new Error('An assistant part needs a SessionContext provider.')
  return store
}

/** Selects a value from the session of the context. */
export function useSession<T>(selector: (state: SessionState) => T): T {
  return useStore(useSessionStore(), selector)
}

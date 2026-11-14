import { useEffect, useState } from 'react'
import { commands, type AppInfo } from '../bindings'

export type AppInfoState =
  | { status: 'loading' }
  | { status: 'ready'; info: AppInfo }
  | { status: 'error'; message: string }

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Gets the application name and version from the backend. */
export function useAppInfo(): AppInfoState {
  const [state, setState] = useState<AppInfoState>({ status: 'loading' })

  useEffect(() => {
    let isActive = true

    commands
      .appInfo()
      .then((info) => {
        if (isActive) setState({ status: 'ready', info })
      })
      .catch((error: unknown) => {
        if (isActive) setState({ status: 'error', message: toMessage(error) })
      })

    return () => {
      isActive = false
    }
  }, [])

  return state
}

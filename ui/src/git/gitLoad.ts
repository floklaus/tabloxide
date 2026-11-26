import { useEffect, useRef, useState } from 'react'
import type { CommandError } from '../bindings'
import { toMessage } from '../lib/errors'

export type CommandResult<T> =
  { status: 'ok'; data: T } | { status: 'error'; error: CommandError }

export type Load<T> =
  | { status: 'loading' }
  | { status: 'loaded'; data: T }
  | { status: 'failed'; message: string }

/** Converts the answer of a command to a load state. */
export async function toLoad<T>(
  command: () => Promise<CommandResult<T>>,
): Promise<Load<T>> {
  try {
    const result = await command()
    return result.status === 'ok'
      ? { status: 'loaded', data: result.data }
      : { status: 'failed', message: result.error.message }
  } catch (error) {
    return { status: 'failed', message: toMessage(error) }
  }
}

const LOADING = { status: 'loading' } as const

/**
 * Runs `command` when `key` changes and gives its load state. The last data stays
 * until the next answer comes, so a new read does not make the content flash. A
 * late answer of an older key does not replace the data.
 */
export function useLoad<T>(
  key: string,
  command: () => Promise<CommandResult<T>>,
): Load<T> {
  const [load, setLoad] = useState<Load<T>>(LOADING)
  const latest = useRef(command)
  useEffect(() => {
    latest.current = command
  })
  useEffect(() => {
    let isCurrent = true
    void toLoad(latest.current).then((next) => {
      if (isCurrent) setLoad(next)
    })
    return () => {
      isCurrent = false
    }
  }, [key])
  return load
}

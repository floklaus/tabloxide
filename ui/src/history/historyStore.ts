import { create } from 'zustand'
import {
  commands,
  type HistoryEntry_Serialize,
  type HistoryStatus,
} from '../bindings'
import { toMessage } from '../lib/errors'
import { requestRun } from '../query/runConfirm'
import { sqlTabForTools, useTabsStore } from '../tabs/tabsStore'
import type { Status } from '../view/StatusMark'

export type HistoryEntry = HistoryEntry_Serialize

/** Prefix of an entry that has no statement text. The backend writes it. */
export const NOT_RECORDED_PREFIX = '-- Not recorded'

/** The result states that the filter menu can show. */
export type ResultFilter = 'all' | HistoryStatus

type HistoryState = {
  query: string
  /** The connection of the scope, or `null` for all connections. */
  connectionId: string | null
  results: ResultFilter
  entries: HistoryEntry[]
  isLoading: boolean
  error: string | null
  setQuery: (query: string) => void
  setConnection: (connectionId: string | null) => void
  setResults: (results: ResultFilter) => void
  /** Reads the entries that contain the search text. */
  search: () => Promise<void>
  clear: () => Promise<void>
  reset: () => void
}

const INITIAL = {
  query: '',
  connectionId: null,
  results: 'all' as ResultFilter,
  entries: [] as HistoryEntry[],
  isLoading: false,
  error: null,
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  ...INITIAL,

  setQuery: (query) => set({ query }),
  setConnection: (connectionId) => set({ connectionId }),
  setResults: (results) => set({ results }),

  search: async () => {
    const text = get().query
    set({ isLoading: true })
    try {
      const result = await commands.historySearch(text)
      // A newer search text makes this answer old.
      if (get().query !== text) return
      if (result.status === 'ok') set({ entries: result.data, error: null })
      else set({ error: result.error.message })
    } catch (error) {
      set({ error: toMessage(error) })
    } finally {
      set({ isLoading: false })
    }
  },

  clear: async () => {
    try {
      const result = await commands.historyClear()
      if (result.status === 'error') set({ error: result.error.message })
    } catch (error) {
      set({ error: toMessage(error) })
    }
    await get().search()
  },

  reset: () => set(INITIAL),
}))

/** The entries of the scope and of the result filter. */
export function visibleEntries(state: HistoryState): HistoryEntry[] {
  return state.entries.filter(
    (entry) =>
      (state.connectionId === null ||
        entry.connection_id === state.connectionId) &&
      (state.results === 'all' || entry.status === state.results),
  )
}

/** `true` if the entry has the text of its statement. */
export function hasText(entry: HistoryEntry): boolean {
  return !entry.sql.startsWith(NOT_RECORDED_PREFIX)
}

/** Opens the statement of an entry in a new tab, with its connection. */
export function openInTab(entry: HistoryEntry): void {
  const tabs = useTabsStore.getState()
  const id = tabs.newTab(entry.sql)
  tabs.setConnection(id, entry.connection_id)
}

/** Runs the statement of an entry again in the SQL tab. */
export function runAgain(entry: HistoryEntry): void {
  const tab = sqlTabForTools()
  if (tab && !tab.connectionId) {
    useTabsStore.getState().setConnection(tab.id, entry.connection_id)
  }
  void requestRun(entry.sql, { type: 'all' })
}

const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' })

/** The name of the day of a time: Today, Yesterday, or the date. */
export function dayName(seconds: number, now = new Date()): string {
  const day = new Date(seconds * 1000)
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfDay = new Date(day.getFullYear(), day.getMonth(), day.getDate())
  const days = Math.round((start.getTime() - startOfDay.getTime()) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return dayFormat.format(day)
}

export function timeText(seconds: number): string {
  return timeFormat.format(seconds * 1000)
}

export function durationText(entry: HistoryEntry): string {
  return entry.elapsed_ms < 1000
    ? `${entry.elapsed_ms} ms`
    : `${(entry.elapsed_ms / 1000).toFixed(2)} s`
}

/** The entries in groups by day. The newest group is first. */
export function groupByDay(
  entries: HistoryEntry[],
  now = new Date(),
): { day: string; entries: HistoryEntry[] }[] {
  const groups: { day: string; entries: HistoryEntry[] }[] = []
  for (const entry of entries) {
    const day = dayName(entry.executed_at_secs, now)
    const last = groups[groups.length - 1]
    if (last?.day === day) last.entries.push(entry)
    else groups.push({ day, entries: [entry] })
  }
  return groups
}

export const HISTORY_STATUS: Record<
  HistoryStatus,
  { status: Status; label: string }
> = {
  ok: { status: 'ok', label: 'Succeeded' },
  failed: { status: 'error', label: 'Failed' },
  cancelled: { status: 'neutral', label: 'Cancelled' },
}

/** Shows an entry in a detail tab of the editor area. */
export function showEntry(entry: HistoryEntry, keep: boolean): void {
  useTabsStore
    .getState()
    .openDetail(
      { kind: 'history', id: entry.id },
      `History ${timeText(entry.executed_at_secs)}`,
      keep,
    )
}

/** One entry of the command palette. */
export type PaletteEntry = {
  id: string
  group: PaletteGroup
  label: string
  /** A second text, for example the folder of a file or the kind of a table. */
  detail?: string
  shortcut?: string
  run: () => void
}

export type PaletteGroup = 'Commands' | 'Files' | 'Schema objects' | 'Settings'

/** The sequence of the groups in the list. */
export const GROUPS: PaletteGroup[] = [
  'Commands',
  'Files',
  'Schema objects',
  'Settings',
]

export type PaletteQuery = {
  /** `>` limits the search to commands, `@` to schema objects. */
  scope: 'all' | 'commands' | 'schema'
  words: string[]
}

/** The largest number of entries of one group in the list. */
export const MAX_PER_GROUP = 12

export function parseQuery(text: string): PaletteQuery {
  const trimmed = text.trimStart()
  const scope = trimmed.startsWith('>')
    ? 'commands'
    : trimmed.startsWith('@')
      ? 'schema'
      : 'all'
  const rest = scope === 'all' ? trimmed : trimmed.slice(1)
  return { scope, words: rest.toLowerCase().split(/\s+/).filter(Boolean) }
}

function inScope(group: PaletteGroup, scope: PaletteQuery['scope']): boolean {
  if (scope === 'commands') return group === 'Commands' || group === 'Settings'
  if (scope === 'schema') return group === 'Schema objects'
  return true
}

/** A smaller score is a better match. `null` means no match. */
function score(entry: PaletteEntry, words: string[]): number | null {
  const label = entry.label.toLowerCase()
  const text = `${label} ${entry.detail?.toLowerCase() ?? ''}`
  if (!words.every((word) => text.includes(word))) return null
  if (words.length === 0) return 0
  const first = words[0]
  if (label.startsWith(first)) return 0
  if (label.split(/[\s./_-]+/).some((part) => part.startsWith(first))) return 1
  return 2
}

/**
 * Returns the entries that contain each word of the query, in the sequence of the
 * groups. In each group, an entry that starts with the first word is first.
 */
export function search(entries: PaletteEntry[], text: string): PaletteEntry[] {
  const query = parseQuery(text)
  return GROUPS.flatMap((group) =>
    entries
      .filter((entry) => entry.group === group && inScope(group, query.scope))
      .map((entry) => ({ entry, score: score(entry, query.words) }))
      .filter(
        (item): item is { entry: PaletteEntry; score: number } =>
          item.score !== null,
      )
      .sort((a, b) => a.score - b.score)
      .slice(0, MAX_PER_GROUP)
      .map((item) => item.entry),
  )
}

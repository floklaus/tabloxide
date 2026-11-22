const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/**
 * Writes the time since `seconds` (seconds since 1970) in words, for example
 * "2 hours ago", "yesterday", or "last week".
 */
export function relativeTime(seconds: number, now = Date.now() / 1000): string {
  const elapsed = Math.max(0, now - seconds)
  for (const [unit, size] of UNITS) {
    if (elapsed >= size) return format.format(-Math.floor(elapsed / size), unit)
  }
  return 'just now'
}

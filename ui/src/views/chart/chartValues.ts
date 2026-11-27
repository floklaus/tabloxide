/** The conversion of the cells of a result, which are text, to the values of a chart. */

const numberFormat = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 6,
})

export function formatNumber(value: number): string {
  return numberFormat.format(value)
}

/** Converts the text of a cell to a number. Returns `null` if the text is not a finite number. */
export function toNumber(text: string): number | null {
  if (text.trim() === '') return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

const TEMPORAL =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i
const MS_PER_MINUTE = 60_000
const MINUTES_PER_HOUR = 60
const MS_DIGITS = 3

export type Moment = {
  /** The date and the time as written, in milliseconds since 1970 as if they were UTC. */
  wall: number
  /** The offset from UTC in minutes. `null` if the text has no offset. */
  offset: number | null
}

function offsetMinutes(text: string | undefined): number | null {
  if (text === undefined) return null
  if (text.toUpperCase() === 'Z') return 0
  const sign = text.startsWith('-') ? -1 : 1
  const digits = text.slice(1).replace(':', '')
  const hours = Number(digits.slice(0, 2))
  const minutes = Number(digits.slice(2, 4) || '0')
  return sign * (hours * MINUTES_PER_HOUR + minutes)
}

/**
 * Reads a date or a date with a time, as PostgreSQL, MySQL, DuckDB, and MongoDB
 * write them. Returns `null` for other text, for example a time without a date.
 */
export function parseMoment(text: string): Moment | null {
  const match = TEMPORAL.exec(text.trim())
  if (!match) return null
  const [, year, month, day, hour, minute, second, fraction, offset] = match
  const ms = fraction
    ? Number(fraction.slice(0, MS_DIGITS).padEnd(MS_DIGITS, '0'))
    : 0
  const wall = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour ?? 0),
    Number(minute ?? 0),
    Number(second ?? 0),
    ms,
  )
  return Number.isNaN(wall) ? null : { wall, offset: offsetMinutes(offset) }
}

/**
 * Converts the moments of a column to positions on a time axis.
 *
 * The axis shows the times as the grid shows them. The offset of the first value
 * is the offset of the axis. A value with a different offset moves by the
 * difference, thus the sequence of the values is correct, for example across a
 * change to daylight saving time.
 */
export function makeTimeScale(): (moment: Moment) => number {
  let axisOffset: number | null = null
  return (moment) => {
    if (moment.offset === null) return moment.wall
    axisOffset ??= moment.offset
    return moment.wall - (moment.offset - axisOffset) * MS_PER_MINUTE
  }
}

export type TimeBucket = 'hour' | 'day' | 'week' | 'month' | 'year'

const MS_PER_DAY = 86_400_000
/** `Date.getUTCDay` gives 0 for Sunday. A week starts on Monday (ISO 8601). */
const DAYS_SINCE_MONDAY = [6, 0, 1, 2, 3, 4, 5]

/**
 * Returns the start of the hour, the day, the week, the month, or the year of a
 * position on the time axis. A week starts on Monday.
 */
export function floorToUnit(position: number, unit: TimeBucket): number {
  const date = new Date(position)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  const day = date.getUTCDate()
  switch (unit) {
    case 'hour':
      return Date.UTC(year, month, day, date.getUTCHours())
    case 'day':
      return Date.UTC(year, month, day)
    case 'week':
      return (
        Date.UTC(year, month, day) -
        DAYS_SINCE_MONDAY[date.getUTCDay()] * MS_PER_DAY
      )
    case 'month':
      return Date.UTC(year, month, 1)
    case 'year':
      return Date.UTC(year, 0, 1)
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** The name of a bucket as a category, for example `2026-11` for a month. A week has the date of its Monday. */
export function bucketLabel(start: number, unit: TimeBucket): string {
  const date = new Date(start)
  const year = String(date.getUTCFullYear())
  if (unit === 'year') return year
  const month = `${year}-${pad(date.getUTCMonth() + 1)}`
  if (unit === 'month') return month
  const day = `${month}-${pad(date.getUTCDate())}`
  return unit === 'hour' ? `${day} ${pad(date.getUTCHours())}:00` : day
}

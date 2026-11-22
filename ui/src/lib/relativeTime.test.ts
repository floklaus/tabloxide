import { expect, test } from 'vitest'
import { relativeTime } from './relativeTime'

const NOW = 1_800_000_000
const HOUR = 3600
const DAY = 24 * HOUR

test('writes the time since a moment in words', () => {
  expect(relativeTime(NOW - 20, NOW)).toBe('just now')
  expect(relativeTime(NOW - 5 * 60, NOW)).toBe('5 minutes ago')
  expect(relativeTime(NOW - 2 * HOUR, NOW)).toBe('2 hours ago')
  expect(relativeTime(NOW - DAY - HOUR, NOW)).toBe('yesterday')
  expect(relativeTime(NOW - 3 * DAY, NOW)).toBe('3 days ago')
  expect(relativeTime(NOW - 8 * DAY, NOW)).toBe('last week')
  expect(relativeTime(NOW - 40 * DAY, NOW)).toBe('last month')
  expect(relativeTime(NOW - 800 * DAY, NOW)).toBe('2 years ago')
  // A time in the future, for example after a change of the clock, is now.
  expect(relativeTime(NOW + HOUR, NOW)).toBe('just now')
})

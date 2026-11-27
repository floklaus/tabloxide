import { describe, expect, test } from 'vitest'
import { makeTimeScale, parseMoment, toNumber } from './chartValues'

const HOUR_MS = 3_600_000

describe('toNumber', () => {
  test.each([
    ['42', 42],
    ['-1.5', -1.5],
    ['1e3', 1000],
    [' 7 ', 7],
  ])('reads %j', (text, value) => {
    expect(toNumber(text)).toBe(value)
  })

  test.each(['', '  ', 'abc', '1,234.50', 'NaN', 'Infinity', '$5'])(
    'gives no number for %j',
    (text) => {
      expect(toNumber(text)).toBeNull()
    },
  )
})

describe('parseMoment', () => {
  test('reads a date', () => {
    expect(parseMoment('2026-11-26')).toEqual({
      wall: Date.UTC(2026, 10, 26),
      offset: null,
    })
  })

  test('reads a timestamp of PostgreSQL with an offset in hours', () => {
    expect(parseMoment('2026-11-26 10:30:00.25+01')).toEqual({
      wall: Date.UTC(2026, 10, 26, 10, 30, 0, 250),
      offset: 60,
    })
  })

  test('reads an ISO timestamp with Z', () => {
    expect(parseMoment('2026-11-26T10:30:00.123456Z')).toEqual({
      wall: Date.UTC(2026, 10, 26, 10, 30, 0, 123),
      offset: 0,
    })
  })

  test('reads a negative offset with minutes', () => {
    expect(parseMoment('2026-11-26 10:30:00-03:30')?.offset).toBe(-210)
  })

  test.each(['10:30:00', 'infinity', '26.11.2026', ''])(
    'gives no moment for %j',
    (text) => {
      expect(parseMoment(text)).toBeNull()
    },
  )
})

describe('makeTimeScale', () => {
  test('shows the times as written when all values have the same offset', () => {
    const scale = makeTimeScale()
    const first = parseMoment('2026-11-26 10:00:00+01')!
    const second = parseMoment('2026-11-26 11:00:00+01')!

    expect(scale(first)).toBe(first.wall)
    expect(scale(second)).toBe(second.wall)
  })

  test('keeps the sequence of the values across a change of the offset', () => {
    const scale = makeTimeScale()
    // The clock goes back one hour: 02:30 occurs two times.
    const before = parseMoment('2026-10-25 02:30:00+02')!
    const after = parseMoment('2026-10-25 02:30:00+01')!

    expect(scale(after) - scale(before)).toBe(HOUR_MS)
  })

  test('a value without an offset keeps its time', () => {
    const scale = makeTimeScale()
    const moment = parseMoment('2026-11-26 10:00:00')!

    expect(scale(moment)).toBe(moment.wall)
  })
})

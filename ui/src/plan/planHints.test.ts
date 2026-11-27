import { describe, expect, test } from 'vitest'
import { ESTIMATE_PLAN, MEASURED_PLAN } from '../test/plans'
import { hintsOf } from './planHints'
import { costliest, flatten, fromCommon } from './planModel'

describe('hintsOf', () => {
  test('marks the costly step with its part of the total', () => {
    const plan = fromCommon(ESTIMATE_PLAN)
    const scan = flatten(plan.root)[3]

    const hints = hintsOf(scan, plan, costliest(plan))

    expect(hints[0].level).toBe('info')
    expect(hints[0].text).toMatch(/% of the estimated cost/)
  })

  test('explains a misestimate, then gives the hints of the engine', () => {
    const plan = fromCommon(MEASURED_PLAN)
    const scan = flatten(plan.root)[3]

    const texts = hintsOf(scan, plan, new Set()).map((hint) => hint.text)

    expect(texts[0]).toMatch(/20 times more rows than the planner expected/)
    expect(texts[1]).toBe(
      'Filter removes most rows. An index on the columns of the filter can help.',
    )
  })

  test('a hint of the engine is only for its own step', () => {
    const plan = fromCommon(MEASURED_PLAN)
    const other = flatten(plan.root)[5]

    const texts = hintsOf(other, plan, new Set()).map((hint) => hint.text)

    expect(texts.some((text) => text.startsWith('Filter removes'))).toBe(false)
  })
})

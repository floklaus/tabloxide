import { describe, expect, test } from 'vitest'
import { ESTIMATE_PLAN, MEASURED_PLAN } from '../test/plans'
import { costliest, flatten, fromCommon } from './planModel'

describe('fromCommon', () => {
  test('gives each step its path and its share of the cost', () => {
    const plan = fromCommon(ESTIMATE_PLAN)
    const steps = flatten(plan.root)

    expect(steps.map((node) => node.id)).toEqual([
      '0',
      '0.0',
      '0.0.0',
      '0.0.0.0',
      '0.0.0.1',
      '0.0.0.1.0',
    ])
    const shares = steps.map((node) => node.share ?? 0)
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5)
    expect(steps[3].target).toBe('t')
    expect(steps[3].details).toContainEqual(['Filter', '(id > 5)'])
    expect(steps[3].fieldGroups['Plan Width']).toBe('estimate')
    expect(steps[3].fieldTexts['Filter']).toMatch(/condition/)
    expect(plan.isAnalyzed).toBe(false)
    expect(plan.costUnit).toBe('cost units')
  })

  test('uses the time of a measured plan and marks the misestimates', () => {
    const plan = fromCommon(MEASURED_PLAN)
    const scan = flatten(plan.root)[3]

    expect(plan.isAnalyzed).toBe(true)
    expect(plan.totalTime).toBe(12)
    expect(plan.planningTime).toBe(0.3)
    // 8 ms of 12.7 ms in all steps.
    expect(scan.share).toBeCloseTo(8 / 12.7, 5)
    expect(scan.misestimate).toBe(20)
    expect(plan.totalTexts['JIT']).toMatch(/just-in-time/)
    const hot = costliest(plan, 1)
    expect(flatten(plan.root).find((node) => hot.has(node.id))?.target).toBe(
      't',
    )
  })

  test('a plan without costs and times has no shares', () => {
    const plan = fromCommon({
      ...ESTIMATE_PLAN,
      root: { ...ESTIMATE_PLAN.root, selfCost: null, children: [] },
    })

    expect(plan.root.share).toBeNull()
    expect(costliest(plan).size).toBe(0)
  })
})

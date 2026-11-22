import { describe, expect, test } from 'vitest'
import duckdbAnalyze from './fixtures/duckdb-analyze.json?raw'
import duckdbExplain from './fixtures/duckdb-explain.json?raw'
import postgresAnalyze from './fixtures/postgres-analyze.json?raw'
import postgresExplain from './fixtures/postgres-explain.json?raw'
import { costliest, flatten, parsePlan } from './planModel'

const operations = (text: string, engine: 'postgres' | 'duckdb') =>
  flatten(parsePlan(engine, text).root).map((node) => node.operation)

describe('parsePlan for PostgreSQL', () => {
  test('reads the steps, the tables, and the costs of EXPLAIN', () => {
    const plan = parsePlan('postgres', postgresExplain)

    expect(plan.isAnalyzed).toBe(false)
    expect(plan.totalTime).toBeNull()
    expect(operations(postgresExplain, 'postgres')).toEqual([
      'Sort',
      'Aggregate',
      'Hash Join',
      'Seq Scan',
      'Hash',
      'Seq Scan',
    ])
    const scan = flatten(plan.root)[3]
    expect(scan.target).toBe('t')
    expect(scan.details).toContainEqual(['Filter', '(id > 5)'])
    expect(scan.estimatedRows).toBe(9995)
    expect(scan.actualRows).toBeNull()
    // The cost of each step without its children adds up to the cost of the plan.
    const shares = flatten(plan.root).map((node) => node.share ?? 0)
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5)
    expect(scan.selfCost).toBe(189)
  })

  test('reads the times and the actual rows of EXPLAIN ANALYZE', () => {
    const plan = parsePlan('postgres', postgresAnalyze)

    expect(plan.isAnalyzed).toBe(true)
    expect(plan.totalTime).toBeGreaterThan(0)
    expect(plan.planningTime).toBeGreaterThan(0)
    const join = flatten(plan.root)[2]
    expect(join.operation).toBe('Hash Join')
    expect(join.actualRows).toBe(95)
    expect(join.details).toContainEqual(['Hash Cond', '(t.id = u.id)'])
    expect(join.selfTime).toBeGreaterThan(0)
    // The scan of the large table is the costliest step.
    const hot = costliest(plan, 1)
    expect(flatten(plan.root).find((node) => hot.has(node.id))?.target).toBe(
      't',
    )
  })
})

describe('parsePlan for DuckDB', () => {
  test('reads the steps and the estimates of EXPLAIN', () => {
    const plan = parsePlan('duckdb', duckdbExplain)

    expect(plan.isAnalyzed).toBe(false)
    const steps = flatten(plan.root)
    expect(steps[0].operation).toBe('PROJECTION')
    const scans = steps.filter((node) => node.operation === 'SEQ_SCAN')
    expect(scans.map((node) => node.target)).toEqual([
      'memory.main.t',
      'memory.main.u',
    ])
    expect(scans[0].details).toContainEqual(['Filters', '(id > 5)'])
    expect(scans[0].estimatedRows).toBe(2000)
    // DuckDB gives no cost without ANALYZE.
    expect(steps.every((node) => node.share === null)).toBe(true)
  })

  test('reads the times of EXPLAIN ANALYZE without the steps around the plan', () => {
    const plan = parsePlan('duckdb', duckdbAnalyze)

    expect(plan.isAnalyzed).toBe(true)
    expect(plan.root.operation).toBe('PROJECTION')
    const steps = flatten(plan.root)
    expect(steps.map((node) => node.operation)).not.toContain('EXPLAIN_ANALYZE')
    expect(plan.totalTime).toBeGreaterThan(0)
    const shares = steps.map((node) => node.share ?? 0)
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5)
    // DuckDB expected 4 rows from the join and got more than 10 times more.
    const join = steps.find((node) => node.operation === 'HASH_JOIN')
    expect(join?.actualRows).toBeGreaterThan(40)
    expect(join?.misestimate).toBeGreaterThanOrEqual(10)
  })
})

describe('parsePlan errors', () => {
  test('gives a message for text that is not a plan', () => {
    expect(() => parsePlan('postgres', 'not json')).toThrow('not valid JSON')
    expect(() => parsePlan('postgres', '[{}]')).toThrow('no "Plan"')
    expect(() => parsePlan('duckdb', '[]')).toThrow('no step')
  })
})

test('a misestimate can be too large or too small', () => {
  const plan = parsePlan(
    'postgres',
    JSON.stringify([
      {
        Plan: {
          'Node Type': 'Seq Scan',
          'Total Cost': 10,
          'Plan Rows': 1000,
          'Actual Rows': 10,
          'Actual Loops': 1,
          'Actual Total Time': 1,
          Plans: [
            {
              'Node Type': 'Index Scan',
              'Total Cost': 1,
              'Plan Rows': 1,
              'Actual Rows': 50,
              'Actual Loops': 1,
              'Actual Total Time': 0.5,
            },
          ],
        },
        'Execution Time': 1.2,
      },
    ]),
  )

  expect(plan.root.misestimate).toBe(-100)
  expect(plan.root.children[0].misestimate).toBe(50)
})

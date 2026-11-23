import { describe, expect, test } from 'vitest'
import postgresAnalyze from './fixtures/postgres-analyze.json?raw'
import { fieldInfo, operationText, totalText } from './planGlossary'
import { hintsOf } from './planHints'
import { flatten, parsePlan, type Plan } from './planModel'

/** Makes a measured PostgreSQL plan with one step. */
function onePostgresStep(fields: Record<string, unknown>): Plan {
  return parsePlan(
    'postgres',
    JSON.stringify([
      {
        Plan: {
          'Node Type': 'Seq Scan',
          'Relation Name': 'item',
          'Total Cost': 100,
          'Plan Rows': 10,
          'Actual Rows': 10,
          'Actual Loops': 1,
          'Actual Total Time': 5,
          ...fields,
        },
        'Execution Time': 5,
      },
    ]),
  )
}

const texts = (plan: Plan) =>
  hintsOf(plan.root, plan, new Set()).map((hint) => hint.text)

describe('parsePlan keeps all fields', () => {
  test('keeps each field of a PostgreSQL step, also the measured ones', () => {
    const plan = parsePlan('postgres', postgresAnalyze)
    const sort = plan.root

    expect(sort.details).toContainEqual(['Sort Space Type', 'Memory'])
    expect(sort.details).toContainEqual(['Startup Cost', '231.5'])
    expect(sort.details).toContainEqual(['Parallel Aware', 'no'])
    expect(sort.details.map(([key]) => key)).not.toContain('Plans')
    expect(sort.loops).toBe(1)
    expect(plan.engine).toBe('postgres')
  })

  test('keeps the fields of the complete PostgreSQL plan', () => {
    const plan = parsePlan(
      'postgres',
      JSON.stringify([
        {
          Plan: { 'Node Type': 'Result' },
          Triggers: [],
          JIT: { Functions: 3 },
          'Planning Time': 1,
        },
      ]),
    )

    expect(plan.totals).toEqual([['JIT', '{"Functions":3}']])
  })

  test('keeps the measured fields and the totals of DuckDB', async () => {
    const duckdbAnalyze = (await import('./fixtures/duckdb-analyze.json?raw'))
      .default
    const plan = parsePlan('duckdb', duckdbAnalyze)
    const scan = flatten(plan.root).find(
      (node) => node.operation === 'TABLE_SCAN',
    )

    expect(scan?.details).toContainEqual(['rows_scanned', '7952'])
    expect(scan?.details).toContainEqual(['Type', 'Sequential Scan'])
    expect(plan.totals).toContainEqual(['query.total_rows_scanned', '8052'])
  })
})

describe('the glossary', () => {
  test('explains the steps of the two engines', () => {
    expect(operationText('postgres', 'Hash Join')).toMatch(/hash table/)
    expect(operationText('duckdb', 'HASH_JOIN')).toMatch(/hash table/)
    expect(operationText('postgres', 'HASH_JOIN')).toBeNull()
  })

  test('puts each field into a group and explains the known fields', () => {
    expect(fieldInfo('Shared Read Blocks').group).toBe('io')
    expect(fieldInfo('Sort Method').text).toMatch(/external merge/)
    expect(fieldInfo('Some New Blocks')).toEqual({ group: 'io', text: null })
    expect(fieldInfo('Actual Something')).toEqual({
      group: 'measured',
      text: null,
    })
    expect(totalText('system.peak_temp_dir_size')).toMatch(/temporary files/)
  })
})

describe('hintsOf', () => {
  test('suggests an index when a scan removes most rows', () => {
    const plan = onePostgresStep({
      Filter: '(price > 10)',
      'Rows Removed by Filter': 99990,
    })

    expect(texts(plan)[0]).toMatch(
      /read 100,000 rows and kept only 10. An index on the columns of the filter \(price > 10\)/,
    )
  })

  test('says nothing when the filter removes few rows', () => {
    const plan = onePostgresStep({
      Filter: '(price > 10)',
      'Rows Removed by Filter': 5,
    })

    expect(texts(plan)).toEqual([])
  })

  test('tells that a sort or a hash used the disk', () => {
    expect(
      texts(
        onePostgresStep({
          'Sort Method': 'external merge',
          'Sort Space Used': 2048,
        }),
      )[0],
    ).toMatch(/temporary files on disk \(2,048 kB\)/)
    expect(texts(onePostgresStep({ 'Hash Batches': 4 }))[0]).toMatch(
      /did not fit in memory/,
    )
    expect(texts(onePostgresStep({ 'Temp Written Blocks': 12 }))[0]).toMatch(
      /wrote 12 pages/,
    )
  })

  test('explains a misestimate, many loops, and missing workers', () => {
    expect(
      texts(onePostgresStep({ 'Plan Rows': 1, 'Actual Rows': 500 }))[0],
    ).toMatch(/500 times more rows .* ANALYZE/)
    expect(texts(onePostgresStep({ 'Actual Loops': 5000 }))[0]).toMatch(
      /ran 5,000 times/,
    )
    expect(
      texts(
        onePostgresStep({ 'Workers Planned': 4, 'Workers Launched': 2 }),
      )[0],
    ).toMatch(/only 2 started/)
    expect(texts(onePostgresStep({ 'Actual Loops': 0 }))[0]).toMatch(
      /did not run/,
    )
  })

  test('tells about pages from the disk and heap fetches', () => {
    expect(
      texts(
        onePostgresStep({
          'Shared Read Blocks': 5000,
          'Shared Hit Blocks': 10,
        }),
      )[0],
    ).toMatch(/not in the cache/)
    expect(
      texts(
        onePostgresStep({ 'Node Type': 'Index Only Scan', 'Heap Fetches': 30 }),
      )[0],
    ).toMatch(/VACUUM/)
    expect(texts(onePostgresStep({ 'Lossy Heap Blocks': 3 }))[0]).toMatch(
      /work_mem/,
    )
  })

  test('marks the costly step with its part of the total', () => {
    const plan = onePostgresStep({})

    const hints = hintsOf(plan.root, plan, new Set([plan.root.id]))

    expect(hints[0].text).toMatch(/100 % of the time/)
  })

  test('tells when a DuckDB scan reads many more rows than it gives', async () => {
    const plan = parsePlan(
      'duckdb',
      JSON.stringify({
        operator: [
          {
            type: 'TABLE_SCAN',
            timing: 0.001,
            operator_cardinality: 10,
            rows_scanned: 50000,
            extra_info: { Table: 't', 'Estimated Cardinality': '10' },
            children: [],
          },
        ],
      }),
    )

    expect(texts(plan)[0]).toMatch(/read 50,000 rows and gave 10/)
  })
})

describe('hintsOf with child steps', () => {
  test('uses the blocks of the step without the blocks of its child steps', () => {
    const plan = parsePlan(
      'postgres',
      JSON.stringify([
        {
          Plan: {
            'Node Type': 'Sort',
            'Actual Rows': 1,
            'Actual Loops': 1,
            'Shared Read Blocks': 5000,
            Plans: [
              {
                'Node Type': 'Seq Scan',
                'Actual Rows': 1,
                'Actual Loops': 1,
                'Shared Read Blocks': 5000,
              },
            ],
          },
        },
      ]),
    )

    expect(texts(plan)).toEqual([])
    expect(
      hintsOf(plan.root.children[0], plan, new Set()).map((hint) => hint.text),
    ).toEqual([expect.stringMatching(/not in the cache/)])
  })

  test('counts the removed rows of all runs', () => {
    const plan = onePostgresStep({
      'Actual Rows': 1,
      'Actual Loops': 200,
      'Rows Removed by Filter': 50,
    })

    expect(texts(plan)).toContainEqual(
      expect.stringMatching(/read 10,200 rows and kept only 200/),
    )
  })
})

import type {
  FieldGroup,
  PlanField_Serialize,
  PlanRead_Serialize,
  PlanStep_Serialize,
  Plan_Serialize,
} from '../../src/bindings'

/** The measured plan of the top items query, as EXPLAIN ANALYZE of PostgreSQL gives it. */

function field(
  name: string,
  value: string,
  group: FieldGroup = 'step',
  explanation: string | null = null,
): PlanField_Serialize {
  return { name, value, group, explanation }
}

type Values = Partial<PlanStep_Serialize> & {
  rows: [estimated: number, actual: number]
  cost: number
  ms: number
}

function step(operation: string, values: Values): PlanStep_Serialize {
  const { rows, cost, ms, ...rest } = values
  return {
    operation,
    target: null,
    explanation: null,
    fields: [],
    estimatedRows: rows[0],
    actualRows: rows[1],
    loops: 1,
    selfCost: cost,
    selfMs: ms,
    children: [],
    ...rest,
  }
}

const ORDERS_SCAN = step('Index Scan', {
  target: 'orders_ordered_at_idx on orders o',
  explanation:
    'Reads the rows of the table through the index, in the sequence of the index.',
  fields: [
    field(
      'Index Cond',
      "(ordered_at >= (now() - '30 days'::interval))",
      'step',
      'The condition that the index finds.',
    ),
    field(
      'Filter',
      "(status <> 'cancelled'::order_status)",
      'step',
      'The condition that the step checks on each row.',
    ),
    field(
      'Rows Removed by Filter',
      '214',
      'measured',
      'The rows that the filter did not keep.',
    ),
    field(
      'Shared Hit Blocks',
      '1 186',
      'io',
      'Blocks that were in the memory of the server.',
    ),
  ],
  rows: [4800, 5126],
  cost: 312.4,
  ms: 3.1,
})

const LINES_SCAN = step('Seq Scan', {
  target: 'order_line ol',
  explanation: 'Reads all rows of the table, from the first to the last.',
  fields: [
    field(
      'Shared Hit Blocks',
      '2 940',
      'io',
      'Blocks that were in the memory of the server.',
    ),
    field(
      'Shared Read Blocks',
      '1 315',
      'io',
      'Blocks that the server read from the disk.',
    ),
  ],
  rows: [182400, 182400],
  cost: 2984.0,
  ms: 14.6,
})

const ITEM_SCAN = step('Seq Scan', {
  target: 'item i',
  explanation: 'Reads all rows of the table, from the first to the last.',
  rows: [640, 640],
  cost: 14.4,
  ms: 0.1,
})

const ROOT = step('Limit', {
  explanation: 'Gives only the first rows of its input.',
  rows: [15, 15],
  cost: 0.1,
  ms: 0.01,
  children: [
    step('Sort', {
      explanation: 'Sorts the rows.',
      fields: [
        field(
          'Sort Key',
          '(sum(((ol.quantity)::numeric * ol.unit_price))) DESC',
          'step',
          'The values that the sort uses.',
        ),
        field(
          'Sort Method',
          'top-N heapsort',
          'measured',
          'How the server sorted the rows.',
        ),
        field(
          'Sort Space Used',
          '27 kB',
          'memory',
          'The memory that the sort used.',
        ),
      ],
      rows: [15, 15],
      cost: 18.2,
      ms: 0.4,
      children: [
        step('HashAggregate', {
          explanation:
            'Calculates the aggregates for each group in a hash table.',
          fields: [
            field(
              'Group Key',
              'i.sku, i.name',
              'step',
              'The values that make the groups.',
            ),
            field(
              'Peak Memory Usage',
              '217 kB',
              'memory',
              'The most memory that the step used.',
            ),
          ],
          rows: [640, 412],
          cost: 41.7,
          ms: 2.2,
          children: [
            step('Hash Join', {
              explanation: 'Joins the rows of two inputs with a hash table.',
              fields: [
                field(
                  'Hash Cond',
                  '(ol.item_id = i.id)',
                  'step',
                  'The condition of the join.',
                ),
              ],
              rows: [21300, 20612],
              cost: 290.5,
              ms: 3.4,
              children: [
                step('Hash Join', {
                  explanation:
                    'Joins the rows of two inputs with a hash table.',
                  fields: [
                    field(
                      'Hash Cond',
                      '(ol.order_id = o.id)',
                      'step',
                      'The condition of the join.',
                    ),
                  ],
                  rows: [21300, 20612],
                  cost: 512.8,
                  ms: 6.9,
                  children: [
                    LINES_SCAN,
                    step('Hash', {
                      explanation: 'Puts the rows into a hash table.',
                      fields: [
                        field(
                          'Memory Usage',
                          '305 kB',
                          'memory',
                          'The memory of the hash table.',
                        ),
                      ],
                      rows: [4800, 5126],
                      cost: 60.0,
                      ms: 0.9,
                      children: [ORDERS_SCAN],
                    }),
                  ],
                }),
                step('Hash', {
                  explanation: 'Puts the rows into a hash table.',
                  rows: [640, 640],
                  cost: 8.0,
                  ms: 0.1,
                  children: [ITEM_SCAN],
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  ],
})

const PLAN: Plan_Serialize = {
  root: ROOT,
  isMeasured: true,
  totalMs: 32.4,
  planningMs: 0.8,
  costUnit: 'cost units',
  totals: [field('JIT', 'off', 'step', 'The just-in-time compilation.')],
  hints: [
    {
      step: '0.0.0.0.0.0',
      level: 'warning',
      title: 'The scan reads all rows of order_line',
      text: 'The join uses only the lines of 5 126 orders. An index on order_line (order_id) lets the server read only these lines.',
    },
  ],
}

const TEXT = `Limit  (cost=4231.61..4231.65 rows=15 width=86) (actual time=32.118..32.124 rows=15 loops=1)
  ->  Sort  (cost=4231.61..4233.21 rows=640 width=86) (actual time=32.116..32.119 rows=15 loops=1)
        Sort Key: (sum(((ol.quantity)::numeric * ol.unit_price))) DESC
        Sort Method: top-N heapsort  Memory: 27kB
        ->  HashAggregate  (cost=4205.31..4213.31 rows=640 width=86) (actual time=31.502..31.811 rows=412 loops=1)
              Group Key: i.sku, i.name
              ->  Hash Join  (cost=360.83..3992.31 rows=21300 width=52) (actual time=4.410..27.902 rows=20612 loops=1)
                    Hash Cond: (ol.item_id = i.id)
                    ->  Hash Join  (cost=346.43..3701.81 rows=21300 width=18) (actual time=4.281..24.385 rows=20612 loops=1)
                          Hash Cond: (ol.order_id = o.id)
                          ->  Seq Scan on order_line ol  (cost=0.00..2984.00 rows=182400 width=26) (actual time=0.009..14.610 rows=182400 loops=1)
                          ->  Hash  (cost=286.43..286.43 rows=4800 width=8) (actual time=4.012..4.013 rows=5126 loops=1)
                                ->  Index Scan using orders_ordered_at_idx on orders o  (cost=0.29..286.43 rows=4800 width=8) (actual time=0.021..3.104 rows=5126 loops=1)
                                      Index Cond: (ordered_at >= (now() - '30 days'::interval))
                                      Filter: (status <> 'cancelled'::order_status)
                                      Rows Removed by Filter: 214
                    ->  Hash  (cost=6.40..6.40 rows=640 width=42) (actual time=0.118..0.119 rows=640 loops=1)
                          ->  Seq Scan on item i  (cost=0.00..6.40 rows=640 width=42) (actual time=0.004..0.061 rows=640 loops=1)
Planning Time: 0.812 ms
Execution Time: 32.402 ms`

export function readPlan(sql: string, measure: boolean): PlanRead_Serialize {
  return {
    status: 'plan',
    statement: sql,
    text: TEXT,
    plan: { ...PLAN, isMeasured: measure },
    is_analyzed: measure,
  }
}

import type { Plan, PlanNode } from './planModel'

/** A remark about a step. A `warning` is a probable cause of a slow statement. */
export type Hint = { level: 'warning' | 'info'; text: string }

/** A step that removes this many times more rows than it keeps reads too many rows. */
const REMOVED_FACTOR = 10
/** Fewer removed rows than this are not important. */
const MIN_REMOVED = 1000
/** An inner step that runs this many times or more is important. */
const MANY_LOOPS = 1000
/** Fewer blocks than this from the disk are not important. */
const MIN_READ_BLOCKS = 1000

const count = new Intl.NumberFormat('en')

function value(node: PlanNode, key: string): string | null {
  return node.details.find(([name]) => name === key)?.[1] ?? null
}

function numberOf(node: PlanNode, key: string): number | null {
  const text = value(node, key)
  if (text === null) return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Returns the value of a block counter for the step alone. PostgreSQL counts the
 * blocks of a step together with the blocks of its child steps.
 */
function ownBlocks(node: PlanNode, key: string): number | null {
  const total = numberOf(node, key)
  if (total === null) return null
  const children = node.children.reduce(
    (sum, child) => sum + (numberOf(child, key) ?? 0),
    0,
  )
  return Math.max(0, total - children)
}

function filterHint(node: PlanNode): Hint | null {
  // PostgreSQL gives the removed rows of one run, as the actual rows.
  const perRun = numberOf(node, 'Rows Removed by Filter')
  const removed = perRun === null ? null : perRun * (node.loops ?? 1)
  const kept = (node.actualRows ?? 0) * (node.loops ?? 1)
  if (removed === null || removed < MIN_REMOVED) return null
  if (removed < Math.max(kept, 1) * REMOVED_FACTOR) return null
  const filter = value(node, 'Filter')
  const isScan = node.operation.includes('Seq Scan')
  return {
    level: 'warning',
    text:
      `The step read ${count.format(removed + kept)} rows and kept only ${count.format(kept)}.` +
      (isScan && filter
        ? ` An index on the columns of the filter ${filter} can let the database read only the necessary rows.`
        : ' The condition removes most rows only after the read.'),
  }
}

function duckdbScanHint(node: PlanNode): Hint | null {
  const scanned =
    numberOf(node, 'rows_scanned') ?? numberOf(node, 'operator_rows_scanned')
  const kept = node.actualRows
  if (scanned === null || kept === null || scanned < MIN_REMOVED) return null
  if (scanned < Math.max(kept, 1) * REMOVED_FACTOR) return null
  return {
    level: 'info',
    text: `The scan read ${count.format(scanned)} rows and gave ${count.format(kept)}. If the table is sorted on the filter column, DuckDB can skip more row groups.`,
  }
}

function sortHint(node: PlanNode): Hint | null {
  const method = value(node, 'Sort Method') ?? ''
  const type = value(node, 'Sort Space Type')
  if (!method.includes('external') && type !== 'Disk') return null
  const space = numberOf(node, 'Sort Space Used')
  return {
    level: 'warning',
    text:
      'The sort did not fit in memory and used temporary files on disk' +
      (space === null ? '. ' : ` (${count.format(space)} kB). `) +
      'A larger work_mem can keep it in memory. An index with the sort columns can make the sort unnecessary.',
  }
}

function hashHint(node: PlanNode): Hint | null {
  const batches =
    numberOf(node, 'Hash Batches') ?? numberOf(node, 'HashAgg Batches')
  const disk = numberOf(node, 'Disk Usage')
  if ((batches === null || batches <= 1) && (disk === null || disk <= 0))
    return null
  return {
    level: 'warning',
    text: 'The hash table did not fit in memory, so the database divided it into parts on disk. A larger work_mem (or hash_mem_multiplier) can keep it in memory.',
  }
}

function tempHint(node: PlanNode): Hint | null {
  const written = ownBlocks(node, 'Temp Written Blocks')
  if (written === null || written <= 0) return null
  return {
    level: 'warning',
    text: `The step wrote ${count.format(written)} pages (8 kB each) to temporary files. Temporary files are slower than memory.`,
  }
}

function lossyHint(node: PlanNode): Hint | null {
  const lossy = numberOf(node, 'Lossy Heap Blocks')
  if (lossy === null || lossy <= 0) return null
  return {
    level: 'info',
    text: 'The bitmap did not fit in work_mem. For some pages, the step had to check each row again.',
  }
}

function heapFetchHint(node: PlanNode): Hint | null {
  const fetches = numberOf(node, 'Heap Fetches')
  if (
    fetches === null ||
    fetches <= 0 ||
    !node.operation.includes('Index Only')
  )
    return null
  return {
    level: 'info',
    text: `The index-only scan read ${count.format(fetches)} rows from the table. VACUUM on the table updates the visibility map and decreases these reads.`,
  }
}

function cacheHint(node: PlanNode): Hint | null {
  const read = ownBlocks(node, 'Shared Read Blocks')
  const hit = ownBlocks(node, 'Shared Hit Blocks') ?? 0
  if (read === null || read < MIN_READ_BLOCKS || read <= hit) return null
  return {
    level: 'info',
    text: `Most pages (${count.format(read)} of ${count.format(read + hit)}) were not in the cache of the server. A second run is often faster, because the pages are then in the cache.`,
  }
}

function loopHint(node: PlanNode): Hint | null {
  if (node.loops === null || node.loops < MANY_LOOPS) return null
  return {
    level: 'info',
    text: `This step ran ${count.format(node.loops)} times, one time for each row of the step above it. The time of one run is small, but the total is the time × ${count.format(node.loops)}.`,
  }
}

function workerHint(node: PlanNode): Hint | null {
  const planned = numberOf(node, 'Workers Planned')
  const launched = numberOf(node, 'Workers Launched')
  if (planned === null || launched === null || launched >= planned) return null
  return {
    level: 'info',
    text: `The planner wanted ${planned} parallel processes, but only ${launched} started. The server had no more free processes (max_parallel_workers).`,
  }
}

function neverHint(node: PlanNode): Hint | null {
  if (node.loops !== 0) return null
  return {
    level: 'info',
    text: 'This step did not run. The database did not need its rows, for example because a different step gave no rows.',
  }
}

function misestimateHint(node: PlanNode): Hint | null {
  if (node.misestimate === null) return null
  const factor = Math.abs(node.misestimate)
  const direction = node.misestimate > 0 ? 'more' : 'fewer'
  return {
    level: 'warning',
    text: `The step returned ${factor} times ${direction} rows than the planner expected. With a wrong estimate, the planner can select a slow join or scan. ANALYZE on the tables updates their statistics. For conditions on related columns, CREATE STATISTICS can help.`,
  }
}

function costlyHint(node: PlanNode, plan: Plan, hot: Set<string>): Hint | null {
  if (!hot.has(node.id) || node.share === null) return null
  const what = plan.isAnalyzed ? 'time' : 'estimated cost'
  return {
    level: 'info',
    text: `This step has ${Math.round(node.share * 100)} % of the ${what} of the statement, without its child steps. Look at this step first.`,
  }
}

const NODE_HINTS = [
  misestimateHint,
  filterHint,
  duckdbScanHint,
  sortHint,
  hashHint,
  tempHint,
  lossyHint,
  heapFetchHint,
  cacheHint,
  loopHint,
  workerHint,
  neverHint,
]

/** Returns the remarks about a step. `hot` has the identifiers of the costliest steps. */
export function hintsOf(node: PlanNode, plan: Plan, hot: Set<string>): Hint[] {
  return [costlyHint, ...NODE_HINTS]
    .map((hint) => hint(node, plan, hot))
    .filter((hint): hint is Hint => hint !== null)
}

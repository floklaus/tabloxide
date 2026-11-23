import type { Engine } from '../bindings'

/**
 * Plain explanations of the steps of an execution plan. The keys are the names that
 * the engines use. PostgreSQL uses names like `Hash Join`, DuckDB uses `HASH_JOIN`.
 */
const POSTGRES_OPERATIONS: Record<string, string> = {
  'Seq Scan':
    'Reads all rows of the table, from the first to the last, and keeps the rows that agree with the filter.',
  'Parallel Seq Scan':
    'Reads all rows of the table with more than one process. Each process reads a part of the table.',
  'Index Scan':
    'Finds the rows with an index, then reads each row from the table. This is fast when the condition selects few rows.',
  'Index Only Scan':
    'Gets the data from the index only. The table is necessary only for rows that changed after the last VACUUM.',
  'Bitmap Index Scan':
    'Finds the positions of the rows with an index, and keeps them in a bitmap in memory. The step above it reads the rows.',
  'Bitmap Heap Scan':
    'Reads the rows that the bitmap index scan found, in the sequence of the table on disk. This is good for a medium number of rows.',
  BitmapAnd:
    'Combines two or more bitmaps. A row is in the result only if it is in all bitmaps.',
  BitmapOr:
    'Combines two or more bitmaps. A row is in the result if it is in one of the bitmaps.',
  'Tid Scan': 'Reads rows by their physical position (ctid).',
  'Tid Range Scan': 'Reads the rows in a range of physical positions (ctid).',
  'Subquery Scan': 'Reads the rows of a subquery in the FROM clause.',
  'Function Scan':
    'Reads the rows that a function returns, for example generate_series.',
  'Table Function Scan':
    'Reads the rows of a table function, for example XMLTABLE.',
  'Values Scan': 'Reads the rows of a VALUES list in the statement.',
  'CTE Scan':
    'Reads the rows of a WITH query. The database calculates the WITH query one time and keeps its rows.',
  'WorkTable Scan':
    'Reads the rows of the last step of a recursive WITH query.',
  'Named Tuplestore Scan': 'Reads the rows of a transition table of a trigger.',
  'Foreign Scan': 'Reads the rows from a foreign table on a different server.',
  'Custom Scan': 'A scan of an extension.',
  'Sample Scan': 'Reads a sample of the table (TABLESAMPLE).',
  Result:
    'Calculates values without a table, or checks a condition that is the same for all rows.',
  ProjectSet:
    'Calculates a function that returns more than one row for each input row.',
  Append:
    'Puts the rows of its child steps one after the other, for example for UNION ALL or a partitioned table.',
  'Merge Append':
    'Combines the sorted rows of its child steps into one sorted result.',
  'Recursive Union': 'Calculates a recursive WITH query.',
  'Nested Loop':
    'For each row of the first child step, runs the second child step. This is fast when the first step returns few rows.',
  'Merge Join':
    'Joins two inputs that are sorted on the join key. It reads each input one time.',
  'Hash Join':
    'Puts the rows of one input into a hash table in memory, then finds the matching rows for each row of the other input.',
  Hash: 'Makes the hash table for the hash join above it.',
  Materialize:
    'Keeps the rows of its child step in memory, so that the step above can read them again.',
  Memoize:
    'Keeps the results of the step below it for each key. A second request with the same key uses the kept result.',
  Sort: 'Sorts the rows, for example for ORDER BY, a merge join, or a GROUP BY.',
  'Incremental Sort':
    'Sorts rows that are already sorted on the first keys. It sorts only the groups with the same first keys.',
  Group: 'Makes groups of sorted rows for GROUP BY.',
  Aggregate:
    'Calculates aggregate functions such as count, sum, or avg, for all rows or for each group.',
  WindowAgg:
    'Calculates window functions, for example row_number() OVER (...).',
  Unique:
    'Removes rows that are equal to the row before them. The input is sorted.',
  SetOp: 'Calculates INTERSECT or EXCEPT.',
  LockRows: 'Locks the rows for SELECT ... FOR UPDATE or FOR SHARE.',
  Limit:
    'Stops after the number of rows of LIMIT. The steps below it can stop early.',
  Gather:
    'Collects the rows of the parallel worker processes. The steps below it run in parallel.',
  'Gather Merge':
    'Collects the sorted rows of the parallel worker processes, and keeps the sort sequence.',
  ModifyTable:
    'Inserts, changes, or deletes the rows (INSERT, UPDATE, DELETE, or MERGE).',
}

const DUCKDB_OPERATIONS: Record<string, string> = {
  TABLE_SCAN:
    'Reads the columns of a table that the statement needs. DuckDB stores each column separately, so it reads only these columns.',
  SEQ_SCAN: 'Reads the columns of a table that the statement needs.',
  READ_CSV: 'Reads the rows of a CSV file.',
  READ_CSV_AUTO:
    'Reads the rows of a CSV file. DuckDB finds the format of the file.',
  READ_PARQUET: 'Reads the rows of a Parquet file.',
  READ_JSON: 'Reads the rows of a JSON file.',
  COLUMN_DATA_SCAN:
    'Reads rows that DuckDB keeps in memory, for example a VALUES list.',
  DUMMY_SCAN: 'Gives one empty row, for a statement without a table.',
  EMPTY_RESULT: 'Gives no rows. DuckDB knows that the result is empty.',
  CHUNK_SCAN: 'Reads rows that a different step keeps in memory.',
  DELIM_SCAN: 'Reads the distinct values of a correlated subquery.',
  CTE: 'Calculates a WITH query one time and keeps its rows.',
  CTE_SCAN: 'Reads the kept rows of a WITH query.',
  FILTER: 'Keeps only the rows that agree with the condition.',
  PROJECTION:
    'Calculates the columns of the result, or puts the columns in a different sequence.',
  HASH_JOIN:
    'Puts the rows of one input into a hash table in memory, then finds the matching rows for each row of the other input.',
  NESTED_LOOP_JOIN:
    'Compares each row of one input with each row of the other input.',
  BLOCKWISE_NL_JOIN:
    'Compares blocks of rows of the two inputs. DuckDB uses it for conditions without equality.',
  PIECEWISE_MERGE_JOIN:
    'Sorts the two inputs and joins them on a condition such as < or >.',
  IE_JOIN: 'Joins on two inequality conditions, for example a range join.',
  ASOF_JOIN:
    'Finds for each row the nearest row of the other input (ASOF JOIN).',
  POSITIONAL_JOIN: 'Joins the rows of the two inputs by their position.',
  CROSS_PRODUCT:
    'Combines each row of one input with each row of the other input.',
  DELIM_JOIN: 'Calculates a correlated subquery as a join.',
  LEFT_DELIM_JOIN: 'Calculates a correlated subquery as a join.',
  RIGHT_DELIM_JOIN: 'Calculates a correlated subquery as a join.',
  HASH_GROUP_BY:
    'Makes groups with a hash table, and calculates the aggregate functions of each group.',
  PERFECT_HASH_GROUP_BY:
    'Makes groups with an array, because the group keys have a small known range. This is faster than a hash table.',
  UNGROUPED_AGGREGATE:
    'Calculates aggregate functions for all rows, without GROUP BY.',
  SIMPLE_AGGREGATE:
    'Calculates aggregate functions for all rows, without GROUP BY.',
  STREAMING_WINDOW: 'Calculates window functions while the rows come.',
  WINDOW: 'Calculates window functions, for example row_number() OVER (...).',
  ORDER_BY: 'Sorts the rows.',
  TOP_N:
    'Keeps only the first rows of the sort sequence, for ORDER BY with LIMIT. It does not sort all rows.',
  LIMIT: 'Stops after the number of rows of LIMIT.',
  STREAMING_LIMIT:
    'Stops after the number of rows of LIMIT, while the rows come.',
  LIMIT_PERCENT: 'Stops after a percentage of the rows.',
  UNION: 'Puts the rows of its two inputs one after the other.',
  UNNEST: 'Makes one row for each element of a list.',
  INOUT_FUNCTION: 'Calls a table function for each input row.',
  TABLE_FUNCTION: 'Reads the rows that a table function returns.',
  INSERT: 'Inserts the rows into the table.',
  UPDATE: 'Changes the rows of the table.',
  DELETE: 'Deletes the rows of the table.',
}

/** Returns the plain explanation of a step, or `null` for an unknown step. */
export function operationText(
  engine: Engine,
  operation: string,
): string | null {
  const names = engine === 'duckdb' ? DUCKDB_OPERATIONS : POSTGRES_OPERATIONS
  return names[operation] ?? null
}

/** The group of a field in the details of a step. */
export type FieldGroup = 'step' | 'estimate' | 'measured' | 'memory' | 'io'

export const GROUP_LABELS: Record<FieldGroup, string> = {
  step: 'What the step does',
  estimate: 'Estimates of the planner',
  measured: 'Measured when the statement ran',
  memory: 'Memory and disk',
  io: 'Blocks from the cache and the disk, with the child steps',
}

export const GROUP_ORDER: FieldGroup[] = [
  'step',
  'estimate',
  'measured',
  'memory',
  'io',
]

type FieldInfo = { group: FieldGroup; text: string }

const field = (group: FieldGroup, text: string): FieldInfo => ({ group, text })

const FIELDS: Record<string, FieldInfo> = {
  // PostgreSQL: estimates
  'Startup Cost': field(
    'estimate',
    'The cost before the step can give its first row. The unit is arbitrary: one page read in sequence costs 1.',
  ),
  'Total Cost': field(
    'estimate',
    'The cost to give all rows, with the cost of the child steps. Compare costs only in the same plan.',
  ),
  'Plan Rows': field(
    'estimate',
    'The number of rows that the planner expects from one run of this step.',
  ),
  'Plan Width': field('estimate', 'The average size of one row in bytes.'),
  // PostgreSQL: measured
  'Actual Startup Time': field(
    'measured',
    'Milliseconds until the first row, for one run of the step, with the child steps.',
  ),
  'Actual Total Time': field(
    'measured',
    'Milliseconds until the last row, for one run of the step, with the child steps.',
  ),
  'Actual Rows': field(
    'measured',
    'The average number of rows of one run of the step.',
  ),
  'Actual Loops': field(
    'measured',
    'How many times the step ran. Multiply the rows and the times by this number to get the total.',
  ),
  'Rows Removed by Filter': field(
    'measured',
    'Rows that the step read and then removed, because they did not agree with the filter. A large number can mean that an index is missing.',
  ),
  'Rows Removed by Index Recheck': field(
    'measured',
    'Rows that the step read again and removed. The bitmap was not exact, because it did not fit into work_mem.',
  ),
  'Rows Removed by Join Filter': field(
    'measured',
    'Row pairs that the join made and then removed, because they did not agree with the join filter.',
  ),
  'Heap Fetches': field(
    'measured',
    'Rows that an index-only scan read from the table, because the visibility map did not show them as visible. VACUUM decreases this number.',
  ),
  'Exact Heap Blocks': field(
    'measured',
    'Table pages with an exact list of rows in the bitmap.',
  ),
  'Lossy Heap Blocks': field(
    'measured',
    'Table pages without an exact list of rows. The step must check each row of these pages. More work_mem prevents this.',
  ),
  'Workers Planned': field(
    'estimate',
    'The number of parallel worker processes that the planner wants.',
  ),
  'Workers Launched': field(
    'measured',
    'The number of parallel worker processes that started. It can be less than planned when the server has no free workers.',
  ),
  'Index Searches': field(
    'measured',
    'How many times the step searched the index.',
  ),
  'Cache Hits': field('measured', 'Lookups that found a kept result.'),
  'Cache Misses': field(
    'measured',
    'Lookups that did not find a kept result, so the step below ran.',
  ),
  'Cache Evictions': field(
    'measured',
    'Kept results that the step removed, because the memory was full.',
  ),
  'Cache Overflows': field(
    'measured',
    'Times the memory was too small for the results of one key.',
  ),
  'Tuples Inserted': field('measured', 'Rows that the statement inserted.'),
  'Conflicting Tuples': field(
    'measured',
    'Rows that had a conflict (ON CONFLICT).',
  ),
  Workers: field(
    'measured',
    'The measured values of each parallel worker process.',
  ),
  'Full-sort Groups': field(
    'measured',
    'Groups of rows that the incremental sort sorted on all keys.',
  ),
  'Pre-sorted Groups': field(
    'measured',
    'Groups of rows that the incremental sort sorted only on the last keys.',
  ),
  // PostgreSQL: memory and disk
  'Sort Method': field(
    'memory',
    'How the step sorted. "quicksort" is in memory. "top-N heapsort" keeps only the first rows. "external merge" used temporary files on disk.',
  ),
  'Sort Space Used': field(
    'memory',
    'The memory or the disk space of the sort, in kilobytes.',
  ),
  'Sort Space Type': field(
    'memory',
    'Memory: the sort fitted in work_mem. Disk: the sort used temporary files.',
  ),
  'Peak Memory Usage': field(
    'memory',
    'The largest memory use of the step, in kilobytes.',
  ),
  'Disk Usage': field(
    'memory',
    'The disk space of temporary files, in kilobytes. More than 0 means that the memory was too small.',
  ),
  'Hash Buckets': field('memory', 'The number of entries of the hash table.'),
  'Original Hash Buckets': field(
    'memory',
    'The number of entries that the planner calculated for the hash table.',
  ),
  'Hash Batches': field(
    'memory',
    'The number of parts of the hash table. More than 1 means that the hash table did not fit in memory and used the disk.',
  ),
  'Original Hash Batches': field(
    'memory',
    'The number of parts that the planner calculated.',
  ),
  'HashAgg Batches': field(
    'memory',
    'The number of parts of the hash aggregate. More than 1 means that it used the disk.',
  ),
  'Planned Partitions': field(
    'memory',
    'The number of parts that the planner expected for the hash aggregate.',
  ),
  Storage: field(
    'memory',
    'Where the step kept its rows: in memory or on disk.',
  ),
  'Maximum Storage': field(
    'memory',
    'The largest space that the step used to keep rows, in kilobytes.',
  ),
  // PostgreSQL: blocks
  'Shared Hit Blocks': field(
    'io',
    'Pages (8 kB) that the step found in the cache of the server. These reads are fast.',
  ),
  'Shared Read Blocks': field(
    'io',
    'Pages (8 kB) that were not in the cache of the server. The server read them from the operating system or the disk.',
  ),
  'Shared Dirtied Blocks': field(
    'io',
    'Pages in the cache that the step changed.',
  ),
  'Shared Written Blocks': field(
    'io',
    'Changed pages that the step wrote from the cache to the disk.',
  ),
  'Local Hit Blocks': field(
    'io',
    'Pages of temporary tables that the step found in memory.',
  ),
  'Local Read Blocks': field(
    'io',
    'Pages of temporary tables that the step read from the disk.',
  ),
  'Local Dirtied Blocks': field(
    'io',
    'Pages of temporary tables that the step changed.',
  ),
  'Local Written Blocks': field(
    'io',
    'Pages of temporary tables that the step wrote to the disk.',
  ),
  'Temp Read Blocks': field(
    'io',
    'Pages of temporary files that the step read, for example of a sort or a hash on disk.',
  ),
  'Temp Written Blocks': field(
    'io',
    'Pages of temporary files that the step wrote. More than 0 means that work_mem was too small.',
  ),
  'I/O Read Time': field(
    'io',
    'Milliseconds of block reads. The server gives it only with track_io_timing.',
  ),
  'I/O Write Time': field(
    'io',
    'Milliseconds of block writes. The server gives it only with track_io_timing.',
  ),
  'Shared I/O Read Time': field(
    'io',
    'Milliseconds of reads of shared blocks. The server gives it only with track_io_timing.',
  ),
  'Shared I/O Write Time': field(
    'io',
    'Milliseconds of writes of shared blocks.',
  ),
  'Local I/O Read Time': field('io', 'Milliseconds of reads of local blocks.'),
  'Local I/O Write Time': field(
    'io',
    'Milliseconds of writes of local blocks.',
  ),
  'Temp I/O Read Time': field(
    'io',
    'Milliseconds of reads of temporary files.',
  ),
  'Temp I/O Write Time': field(
    'io',
    'Milliseconds of writes of temporary files.',
  ),
  'WAL Records': field(
    'io',
    'Records that the step wrote to the write-ahead log.',
  ),
  'WAL FPI': field(
    'io',
    'Full page images that the step wrote to the write-ahead log.',
  ),
  'WAL Bytes': field('io', 'Bytes that the step wrote to the write-ahead log.'),
  // PostgreSQL: the step
  'Parent Relationship': field(
    'step',
    'The role of this step for the step above it. Outer: the first input. Inner: the second input. SubPlan or InitPlan: a subquery.',
  ),
  'Parallel Aware': field(
    'step',
    'Yes if the step divides its work between parallel processes.',
  ),
  'Async Capable': field(
    'step',
    'Yes if the step can run while a different step waits, for example for a foreign server.',
  ),
  'Relation Name': field('step', 'The table that the step reads.'),
  Schema: field('step', 'The schema of the table.'),
  Alias: field('step', 'The name of the table in the statement.'),
  'Index Name': field('step', 'The index that the step uses.'),
  'Scan Direction': field(
    'step',
    'Forward or Backward: the direction in which the step reads the index. Backward is for a descending sort.',
  ),
  'Index Cond': field(
    'step',
    'The condition that the index finds. Only rows that agree with it are read.',
  ),
  'Recheck Cond': field(
    'step',
    'The condition that the step checks again on each row, when the bitmap is not exact.',
  ),
  Filter: field(
    'step',
    'The condition that the step checks on each row after it read the row. Rows that do not agree are removed.',
  ),
  'One-Time Filter': field(
    'step',
    'A condition that the step checks one time. If it is false, the step gives no rows.',
  ),
  'Join Type': field(
    'step',
    'Inner: only matching rows. Left, Right, Full: also rows without a match. Semi: for EXISTS or IN. Anti: for NOT EXISTS.',
  ),
  'Inner Unique': field(
    'step',
    'Yes if each row of the first input has a maximum of one match. Then the join can stop after the first match.',
  ),
  'Hash Cond': field(
    'step',
    'The condition that the hash table uses to find the matching rows.',
  ),
  'Merge Cond': field(
    'step',
    'The condition of the merge join. The two inputs are sorted on it.',
  ),
  'Join Filter': field(
    'step',
    'A join condition that the step checks on each row pair after the join.',
  ),
  'Sort Key': field('step', 'The columns of the sort.'),
  'Presorted Key': field(
    'step',
    'The columns on which the input is already sorted.',
  ),
  'Group Key': field('step', 'The columns of GROUP BY.'),
  Strategy: field(
    'step',
    'Plain: one group for all rows. Sorted: groups from sorted rows. Hashed: groups with a hash table. Mixed: more than one grouping set.',
  ),
  'Partial Mode': field(
    'step',
    'Simple: one aggregate step. Partial and Finalize: the parallel processes calculate parts, and a last step combines them.',
  ),
  Output: field(
    'step',
    'The columns and expressions that the step gives to the step above it.',
  ),
  'Subplan Name': field('step', 'The name of the subquery of this step.'),
  'CTE Name': field('step', 'The name of the WITH query.'),
  'Function Name': field('step', 'The function that gives the rows.'),
  'Single Copy': field(
    'step',
    'Yes if only one process runs the parallel part.',
  ),
  Operation: field('step', 'The change: Insert, Update, Delete, or Merge.'),
  'Cache Key': field(
    'step',
    'The values that the memoize step uses to find kept results.',
  ),
  'Cache Mode': field(
    'step',
    'Logical or binary: how the step compares the keys.',
  ),
  'Conflict Resolution': field(
    'step',
    'What ON CONFLICT does: NOTHING or UPDATE.',
  ),
  'Sampling Method': field('step', 'The method of TABLESAMPLE.'),
  Command: field('step', 'The command of INTERSECT or EXCEPT.'),
  // DuckDB
  Projections: field(
    'step',
    'The columns that the step gives to the step above it. #0 is the first column of the input.',
  ),
  Filters: field(
    'step',
    'The conditions that the scan checks while it reads. DuckDB can skip parts of the table with them.',
  ),
  'Dynamic Filters': field(
    'step',
    'Conditions that a join gives to the scan while the statement runs. The scan can then skip rows early.',
  ),
  Expression: field('step', 'The condition of the filter.'),
  Conditions: field('step', 'The join conditions.'),
  Aggregates: field('step', 'The aggregate functions.'),
  Groups: field('step', 'The group keys. #0 is the first column of the input.'),
  'Order By': field('step', 'The columns of the sort.'),
  Type: field('step', 'The kind of scan.'),
  Function: field('step', 'The table function.'),
  rows_scanned: field(
    'measured',
    'The number of rows that the scan read before the filters.',
  ),
  intermediate_size_bytes: field(
    'measured',
    'The size of the rows that the step gave, in bytes.',
  ),
  row_groups_scanned: field(
    'measured',
    'Row groups that the scan read. DuckDB stores a table in row groups of about 122,880 rows.',
  ),
  total_row_groups_to_scan: field(
    'measured',
    'Row groups that the scan could read. If this is more than the read groups, DuckDB skipped some with the filters.',
  ),
  result_set_size: field(
    'measured',
    'The size of the result of the step, in bytes.',
  ),
  cpu_time: field('measured', 'The processor time of the step, in seconds.'),
  operator_rows_scanned: field(
    'measured',
    'The number of rows that the scan read before the filters.',
  ),
}

const MEMORY_WORDS = /memory|batches|disk|space|storage/i
const IO_WORDS = /blocks|i\/o|wal /i

/** Returns the group and the explanation of a field. Unknown fields go to a group by their name. */
export function fieldInfo(key: string): {
  group: FieldGroup
  text: string | null
} {
  const known = FIELDS[key]
  if (known) return known
  if (IO_WORDS.test(key)) return { group: 'io', text: null }
  if (MEMORY_WORDS.test(key)) return { group: 'memory', text: null }
  if (key.startsWith('Actual ')) return { group: 'measured', text: null }
  return { group: 'step', text: null }
}

const TOTALS: Record<string, string> = {
  Planning:
    'The block reads of the planner, for example of the system catalog.',
  Triggers: 'The triggers that ran, and their times.',
  JIT: 'The just-in-time compilation of expressions. For a short statement, it can cost more time than it saves.',
  Settings:
    'Server settings with a value different from the default that change the plan.',
  'query.cpu_time': 'The processor time of all threads, in seconds.',
  'query.total_time': 'The time of the complete statement, in seconds.',
  'query.total_rows_scanned': 'The rows that all scans read.',
  'query.total_intermediate_rows':
    'The rows that all steps gave to the next step.',
  'query.total_row_groups_scanned': 'The row groups that all scans read.',
  'system.peak_buffer_memory': 'The largest memory use, in bytes.',
  'system.total_memory_allocated': 'The memory that DuckDB reserved, in bytes.',
  'system.peak_temp_dir_size':
    'The largest size of the temporary files, in bytes. More than 0 means that the memory was too small.',
  'system.blocked_thread_time': 'The time that the threads waited, in seconds.',
  'io.total_bytes_read': 'Bytes that DuckDB read from the disk.',
  'io.total_bytes_written': 'Bytes that DuckDB wrote to the disk.',
  'planner.total_time': 'The time to make the logical plan, in seconds.',
  'physical_planner.total_time':
    'The time to make the physical plan, in seconds.',
}

/** Returns the explanation of a field of the complete plan, or `null`. */
export function totalText(key: string): string | null {
  return TOTALS[key] ?? null
}

/** How to read a plan. The view shows these points above the tree. */
export const READING_GUIDE = [
  'The database runs the steps from the inside to the outside. The deepest steps read the tables. Each step gives its rows to the step above it.',
  'Cost is an estimate of the planner in an arbitrary unit. Use it to compare the steps of one plan, not of different plans.',
  'The percentage and the bar show the part of each step in the total, without its child steps. The three largest parts have the mark "costly".',
  'A large difference between the expected and the actual rows means that the statistics of a table are old or not sufficient. Then the planner can select a slow step.',
]

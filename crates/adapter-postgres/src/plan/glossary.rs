//! Plain explanations of the steps and the fields of a PostgreSQL plan.

use tabloxide_core::FieldGroup;

/// Returns the plain explanation of a step, or `None` for an unknown step.
pub(super) fn operation_text(operation: &str) -> Option<&'static str> {
    let text = match operation {
        "Seq Scan" => {
            "Reads all rows of the table, from the first to the last, and keeps the rows that agree with the filter."
        }
        "Parallel Seq Scan" => {
            "Reads all rows of the table with more than one process. Each process reads a part of the table."
        }
        "Index Scan" => {
            "Finds the rows with an index, then reads each row from the table. This is fast when the condition selects few rows."
        }
        "Index Only Scan" => {
            "Gets the data from the index only. The table is necessary only for rows that changed after the last VACUUM."
        }
        "Bitmap Index Scan" => {
            "Finds the positions of the rows with an index, and keeps them in a bitmap in memory. The step above it reads the rows."
        }
        "Bitmap Heap Scan" => {
            "Reads the rows that the bitmap index scan found, in the sequence of the table on disk. This is good for a medium number of rows."
        }
        "BitmapAnd" => {
            "Combines two or more bitmaps. A row is in the result only if it is in all bitmaps."
        }
        "BitmapOr" => {
            "Combines two or more bitmaps. A row is in the result if it is in one of the bitmaps."
        }
        "Tid Scan" => "Reads rows by their physical position (ctid).",
        "Tid Range Scan" => "Reads the rows in a range of physical positions (ctid).",
        "Subquery Scan" => "Reads the rows of a subquery in the FROM clause.",
        "Function Scan" => "Reads the rows that a function returns, for example generate_series.",
        "Table Function Scan" => "Reads the rows of a table function, for example XMLTABLE.",
        "Values Scan" => "Reads the rows of a VALUES list in the statement.",
        "CTE Scan" => {
            "Reads the rows of a WITH query. The database calculates the WITH query one time and keeps its rows."
        }
        "WorkTable Scan" => "Reads the rows of the last step of a recursive WITH query.",
        "Named Tuplestore Scan" => "Reads the rows of a transition table of a trigger.",
        "Foreign Scan" => "Reads the rows from a foreign table on a different server.",
        "Custom Scan" => "A scan of an extension.",
        "Sample Scan" => "Reads a sample of the table (TABLESAMPLE).",
        "Result" => {
            "Calculates values without a table, or checks a condition that is the same for all rows."
        }
        "ProjectSet" => "Calculates a function that returns more than one row for each input row.",
        "Append" => {
            "Puts the rows of its child steps one after the other, for example for UNION ALL or a partitioned table."
        }
        "Merge Append" => "Combines the sorted rows of its child steps into one sorted result.",
        "Recursive Union" => "Calculates a recursive WITH query.",
        "Nested Loop" => {
            "For each row of the first child step, runs the second child step. This is fast when the first step returns few rows."
        }
        "Merge Join" => {
            "Joins two inputs that are sorted on the join key. It reads each input one time."
        }
        "Hash Join" => {
            "Puts the rows of one input into a hash table in memory, then finds the matching rows for each row of the other input."
        }
        "Hash" => "Makes the hash table for the hash join above it.",
        "Materialize" => {
            "Keeps the rows of its child step in memory, so that the step above can read them again."
        }
        "Memoize" => {
            "Keeps the results of the step below it for each key. A second request with the same key uses the kept result."
        }
        "Sort" => "Sorts the rows, for example for ORDER BY, a merge join, or a GROUP BY.",
        "Incremental Sort" => {
            "Sorts rows that are already sorted on the first keys. It sorts only the groups with the same first keys."
        }
        "Group" => "Makes groups of sorted rows for GROUP BY.",
        "Aggregate" => {
            "Calculates aggregate functions such as count, sum, or avg, for all rows or for each group."
        }
        "WindowAgg" => "Calculates window functions, for example row_number() OVER (...).",
        "Unique" => "Removes rows that are equal to the row before them. The input is sorted.",
        "SetOp" => "Calculates INTERSECT or EXCEPT.",
        "LockRows" => "Locks the rows for SELECT ... FOR UPDATE or FOR SHARE.",
        "Limit" => "Stops after the number of rows of LIMIT. The steps below it can stop early.",
        "Gather" => {
            "Collects the rows of the parallel worker processes. The steps below it run in parallel."
        }
        "Gather Merge" => {
            "Collects the sorted rows of the parallel worker processes, and keeps the sort sequence."
        }
        "ModifyTable" => {
            "Inserts, changes, or deletes the rows (INSERT, UPDATE, DELETE, or MERGE)."
        }
        _ => return None,
    };
    Some(text)
}

/// Returns the group and the explanation of a field. An unknown field goes to a
/// group by its name and has no explanation.
pub(super) fn field_info(key: &str) -> (FieldGroup, Option<&'static str>) {
    if let Some((group, text)) = known_field(key) {
        return (group, Some(text));
    }
    let lower = key.to_lowercase();
    let has_any = |words: &[&str]| words.iter().any(|word| lower.contains(word));
    let group = if has_any(&["blocks", "i/o", "wal "]) {
        FieldGroup::Io
    } else if has_any(&["memory", "batches", "disk", "space", "storage"]) {
        FieldGroup::Memory
    } else if key.starts_with("Actual ") {
        FieldGroup::Measured
    } else {
        FieldGroup::Step
    };
    (group, None)
}

fn known_field(key: &str) -> Option<(FieldGroup, &'static str)> {
    let info = match key {
        "Startup Cost" => (
            FieldGroup::Estimate,
            "The cost before the step can give its first row. The unit is arbitrary: one page read in sequence costs 1.",
        ),
        "Total Cost" => (
            FieldGroup::Estimate,
            "The cost to give all rows, with the cost of the child steps. Compare costs only in the same plan.",
        ),
        "Plan Rows" => (
            FieldGroup::Estimate,
            "The number of rows that the planner expects from one run of this step.",
        ),
        "Plan Width" => (
            FieldGroup::Estimate,
            "The average size of one row in bytes.",
        ),
        "Actual Startup Time" => (
            FieldGroup::Measured,
            "Milliseconds until the first row, for one run of the step, with the child steps.",
        ),
        "Actual Total Time" => (
            FieldGroup::Measured,
            "Milliseconds until the last row, for one run of the step, with the child steps.",
        ),
        "Actual Rows" => (
            FieldGroup::Measured,
            "The average number of rows of one run of the step.",
        ),
        "Actual Loops" => (
            FieldGroup::Measured,
            "How many times the step ran. Multiply the rows and the times by this number to get the total.",
        ),
        "Rows Removed by Filter" => (
            FieldGroup::Measured,
            "Rows that the step read and then removed, because they did not agree with the filter. A large number can mean that an index is missing.",
        ),
        "Rows Removed by Index Recheck" => (
            FieldGroup::Measured,
            "Rows that the step read again and removed. The bitmap was not exact, because it did not fit into work_mem.",
        ),
        "Rows Removed by Join Filter" => (
            FieldGroup::Measured,
            "Row pairs that the join made and then removed, because they did not agree with the join filter.",
        ),
        "Heap Fetches" => (
            FieldGroup::Measured,
            "Rows that an index-only scan read from the table, because the visibility map did not show them as visible. VACUUM decreases this number.",
        ),
        "Exact Heap Blocks" => (
            FieldGroup::Measured,
            "Table pages with an exact list of rows in the bitmap.",
        ),
        "Lossy Heap Blocks" => (
            FieldGroup::Measured,
            "Table pages without an exact list of rows. The step must check each row of these pages. More work_mem prevents this.",
        ),
        "Workers Planned" => (
            FieldGroup::Estimate,
            "The number of parallel worker processes that the planner wants.",
        ),
        "Workers Launched" => (
            FieldGroup::Measured,
            "The number of parallel worker processes that started. It can be less than planned when the server has no free workers.",
        ),
        "Index Searches" => (
            FieldGroup::Measured,
            "How many times the step searched the index.",
        ),
        "Cache Hits" => (FieldGroup::Measured, "Lookups that found a kept result."),
        "Cache Misses" => (
            FieldGroup::Measured,
            "Lookups that did not find a kept result, so the step below ran.",
        ),
        "Cache Evictions" => (
            FieldGroup::Measured,
            "Kept results that the step removed, because the memory was full.",
        ),
        "Cache Overflows" => (
            FieldGroup::Measured,
            "Times the memory was too small for the results of one key.",
        ),
        "Tuples Inserted" => (FieldGroup::Measured, "Rows that the statement inserted."),
        "Conflicting Tuples" => (
            FieldGroup::Measured,
            "Rows that had a conflict (ON CONFLICT).",
        ),
        "Workers" => (
            FieldGroup::Measured,
            "The measured values of each parallel worker process.",
        ),
        "Full-sort Groups" => (
            FieldGroup::Measured,
            "Groups of rows that the incremental sort sorted on all keys.",
        ),
        "Pre-sorted Groups" => (
            FieldGroup::Measured,
            "Groups of rows that the incremental sort sorted only on the last keys.",
        ),
        "Sort Method" => (
            FieldGroup::Memory,
            "How the step sorted. \"quicksort\" is in memory. \"top-N heapsort\" keeps only the first rows. \"external merge\" used temporary files on disk.",
        ),
        "Sort Space Used" => (
            FieldGroup::Memory,
            "The memory or the disk space of the sort, in kilobytes.",
        ),
        "Sort Space Type" => (
            FieldGroup::Memory,
            "Memory: the sort fitted in work_mem. Disk: the sort used temporary files.",
        ),
        "Peak Memory Usage" => (
            FieldGroup::Memory,
            "The largest memory use of the step, in kilobytes.",
        ),
        "Disk Usage" => (
            FieldGroup::Memory,
            "The disk space of temporary files, in kilobytes. More than 0 means that the memory was too small.",
        ),
        "Hash Buckets" => (
            FieldGroup::Memory,
            "The number of entries of the hash table.",
        ),
        "Original Hash Buckets" => (
            FieldGroup::Memory,
            "The number of entries that the planner calculated for the hash table.",
        ),
        "Hash Batches" => (
            FieldGroup::Memory,
            "The number of parts of the hash table. More than 1 means that the hash table did not fit in memory and used the disk.",
        ),
        "Original Hash Batches" => (
            FieldGroup::Memory,
            "The number of parts that the planner calculated.",
        ),
        "HashAgg Batches" => (
            FieldGroup::Memory,
            "The number of parts of the hash aggregate. More than 1 means that it used the disk.",
        ),
        "Planned Partitions" => (
            FieldGroup::Memory,
            "The number of parts that the planner expected for the hash aggregate.",
        ),
        "Storage" => (
            FieldGroup::Memory,
            "Where the step kept its rows: in memory or on disk.",
        ),
        "Maximum Storage" => (
            FieldGroup::Memory,
            "The largest space that the step used to keep rows, in kilobytes.",
        ),
        "Shared Hit Blocks" => (
            FieldGroup::Io,
            "Pages (8 kB) that the step found in the cache of the server. These reads are fast.",
        ),
        "Shared Read Blocks" => (
            FieldGroup::Io,
            "Pages (8 kB) that were not in the cache of the server. The server read them from the operating system or the disk.",
        ),
        "Shared Dirtied Blocks" => (FieldGroup::Io, "Pages in the cache that the step changed."),
        "Shared Written Blocks" => (
            FieldGroup::Io,
            "Changed pages that the step wrote from the cache to the disk.",
        ),
        "Local Hit Blocks" => (
            FieldGroup::Io,
            "Pages of temporary tables that the step found in memory.",
        ),
        "Local Read Blocks" => (
            FieldGroup::Io,
            "Pages of temporary tables that the step read from the disk.",
        ),
        "Local Dirtied Blocks" => (
            FieldGroup::Io,
            "Pages of temporary tables that the step changed.",
        ),
        "Local Written Blocks" => (
            FieldGroup::Io,
            "Pages of temporary tables that the step wrote to the disk.",
        ),
        "Temp Read Blocks" => (
            FieldGroup::Io,
            "Pages of temporary files that the step read, for example of a sort or a hash on disk.",
        ),
        "Temp Written Blocks" => (
            FieldGroup::Io,
            "Pages of temporary files that the step wrote. More than 0 means that work_mem was too small.",
        ),
        "I/O Read Time" => (
            FieldGroup::Io,
            "Milliseconds of block reads. The server gives it only with track_io_timing.",
        ),
        "I/O Write Time" => (
            FieldGroup::Io,
            "Milliseconds of block writes. The server gives it only with track_io_timing.",
        ),
        "Shared I/O Read Time" => (
            FieldGroup::Io,
            "Milliseconds of reads of shared blocks. The server gives it only with track_io_timing.",
        ),
        "Shared I/O Write Time" => (FieldGroup::Io, "Milliseconds of writes of shared blocks."),
        "Local I/O Read Time" => (FieldGroup::Io, "Milliseconds of reads of local blocks."),
        "Local I/O Write Time" => (FieldGroup::Io, "Milliseconds of writes of local blocks."),
        "Temp I/O Read Time" => (FieldGroup::Io, "Milliseconds of reads of temporary files."),
        "Temp I/O Write Time" => (FieldGroup::Io, "Milliseconds of writes of temporary files."),
        "WAL Records" => (
            FieldGroup::Io,
            "Records that the step wrote to the write-ahead log.",
        ),
        "WAL FPI" => (
            FieldGroup::Io,
            "Full page images that the step wrote to the write-ahead log.",
        ),
        "WAL Bytes" => (
            FieldGroup::Io,
            "Bytes that the step wrote to the write-ahead log.",
        ),
        "Parent Relationship" => (
            FieldGroup::Step,
            "The role of this step for the step above it. Outer: the first input. Inner: the second input. SubPlan or InitPlan: a subquery.",
        ),
        "Parallel Aware" => (
            FieldGroup::Step,
            "Yes if the step divides its work between parallel processes.",
        ),
        "Async Capable" => (
            FieldGroup::Step,
            "Yes if the step can run while a different step waits, for example for a foreign server.",
        ),
        "Relation Name" => (FieldGroup::Step, "The table that the step reads."),
        "Schema" => (FieldGroup::Step, "The schema of the table."),
        "Alias" => (FieldGroup::Step, "The name of the table in the statement."),
        "Index Name" => (FieldGroup::Step, "The index that the step uses."),
        "Scan Direction" => (
            FieldGroup::Step,
            "Forward or Backward: the direction in which the step reads the index. Backward is for a descending sort.",
        ),
        "Index Cond" => (
            FieldGroup::Step,
            "The condition that the index finds. Only rows that agree with it are read.",
        ),
        "Recheck Cond" => (
            FieldGroup::Step,
            "The condition that the step checks again on each row, when the bitmap is not exact.",
        ),
        "Filter" => (
            FieldGroup::Step,
            "The condition that the step checks on each row after it read the row. Rows that do not agree are removed.",
        ),
        "One-Time Filter" => (
            FieldGroup::Step,
            "A condition that the step checks one time. If it is false, the step gives no rows.",
        ),
        "Join Type" => (
            FieldGroup::Step,
            "Inner: only matching rows. Left, Right, Full: also rows without a match. Semi: for EXISTS or IN. Anti: for NOT EXISTS.",
        ),
        "Inner Unique" => (
            FieldGroup::Step,
            "Yes if each row of the first input has a maximum of one match. Then the join can stop after the first match.",
        ),
        "Hash Cond" => (
            FieldGroup::Step,
            "The condition that the hash table uses to find the matching rows.",
        ),
        "Merge Cond" => (
            FieldGroup::Step,
            "The condition of the merge join. The two inputs are sorted on it.",
        ),
        "Join Filter" => (
            FieldGroup::Step,
            "A join condition that the step checks on each row pair after the join.",
        ),
        "Sort Key" => (FieldGroup::Step, "The columns of the sort."),
        "Presorted Key" => (
            FieldGroup::Step,
            "The columns on which the input is already sorted.",
        ),
        "Group Key" => (FieldGroup::Step, "The columns of GROUP BY."),
        "Strategy" => (
            FieldGroup::Step,
            "Plain: one group for all rows. Sorted: groups from sorted rows. Hashed: groups with a hash table. Mixed: more than one grouping set.",
        ),
        "Partial Mode" => (
            FieldGroup::Step,
            "Simple: one aggregate step. Partial and Finalize: the parallel processes calculate parts, and a last step combines them.",
        ),
        "Output" => (
            FieldGroup::Step,
            "The columns and expressions that the step gives to the step above it.",
        ),
        "Subplan Name" => (FieldGroup::Step, "The name of the subquery of this step."),
        "CTE Name" => (FieldGroup::Step, "The name of the WITH query."),
        "Function Name" => (FieldGroup::Step, "The function that gives the rows."),
        "Single Copy" => (
            FieldGroup::Step,
            "Yes if only one process runs the parallel part.",
        ),
        "Operation" => (
            FieldGroup::Step,
            "The change: Insert, Update, Delete, or Merge.",
        ),
        "Cache Key" => (
            FieldGroup::Step,
            "The values that the memoize step uses to find kept results.",
        ),
        "Cache Mode" => (
            FieldGroup::Step,
            "Logical or binary: how the step compares the keys.",
        ),
        "Conflict Resolution" => (
            FieldGroup::Step,
            "What ON CONFLICT does: NOTHING or UPDATE.",
        ),
        "Sampling Method" => (FieldGroup::Step, "The method of TABLESAMPLE."),
        "Command" => (FieldGroup::Step, "The command of INTERSECT or EXCEPT."),
        _ => return None,
    };
    Some(info)
}

/// Returns the explanation of a field of the complete plan, or `None`.
pub(super) fn total_text(key: &str) -> Option<&'static str> {
    let text = match key {
        "Planning" => "The block reads of the planner, for example of the system catalog.",
        "Triggers" => "The triggers that ran, and their times.",
        "JIT" => {
            "The just-in-time compilation of expressions. For a short statement, it can cost more time than it saves."
        }
        "Settings" => {
            "Server settings with a value different from the default that change the plan."
        }
        _ => return None,
    };
    Some(text)
}

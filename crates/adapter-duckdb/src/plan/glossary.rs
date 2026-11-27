//! Plain explanations of the operations, the fields, and the totals of a DuckDB plan.
//! The texts come from the glossary of the UI (`ui/src/plan/planGlossary.ts`).

use tabloxide_core::FieldGroup;

/// The explanations of the DuckDB operations, by name.
const OPERATIONS: &[(&str, &str)] = &[
    (
        "TABLE_SCAN",
        "Reads the columns of a table that the statement needs. DuckDB stores each column separately, so it reads only these columns.",
    ),
    (
        "SEQ_SCAN",
        "Reads the columns of a table that the statement needs.",
    ),
    ("READ_CSV", "Reads the rows of a CSV file."),
    (
        "READ_CSV_AUTO",
        "Reads the rows of a CSV file. DuckDB finds the format of the file.",
    ),
    ("READ_PARQUET", "Reads the rows of a Parquet file."),
    ("READ_JSON", "Reads the rows of a JSON file."),
    (
        "COLUMN_DATA_SCAN",
        "Reads rows that DuckDB keeps in memory, for example a VALUES list.",
    ),
    (
        "DUMMY_SCAN",
        "Gives one empty row, for a statement without a table.",
    ),
    (
        "EMPTY_RESULT",
        "Gives no rows. DuckDB knows that the result is empty.",
    ),
    (
        "CHUNK_SCAN",
        "Reads rows that a different step keeps in memory.",
    ),
    (
        "DELIM_SCAN",
        "Reads the distinct values of a correlated subquery.",
    ),
    (
        "CTE",
        "Calculates a WITH query one time and keeps its rows.",
    ),
    ("CTE_SCAN", "Reads the kept rows of a WITH query."),
    (
        "FILTER",
        "Keeps only the rows that agree with the condition.",
    ),
    (
        "PROJECTION",
        "Calculates the columns of the result, or puts the columns in a different sequence.",
    ),
    (
        "HASH_JOIN",
        "Puts the rows of one input into a hash table in memory, then finds the matching rows for each row of the other input.",
    ),
    (
        "NESTED_LOOP_JOIN",
        "Compares each row of one input with each row of the other input.",
    ),
    (
        "BLOCKWISE_NL_JOIN",
        "Compares blocks of rows of the two inputs. DuckDB uses it for conditions without equality.",
    ),
    (
        "PIECEWISE_MERGE_JOIN",
        "Sorts the two inputs and joins them on a condition such as < or >.",
    ),
    (
        "IE_JOIN",
        "Joins on two inequality conditions, for example a range join.",
    ),
    (
        "ASOF_JOIN",
        "Finds for each row the nearest row of the other input (ASOF JOIN).",
    ),
    (
        "POSITIONAL_JOIN",
        "Joins the rows of the two inputs by their position.",
    ),
    (
        "CROSS_PRODUCT",
        "Combines each row of one input with each row of the other input.",
    ),
    ("DELIM_JOIN", "Calculates a correlated subquery as a join."),
    (
        "LEFT_DELIM_JOIN",
        "Calculates a correlated subquery as a join.",
    ),
    (
        "RIGHT_DELIM_JOIN",
        "Calculates a correlated subquery as a join.",
    ),
    (
        "HASH_GROUP_BY",
        "Makes groups with a hash table, and calculates the aggregate functions of each group.",
    ),
    (
        "PERFECT_HASH_GROUP_BY",
        "Makes groups with an array, because the group keys have a small known range. This is faster than a hash table.",
    ),
    (
        "UNGROUPED_AGGREGATE",
        "Calculates aggregate functions for all rows, without GROUP BY.",
    ),
    (
        "SIMPLE_AGGREGATE",
        "Calculates aggregate functions for all rows, without GROUP BY.",
    ),
    (
        "STREAMING_WINDOW",
        "Calculates window functions while the rows come.",
    ),
    (
        "WINDOW",
        "Calculates window functions, for example row_number() OVER (...).",
    ),
    ("ORDER_BY", "Sorts the rows."),
    (
        "TOP_N",
        "Keeps only the first rows of the sort sequence, for ORDER BY with LIMIT. It does not sort all rows.",
    ),
    ("LIMIT", "Stops after the number of rows of LIMIT."),
    (
        "STREAMING_LIMIT",
        "Stops after the number of rows of LIMIT, while the rows come.",
    ),
    ("LIMIT_PERCENT", "Stops after a percentage of the rows."),
    (
        "UNION",
        "Puts the rows of its two inputs one after the other.",
    ),
    ("UNNEST", "Makes one row for each element of a list."),
    (
        "INOUT_FUNCTION",
        "Calls a table function for each input row.",
    ),
    (
        "TABLE_FUNCTION",
        "Reads the rows that a table function returns.",
    ),
    ("INSERT", "Inserts the rows into the table."),
    ("UPDATE", "Changes the rows of the table."),
    ("DELETE", "Deletes the rows of the table."),
];

/// The groups and the explanations of the DuckDB fields, by name. `Join Type` is a
/// PostgreSQL name, but DuckDB uses it too.
const FIELDS: &[(&str, FieldGroup, &str)] = &[
    (
        "Join Type",
        FieldGroup::Step,
        "Inner: only matching rows. Left, Right, Full: also rows without a match. Semi: for EXISTS or IN. Anti: for NOT EXISTS.",
    ),
    (
        "Projections",
        FieldGroup::Step,
        "The columns that the step gives to the step above it. #0 is the first column of the input.",
    ),
    (
        "Filters",
        FieldGroup::Step,
        "The conditions that the scan checks while it reads. DuckDB can skip parts of the table with them.",
    ),
    (
        "Dynamic Filters",
        FieldGroup::Step,
        "Conditions that a join gives to the scan while the statement runs. The scan can then skip rows early.",
    ),
    (
        "Expression",
        FieldGroup::Step,
        "The condition of the filter.",
    ),
    ("Conditions", FieldGroup::Step, "The join conditions."),
    ("Aggregates", FieldGroup::Step, "The aggregate functions."),
    (
        "Groups",
        FieldGroup::Step,
        "The group keys. #0 is the first column of the input.",
    ),
    ("Order By", FieldGroup::Step, "The columns of the sort."),
    ("Type", FieldGroup::Step, "The kind of scan."),
    ("Function", FieldGroup::Step, "The table function."),
    (
        "rows_scanned",
        FieldGroup::Measured,
        "The number of rows that the scan read before the filters.",
    ),
    (
        "intermediate_size_bytes",
        FieldGroup::Measured,
        "The size of the rows that the step gave, in bytes.",
    ),
    (
        "row_groups_scanned",
        FieldGroup::Measured,
        "Row groups that the scan read. DuckDB stores a table in row groups of about 122,880 rows.",
    ),
    (
        "total_row_groups_to_scan",
        FieldGroup::Measured,
        "Row groups that the scan could read. If this is more than the read groups, DuckDB skipped some with the filters.",
    ),
    (
        "result_set_size",
        FieldGroup::Measured,
        "The size of the result of the step, in bytes.",
    ),
    (
        "cpu_time",
        FieldGroup::Measured,
        "The processor time of the step, in seconds.",
    ),
    (
        "operator_rows_scanned",
        FieldGroup::Measured,
        "The number of rows that the scan read before the filters.",
    ),
];

/// The explanations of the fields of the complete statement, by name.
const TOTALS: &[(&str, &str)] = &[
    (
        "query.cpu_time",
        "The processor time of all threads, in seconds.",
    ),
    (
        "query.total_time",
        "The time of the complete statement, in seconds.",
    ),
    ("query.total_rows_scanned", "The rows that all scans read."),
    (
        "query.total_intermediate_rows",
        "The rows that all steps gave to the next step.",
    ),
    (
        "query.total_row_groups_scanned",
        "The row groups that all scans read.",
    ),
    (
        "system.peak_buffer_memory",
        "The largest memory use, in bytes.",
    ),
    (
        "system.total_memory_allocated",
        "The memory that DuckDB reserved, in bytes.",
    ),
    (
        "system.peak_temp_dir_size",
        "The largest size of the temporary files, in bytes. More than 0 means that the memory was too small.",
    ),
    (
        "system.blocked_thread_time",
        "The time that the threads waited, in seconds.",
    ),
    (
        "io.total_bytes_read",
        "Bytes that DuckDB read from the disk.",
    ),
    (
        "io.total_bytes_written",
        "Bytes that DuckDB wrote to the disk.",
    ),
    (
        "planner.total_time",
        "The time to make the logical plan, in seconds.",
    ),
    (
        "physical_planner.total_time",
        "The time to make the physical plan, in seconds.",
    ),
];

/// Returns the explanation of an operation, or `None` for an unknown operation.
pub(super) fn operation_text(operation: &str) -> Option<&'static str> {
    OPERATIONS
        .iter()
        .find(|(name, _)| *name == operation)
        .map(|(_, text)| *text)
}

/// Words in the name of an unknown field that show reads and writes.
const IO_WORDS: &[&str] = &["blocks", "i/o", "wal "];
/// Words in the name of an unknown field that show memory or disk space.
const MEMORY_WORDS: &[&str] = &["memory", "batches", "disk", "space", "storage"];

/// Returns the group and the explanation of a field. An unknown field goes to a
/// group by the words of its name, and has no explanation.
pub(super) fn field_info(name: &str) -> (FieldGroup, Option<&'static str>) {
    if let Some((_, group, text)) = FIELDS.iter().find(|(known, _, _)| *known == name) {
        return (*group, Some(*text));
    }
    let lower = name.to_lowercase();
    let has_word = |words: &[&str]| words.iter().any(|word| lower.contains(word));
    let group = if has_word(IO_WORDS) {
        FieldGroup::Io
    } else if has_word(MEMORY_WORDS) {
        FieldGroup::Memory
    } else if name.starts_with("Actual ") {
        FieldGroup::Measured
    } else {
        FieldGroup::Step
    };
    (group, None)
}

/// Returns the explanation of a field of the complete statement, or `None`.
pub(super) fn total_text(name: &str) -> Option<&'static str> {
    TOTALS
        .iter()
        .find(|(known, _)| *known == name)
        .map(|(_, text)| *text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explains_the_operations_of_duckdb() {
        assert!(operation_text("HASH_JOIN").is_some_and(|text| text.contains("hash table")));
        assert_eq!(operation_text("Hash Join"), None);
    }

    #[test]
    fn puts_each_field_into_a_group_and_explains_the_known_fields() {
        assert_eq!(field_info("rows_scanned").0, FieldGroup::Measured);
        assert!(
            field_info("Filters")
                .1
                .is_some_and(|text| text.contains("skip parts"))
        );
        assert_eq!(field_info("Some New Blocks"), (FieldGroup::Io, None));
        assert_eq!(field_info("Actual Something"), (FieldGroup::Measured, None));
        assert_eq!(field_info("peak memory"), (FieldGroup::Memory, None));
        assert_eq!(field_info("Unknown"), (FieldGroup::Step, None));
        assert!(
            total_text("system.peak_temp_dir_size")
                .is_some_and(|text| text.contains("temporary files"))
        );
    }
}

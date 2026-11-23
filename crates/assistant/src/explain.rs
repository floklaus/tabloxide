//! The statement that reads the execution plan of a different statement.

use serde::Serialize;
use tabloxide_core::sql::{first_keyword, has_word, is_pageable, split_statements};
use tabloxide_core::{Engine, Row};

/// Why the application does not read a plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, thiserror::Error)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
pub enum ExplainRejection {
    #[error("There is no statement. Put the cursor in a statement, or select one.")]
    NoStatement,
    #[error("A plan is for one statement. Select only one statement.")]
    ManyStatements,
    #[error("The statement starts with EXPLAIN. Remove EXPLAIN. The application adds it.")]
    AlreadyExplain,
    #[error(
        "The application makes a plan only for a statement that starts with SELECT, WITH, \
         VALUES, TABLE, FROM, INSERT, UPDATE, DELETE, or MERGE."
    )]
    NotExplainable,
    #[error(
        "EXPLAIN ANALYZE runs the statement. Thus it is available only for a statement \
         that reads data. Use EXPLAIN without ANALYZE for this statement."
    )]
    AnalyzeChangesData,
}

/// First keywords of the statements for which the application reads a plan.
///
/// The list does not have `EXPLAIN` and `ANALYZE`. With such a first word, the database
/// would read the added `EXPLAIN` as `EXPLAIN ANALYZE` and would run the statement.
const EXPLAINABLE: [&str; 11] = [
    "select", "with", "values", "table", "from", "pivot", "unpivot", "insert", "update", "delete",
    "merge",
];

/// Returns the statement that reads the plan of the one statement in `sql`.
///
/// Without `analyze`, the database does not run the statement. With `analyze`, the
/// database runs it and measures the time. Thus `analyze` is permitted only for a
/// statement that reads data.
///
/// # Errors
///
/// Returns the reason if `sql` does not have exactly one statement, if the statement
/// is an `EXPLAIN`, or if `analyze` would change data.
pub fn explain_statement(sql: &str, analyze: bool) -> Result<String, ExplainRejection> {
    let spans = split_statements(sql);
    let statement = match spans.as_slice() {
        [] => return Err(ExplainRejection::NoStatement),
        [span] => sql[span.start..span.end]
            .trim()
            .trim_end_matches(';')
            .trim(),
        _ => return Err(ExplainRejection::ManyStatements),
    };
    if statement.is_empty() {
        return Err(ExplainRejection::NoStatement);
    }
    let first = first_keyword(statement).ok_or(ExplainRejection::NotExplainable)?;
    if first == "explain" {
        return Err(ExplainRejection::AlreadyExplain);
    }
    if !EXPLAINABLE.contains(&first.as_str()) {
        return Err(ExplainRejection::NotExplainable);
    }
    if !analyze {
        return Ok(format!("EXPLAIN {statement}"));
    }
    // `SELECT ... INTO` makes a table in PostgreSQL.
    if !is_pageable(statement) || has_word(statement, "into") {
        return Err(ExplainRejection::AnalyzeChangesData);
    }
    Ok(format!("EXPLAIN ANALYZE {statement}"))
}

/// Returns the statement that reads the plan of the one statement in `sql` as JSON.
/// PostgreSQL and DuckDB accept the same options. The checks are the same as for
/// [`explain_statement`].
///
/// # Errors
///
/// Returns the reason if [`explain_statement`] rejects `sql`.
pub fn explain_json_statement(
    sql: &str,
    analyze: bool,
    engine: Engine,
) -> Result<String, ExplainRejection> {
    let text = explain_statement(sql, analyze)?;
    // PostgreSQL adds the output columns with VERBOSE, and the block reads of the
    // cache and the disk with BUFFERS. DuckDB does not know these options.
    let (prefix, options) = match (engine, analyze) {
        (Engine::Postgres, true) => (
            "EXPLAIN ANALYZE ",
            "EXPLAIN (ANALYZE, VERBOSE, BUFFERS, FORMAT JSON) ",
        ),
        (Engine::Postgres, false) => ("EXPLAIN ", "EXPLAIN (VERBOSE, FORMAT JSON) "),
        (Engine::Duckdb, true) => ("EXPLAIN ANALYZE ", "EXPLAIN (ANALYZE, FORMAT JSON) "),
        (Engine::Duckdb, false) => ("EXPLAIN ", "EXPLAIN (FORMAT JSON) "),
    };
    // `explain_statement` always starts its text with the prefix.
    let statement = text.strip_prefix(prefix).unwrap_or(&text);
    Ok(format!("{options}{statement}"))
}

/// Returns the JSON text of a plan from the rows of an `EXPLAIN (FORMAT JSON)` result.
/// PostgreSQL gives one cell. DuckDB gives a name and the plan, and the plan is last.
#[must_use]
pub fn plan_json(rows: &[Row]) -> Option<String> {
    rows.first()?.iter().rev().flatten().next().cloned()
}

/// Returns the text of a plan from the rows of an `EXPLAIN` result.
/// Each cell that has a value becomes one or more lines.
#[must_use]
pub fn plan_text(rows: &[Row]) -> String {
    rows.iter()
        .flat_map(|row| row.iter().flatten())
        .map(|cell| cell.trim_end())
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_explain_to_one_statement() {
        assert_eq!(
            explain_statement("select * from t where a = 1;\n", false).unwrap(),
            "EXPLAIN select * from t where a = 1"
        );
    }

    #[test]
    fn adds_explain_analyze_to_a_statement_that_reads_data() {
        assert_eq!(
            explain_statement("with x as (select 1) select * from x", true).unwrap(),
            "EXPLAIN ANALYZE with x as (select 1) select * from x"
        );
    }

    #[test]
    fn explain_without_analyze_accepts_a_statement_that_changes_data() {
        assert_eq!(
            explain_statement("delete from t where a = 1", false).unwrap(),
            "EXPLAIN delete from t where a = 1"
        );
    }

    #[test]
    fn analyze_rejects_a_statement_that_changes_data() {
        for sql in [
            "delete from t",
            "update t set a = 1",
            "insert into t values (1)",
            "with gone as (delete from t returning *) select * from gone",
            "select * into copy_of_t from t",
        ] {
            assert_eq!(
                explain_statement(sql, true),
                Err(ExplainRejection::AnalyzeChangesData),
                "{sql}"
            );
        }
    }

    #[test]
    fn asks_postgres_for_the_plan_as_json_with_all_details() {
        assert_eq!(
            explain_json_statement("select * from t;", false, Engine::Postgres).unwrap(),
            "EXPLAIN (VERBOSE, FORMAT JSON) select * from t"
        );
        assert_eq!(
            explain_json_statement("select * from t", true, Engine::Postgres).unwrap(),
            "EXPLAIN (ANALYZE, VERBOSE, BUFFERS, FORMAT JSON) select * from t"
        );
        assert_eq!(
            explain_json_statement("delete from t", true, Engine::Postgres),
            Err(ExplainRejection::AnalyzeChangesData)
        );
    }

    #[test]
    fn asks_duckdb_for_the_plan_as_json_without_postgres_options() {
        assert_eq!(
            explain_json_statement("select * from t;", false, Engine::Duckdb).unwrap(),
            "EXPLAIN (FORMAT JSON) select * from t"
        );
        assert_eq!(
            explain_json_statement("select * from t", true, Engine::Duckdb).unwrap(),
            "EXPLAIN (ANALYZE, FORMAT JSON) select * from t"
        );
    }

    #[test]
    fn reads_the_json_of_the_two_engines() {
        let postgres = vec![vec![Some("[{\"Plan\": {}}]".to_owned())]];
        let duckdb = vec![vec![
            Some("physical_plan".to_owned()),
            Some("[{\"name\": \"SEQ_SCAN\"}]".to_owned()),
        ]];

        assert_eq!(plan_json(&postgres).as_deref(), Some("[{\"Plan\": {}}]"));
        assert_eq!(
            plan_json(&duckdb).as_deref(),
            Some("[{\"name\": \"SEQ_SCAN\"}]")
        );
        assert_eq!(plan_json(&[]), None);
    }

    #[test]
    fn rejects_a_statement_that_is_an_explain() {
        assert_eq!(
            explain_statement("EXPLAIN ANALYZE delete from t", false),
            Err(ExplainRejection::AlreadyExplain)
        );
        assert_eq!(
            explain_statement("explain select 1", true),
            Err(ExplainRejection::AlreadyExplain)
        );
    }

    #[test]
    fn a_first_word_that_changes_the_meaning_of_explain_never_runs() {
        for sql in [
            "ANALYZE delete from item where id = 1",
            "analyze select 1",
            "(analyze) delete from item",
            "(analyze, verbose) select 1",
            "verbose delete from item",
            "-- note\nanalyze delete from item",
            "drop table item",
        ] {
            for analyze in [false, true] {
                assert_eq!(
                    explain_statement(sql, analyze),
                    Err(ExplainRejection::NotExplainable),
                    "{sql}"
                );
            }
        }
    }

    #[test]
    fn a_comment_before_explain_does_not_hide_it() {
        assert_eq!(
            explain_statement("/* c */ explain analyze delete from t", false),
            Err(ExplainRejection::AlreadyExplain)
        );
    }

    #[test]
    fn rejects_no_statement_and_many_statements() {
        assert_eq!(
            explain_statement("  \n", false),
            Err(ExplainRejection::NoStatement)
        );
        assert_eq!(
            explain_statement("select 1; select 2", false),
            Err(ExplainRejection::ManyStatements)
        );
    }

    #[test]
    fn the_plan_text_has_one_line_for_each_cell_with_a_value() {
        let rows: Vec<Row> = vec![
            vec![Some("Seq Scan on t  ".to_owned())],
            vec![None],
            vec![Some("  Filter: (a = 1)".to_owned())],
        ];

        assert_eq!(plan_text(&rows), "Seq Scan on t\n  Filter: (a = 1)");
    }
}

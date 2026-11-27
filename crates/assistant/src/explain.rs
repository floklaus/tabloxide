//! The statement that reads the execution plan of a different statement.

use serde::Serialize;
use tabloxide_core::sql::{first_keyword, has_word, is_pageable, split_statements};
use tabloxide_core::{QueryLanguage, Row};

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
        "Explain and measure runs the statement. Thus it is available only for a statement \
         that reads data. Use Explain for this statement."
    )]
    AnalyzeChangesData,
    #[error("The engine of this connection cannot measure a plan. Use Explain.")]
    NoMeasuredPlan,
    #[error(
        "A plan with measured times runs the statement. Thus it is available only for a \
         statement that reads data. Read the plan without measured times."
    )]
    MeasureChangesData,
    #[error("The engine of this connection gives no execution plan.")]
    NoPlan,
}

/// Returns the one statement of `text` for the plan read of a connector.
///
/// The connector runs the statement for `measure`. Thus `measure` is permitted only
/// for a statement that the language marks as a read.
///
/// # Errors
///
/// Returns the reason if `text` does not have exactly one statement, or if `measure`
/// would run a statement that changes data.
pub fn plan_statement(
    language: QueryLanguage,
    text: &str,
    measure: bool,
) -> Result<String, ExplainRejection> {
    let spans = language.split(text);
    let statement = match spans.as_slice() {
        [] => return Err(ExplainRejection::NoStatement),
        [span] => text[span.start..span.end]
            .trim()
            .trim_end_matches(';')
            .trim(),
        _ => return Err(ExplainRejection::ManyStatements),
    };
    if statement.is_empty() {
        return Err(ExplainRejection::NoStatement);
    }
    if measure && !language.is_pageable(statement) {
        return Err(ExplainRejection::MeasureChangesData);
    }
    Ok(statement.to_owned())
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

/// Returns the one statement of `text` for the plan read of an adapter or a
/// connector, without `EXPLAIN`. The engine adds what it needs.
///
/// An SQL statement gets the checks of [`explain_statement`]. A statement of a
/// different language gets the checks of [`plan_statement`]. Thus a measured plan
/// is permitted only for a statement that reads data.
///
/// # Errors
///
/// Returns the reason if the statement does not pass the checks.
pub fn checked_plan_statement(
    language: QueryLanguage,
    text: &str,
    measure: bool,
) -> Result<String, ExplainRejection> {
    if language != QueryLanguage::Sql {
        return plan_statement(language, text, measure);
    }
    let explain = explain_statement(text, measure)?;
    let prefix = if measure {
        "EXPLAIN ANALYZE "
    } else {
        "EXPLAIN "
    };
    // `explain_statement` always starts its text with the prefix.
    Ok(explain.strip_prefix(prefix).unwrap_or(&explain).to_owned())
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

    #[test]
    fn a_connector_plan_reads_one_statement_and_measures_only_a_read() {
        let mongo = QueryLanguage::MongodbShell;

        assert_eq!(
            plan_statement(mongo, "db.users.find({ a: 1 });", true),
            Ok("db.users.find({ a: 1 })".to_owned())
        );
        assert_eq!(
            plan_statement(mongo, "db.users.deleteMany({ a: 1 })", false),
            Ok("db.users.deleteMany({ a: 1 })".to_owned())
        );
        assert_eq!(
            plan_statement(mongo, "db.users.deleteMany({ a: 1 })", true),
            Err(ExplainRejection::MeasureChangesData)
        );
        assert_eq!(
            plan_statement(mongo, "db.a.find()\ndb.b.find()", false),
            Err(ExplainRejection::ManyStatements)
        );
        assert_eq!(
            plan_statement(mongo, "  ", false),
            Err(ExplainRejection::NoStatement)
        );
    }

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
    fn an_sql_plan_statement_has_no_explain_and_keeps_the_checks() {
        let sql = QueryLanguage::Sql;

        assert_eq!(
            checked_plan_statement(sql, "select * from t;", false),
            Ok("select * from t".to_owned())
        );
        assert_eq!(
            checked_plan_statement(sql, "select * from t", true),
            Ok("select * from t".to_owned())
        );
        assert_eq!(
            checked_plan_statement(sql, "delete from t", true),
            Err(ExplainRejection::AnalyzeChangesData)
        );
        assert_eq!(
            checked_plan_statement(sql, "explain select 1", false),
            Err(ExplainRejection::AlreadyExplain)
        );
    }

    #[test]
    fn a_plan_statement_of_a_different_language_uses_its_language() {
        let mongo = QueryLanguage::MongodbShell;

        assert_eq!(
            checked_plan_statement(mongo, "db.a.deleteMany({})", true),
            Err(ExplainRejection::MeasureChangesData)
        );
        assert_eq!(
            checked_plan_statement(mongo, "db.a.find()", true),
            Ok("db.a.find()".to_owned())
        );
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

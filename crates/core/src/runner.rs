//! Runs the statements of a script in sequence on a session.

use crate::sql::{
    Location, Risk, Span, byte_to_utf16, char_to_byte, classify_risk, is_pageable, locate,
    split_statements, statement_at, utf16_to_byte,
};
use crate::{Column, QueryError, ResultStream, Row, Session};
use serde::{Deserialize, Serialize};
use std::time::Instant;

/// The part of a script to run. Offsets are in UTF-16 code units, as in the editor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum RunTarget {
    /// All statements.
    All,
    /// The statement at the cursor.
    At { offset: u32 },
    /// The statements in the selection.
    Range { from: u32, to: u32 },
}

/// Row limits for one run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RunLimits {
    /// Number of rows in the first page of a paged result.
    pub page_rows: usize,
    /// Maximum number of rows that the runner keeps from a result that is not paged.
    pub buffered_rows: usize,
}

/// A range in the script, in UTF-16 code units.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct TextRange {
    pub from: u32,
    pub to: u32,
}

/// The result of one statement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Outcome {
    /// The statement returned rows.
    Rows {
        columns: Vec<Column>,
        rows: Vec<Row>,
        /// `false` if the result is open and has more rows to fetch.
        is_complete: bool,
        /// Number of rows that the statement returned. `None` while the result is open.
        #[cfg_attr(feature = "specta", specta(type = Option<u32>))]
        total_rows: Option<u64>,
    },
    /// The statement returned no rows.
    Command {
        #[cfg_attr(feature = "specta", specta(type = u32))]
        affected_rows: u64,
    },
    /// The statement failed. `location` is the error position in the script.
    Failed {
        error: QueryError,
        location: Option<Location>,
    },
}

/// The report for one statement of a run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct StatementReport {
    pub range: TextRange,
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub elapsed_ms: u64,
    pub outcome: Outcome,
}

/// The result of a run. `open` is the result stream of the last statement, if it has more rows.
pub struct RunOutput {
    pub statements: Vec<StatementReport>,
    pub open: Option<Box<dyn ResultStream>>,
}

fn target_spans(sql: &str, target: RunTarget) -> Vec<Span> {
    match target {
        RunTarget::All => split_statements(sql),
        RunTarget::At { offset } => statement_at(sql, utf16_to_byte(sql, offset))
            .into_iter()
            .collect(),
        RunTarget::Range { from, to } => {
            let start = utf16_to_byte(sql, from.min(to));
            let end = utf16_to_byte(sql, from.max(to));
            split_statements(&sql[start..end])
                .into_iter()
                .map(|span| Span {
                    start: span.start + start,
                    end: span.end + start,
                })
                .collect()
        }
    }
}

/// One statement that a run would execute.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct StatementPreview {
    pub range: TextRange,
    /// Has a value if the statement is destructive.
    pub risk: Option<Risk>,
}

fn text_range(sql: &str, span: Span) -> TextRange {
    TextRange {
        from: byte_to_utf16(sql, span.start),
        to: byte_to_utf16(sql, span.end),
    }
}

/// Returns the statements that `target` selects from `sql`, with the risk of each.
/// The function does not run a statement. The UI uses it to ask for a confirmation.
#[must_use]
pub fn preview_run(sql: &str, target: RunTarget) -> Vec<StatementPreview> {
    target_spans(sql, target)
        .into_iter()
        .map(|span| StatementPreview {
            range: text_range(sql, span),
            risk: classify_risk(&sql[span.start..span.end]),
        })
        .collect()
}

fn error_location(sql: &str, span: Span, error: &QueryError) -> Option<Location> {
    let position = usize::try_from(error.position?).ok()?;
    let statement = &sql[span.start..span.end];
    let offset = char_to_byte(statement, position.saturating_sub(1));
    Some(locate(sql, span.start + offset))
}

/// Reads a result to its end. Keeps the first `limit` rows and counts the others.
async fn read_all(
    stream: &mut dyn ResultStream,
    page_rows: usize,
    limit: usize,
) -> Result<(Vec<Row>, u64), QueryError> {
    let mut rows: Vec<Row> = Vec::new();
    loop {
        let page = stream.next_page(page_rows).await?;
        let free = limit - rows.len();
        rows.extend(page.rows.into_iter().take(free));
        if let Some(end) = page.end {
            return Ok((rows, end.affected_rows));
        }
    }
}

async fn run_statement(
    session: &mut dyn Session,
    statement: &str,
    can_stay_open: bool,
    limits: RunLimits,
) -> Result<(Outcome, Option<Box<dyn ResultStream>>), QueryError> {
    let mut stream = session.execute(statement).await?;
    let Some(columns) = stream.columns().map(<[Column]>::to_vec) else {
        let (_, affected_rows) = read_all(stream.as_mut(), limits.page_rows, 0).await?;
        return Ok((Outcome::Command { affected_rows }, None));
    };
    if can_stay_open && is_pageable(statement) {
        let page = stream.next_page(limits.page_rows).await?;
        let outcome = Outcome::Rows {
            columns,
            rows: page.rows,
            is_complete: page.end.is_some(),
            total_rows: page.end.map(|end| end.affected_rows),
        };
        return Ok((outcome, page.end.is_none().then_some(stream)));
    }
    let (rows, total) = read_all(stream.as_mut(), limits.page_rows, limits.buffered_rows).await?;
    let outcome = Outcome::Rows {
        columns,
        rows,
        is_complete: true,
        total_rows: Some(total),
    };
    Ok((outcome, None))
}

/// Runs the statements that `target` selects from `sql`. Stops at the first failure.
///
/// Only the last statement can stay open for paged reads, and only if it reads data.
/// The runner reads each other result to its end and keeps a bounded number of rows.
pub async fn run_script(
    session: &mut dyn Session,
    sql: &str,
    target: RunTarget,
    limits: RunLimits,
) -> RunOutput {
    let spans = target_spans(sql, target);
    let mut statements = Vec::with_capacity(spans.len());
    let mut open = None;
    for (index, span) in spans.iter().enumerate() {
        let is_last = index + 1 == spans.len();
        let statement = &sql[span.start..span.end];
        let start = Instant::now();
        let result = run_statement(session, statement, is_last, limits).await;
        let is_failure = result.is_err();
        let outcome = match result {
            Ok((outcome, stream)) => {
                open = stream;
                outcome
            }
            Err(error) => Outcome::Failed {
                location: error_location(sql, *span, &error),
                error,
            },
        };
        statements.push(StatementReport {
            range: text_range(sql, *span),
            elapsed_ms: u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX),
            outcome,
        });
        if is_failure {
            break;
        }
    }
    RunOutput { statements, open }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::QueryErrorKind;
    use crate::testing::{Scripted, ScriptedSession};

    const LIMITS: RunLimits = RunLimits {
        page_rows: 10,
        buffered_rows: 25,
    };

    async fn run(answers: Vec<Scripted>, sql: &str, target: RunTarget) -> (RunOutput, Vec<String>) {
        let (mut session, probe) = ScriptedSession::new(answers);
        let output = run_script(&mut session, sql, target, LIMITS).await;
        let executed = probe.executed.lock().unwrap().clone();
        (output, executed)
    }

    fn row_count(outcome: &Outcome) -> usize {
        match outcome {
            Outcome::Rows { rows, .. } => rows.len(),
            other => panic!("not a row result: {other:?}"),
        }
    }

    #[tokio::test]
    async fn runs_all_statements_in_sequence() {
        let answers = vec![Scripted::Command(3), Scripted::Rows(2)];

        let (output, executed) = run(answers, "update t set a = 1; select 1", RunTarget::All).await;

        assert_eq!(executed, vec!["update t set a = 1", "select 1"]);
        assert_eq!(
            output.statements[0].outcome,
            Outcome::Command { affected_rows: 3 }
        );
        assert_eq!(output.statements[0].range, TextRange { from: 0, to: 18 });
        assert_eq!(output.statements[1].range, TextRange { from: 20, to: 28 });
        assert!(matches!(
            output.statements[1].outcome,
            Outcome::Rows {
                is_complete: true,
                total_rows: Some(2),
                ..
            }
        ));
        assert!(output.open.is_none());
    }

    #[tokio::test]
    async fn the_last_read_statement_stays_open_after_the_first_page() {
        let (output, _) = run(vec![Scripted::Rows(1000)], "select 1", RunTarget::All).await;

        let outcome = &output.statements[0].outcome;
        assert_eq!(row_count(outcome), 10);
        assert!(matches!(
            outcome,
            Outcome::Rows {
                is_complete: false,
                total_rows: None,
                ..
            }
        ));
        assert!(output.open.is_some());
    }

    #[tokio::test]
    async fn a_statement_before_the_last_is_read_to_its_end() {
        let answers = vec![Scripted::Rows(1000), Scripted::Command(0)];

        let (output, _) = run(answers, "select 1; set a = 1", RunTarget::All).await;

        let outcome = &output.statements[0].outcome;
        assert_eq!(row_count(outcome), 25);
        assert!(matches!(
            outcome,
            Outcome::Rows {
                is_complete: true,
                total_rows: Some(1000),
                ..
            }
        ));
        assert!(output.open.is_none());
    }

    #[tokio::test]
    async fn a_statement_that_changes_data_does_not_stay_open() {
        let sql = "delete from t returning *";

        let (output, _) = run(vec![Scripted::Rows(1000)], sql, RunTarget::All).await;

        assert_eq!(row_count(&output.statements[0].outcome), 25);
        assert!(output.open.is_none());
    }

    #[tokio::test]
    async fn stops_at_the_first_failure_and_gives_the_location() {
        let answers = vec![
            Scripted::Command(0),
            Scripted::Error {
                message: "column \"ü\" does not exist".to_owned(),
                position: Some(8),
            },
            Scripted::Command(0),
        ];
        let sql = "select 1;\nselect ü from t;\nselect 3";

        let (output, executed) = run(answers, sql, RunTarget::All).await;

        assert_eq!(executed.len(), 2);
        assert_eq!(output.statements.len(), 2);
        let Outcome::Failed { error, location } = &output.statements[1].outcome else {
            panic!("the second statement must fail");
        };
        assert_eq!(error.kind, QueryErrorKind::Database);
        assert_eq!(
            *location,
            Some(Location {
                offset: 17,
                line: 2,
                column: 8
            })
        );
    }

    #[tokio::test]
    async fn runs_the_statement_at_the_cursor() {
        let sql = "select 1;\nselect 2;\nselect 3";

        let (_, executed) = run(vec![], sql, RunTarget::At { offset: 12 }).await;

        assert_eq!(executed, vec!["select 2"]);
    }

    #[tokio::test]
    async fn runs_the_statements_in_the_selection() {
        let sql = "select 1;\nselect 2;\nselect 3";

        let (output, executed) = run(vec![], sql, RunTarget::Range { from: 19, to: 10 }).await;

        assert_eq!(executed, vec!["select 2"]);
        assert_eq!(output.statements[0].range, TextRange { from: 10, to: 18 });
    }

    #[test]
    fn the_preview_gives_the_risk_of_each_selected_statement() {
        let sql = "select 1;\ndrop table ü;\ndelete from t";

        let all = preview_run(sql, RunTarget::All);
        let one = preview_run(sql, RunTarget::At { offset: 12 });

        let risks: Vec<Option<Risk>> = all.iter().map(|p| p.risk).collect();
        assert_eq!(
            risks,
            vec![None, Some(Risk::Drop), Some(Risk::DeleteWithoutWhere)]
        );
        assert_eq!(one.len(), 1);
        assert_eq!(one[0].range, TextRange { from: 10, to: 22 });
        assert_eq!(one[0].risk, Some(Risk::Drop));
    }

    #[tokio::test]
    async fn an_empty_script_runs_nothing() {
        let (output, executed) = run(vec![], " -- nothing\n", RunTarget::All).await;

        assert!(executed.is_empty());
        assert!(output.statements.is_empty());
    }
}

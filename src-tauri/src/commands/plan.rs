//! The execution plan of a statement as a tree.

use crate::error::CommandError;
use crate::state::{AppState, SessionId};
use serde::Serialize;
use specta::Type;
use tabloxide_assistant::{ExplainRejection, explain_json_statement, plan_json};
use tabloxide_core::{QueryError, QueryErrorKind, QuerySession};
use tauri::State;

/// The plan is one row. The limit protects against a different result.
const MAX_PLAN_ROWS: usize = 10;

/// Result of a plan read. A statement that fails is a normal result, not a command error.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum PlanRead {
    Plan {
        /// The statement that the database ran.
        statement: String,
        /// The plan in the JSON form of the database engine.
        json: String,
        /// `true` if the database ran the statement and measured it.
        is_analyzed: bool,
    },
    Rejected {
        reason: ExplainRejection,
        message: String,
    },
    Failed {
        error: QueryError,
    },
}

async fn read(session: &QuerySession, sql: &str, analyze: bool) -> PlanRead {
    let statement = match explain_json_statement(sql, analyze) {
        Ok(statement) => statement,
        Err(reason) => {
            return PlanRead::Rejected {
                reason,
                message: reason.to_string(),
            };
        }
    };
    match session.read_rows(&statement, MAX_PLAN_ROWS).await {
        Ok(rows) => match plan_json(&rows) {
            Some(json) => PlanRead::Plan {
                statement,
                json,
                is_analyzed: analyze,
            },
            None => PlanRead::Failed {
                error: QueryError::new(
                    QueryErrorKind::Other,
                    "The database did not return a plan.",
                ),
            },
        },
        Err(error) => PlanRead::Failed { error },
    }
}

/// Reads the execution plan of the one statement in `sql` as JSON.
///
/// Without `analyze`, the database does not run the statement. With `analyze`, the
/// database runs it. Thus `analyze` is permitted only for a statement that reads data.
/// The query history does not record the plan read. This closes the open result.
#[tauri::command]
#[specta::specta]
pub async fn plan_read(
    state: State<'_, AppState>,
    session_id: SessionId,
    sql: String,
    analyze: bool,
) -> Result<PlanRead, CommandError> {
    let session = state.session(session_id)?;
    Ok(read(&session, &sql, analyze).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tabloxide_core::testing::{Probe, Scripted, ScriptedSession};

    fn session(answers: Vec<Scripted>) -> (QuerySession, Arc<Probe>) {
        let (session, probe) = ScriptedSession::new(answers);
        (QuerySession::new(Box::new(session)), probe)
    }

    #[tokio::test]
    async fn runs_explain_as_json_and_returns_the_cell_of_the_plan() {
        let (session, probe) = session(vec![Scripted::Rows(1)]);

        let result = read(&session, "select * from item;", true).await;

        assert_eq!(
            result,
            PlanRead::Plan {
                statement: "EXPLAIN (ANALYZE, FORMAT JSON) select * from item".to_owned(),
                json: "1".to_owned(),
                is_analyzed: true,
            }
        );
        assert_eq!(
            *probe.executed.lock().unwrap(),
            vec!["EXPLAIN (ANALYZE, FORMAT JSON) select * from item"]
        );
    }

    #[tokio::test]
    async fn a_result_without_rows_is_a_failure() {
        let (session, _probe) = session(vec![Scripted::Rows(0)]);

        let result = read(&session, "select 1", false).await;

        assert!(matches!(result, PlanRead::Failed { .. }));
    }

    #[tokio::test]
    async fn rejects_analyze_for_a_statement_that_changes_data() {
        let (session, probe) = session(vec![]);

        let result = read(&session, "delete from item", true).await;

        assert!(matches!(
            result,
            PlanRead::Rejected {
                reason: ExplainRejection::AnalyzeChangesData,
                ..
            }
        ));
        assert!(probe.executed.lock().unwrap().is_empty());
    }
}

//! The execution plan of a statement as a tree.

use crate::error::CommandError;
use crate::state::{AppState, SessionId};
use serde::Serialize;
use specta::Type;
use tabloxide_assistant::{ExplainRejection, explain_json_statement, plan_json};
use tabloxide_core::{Engine, QueryError, QueryErrorKind, QuerySession};
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

async fn read(session: &QuerySession, sql: &str, analyze: bool, engine: &Engine) -> PlanRead {
    let statement = match explain_json_statement(sql, analyze, engine) {
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

/// Why a plan action is not available, for the user.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct PlanBlock {
    pub reason: ExplainRejection,
    pub message: String,
}

/// What the plan actions can do with a statement. `None` means that the action is
/// available. Else the value tells why it is not.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct PlanCheck {
    pub explain: Option<PlanBlock>,
    pub measure: Option<PlanBlock>,
}

fn block(sql: &str, measure: bool, engine: &Engine) -> Option<PlanBlock> {
    explain_json_statement(sql, measure, engine)
        .err()
        .map(|reason| PlanBlock {
            reason,
            message: reason.to_string(),
        })
}

fn check(sql: &str, engine: &Engine) -> PlanCheck {
    PlanCheck {
        explain: block(sql, false, engine),
        measure: block(sql, true, engine),
    }
}

/// Checks the statement at the cursor for the plan actions. The editor uses the
/// result to show which actions are available. Nothing goes to the database.
#[tauri::command]
#[specta::specta]
pub fn plan_check(sql: String, engine: Engine) -> PlanCheck {
    check(&sql, &engine)
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
    let entry = state.session_entry(session_id)?;
    Ok(read(&entry.session, &sql, analyze, &entry.engine).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tabloxide_core::testing::{Probe, Scripted, ScriptedSession};

    fn session(answers: Vec<Scripted>) -> (QuerySession, Arc<Probe>) {
        let (session, probe) = ScriptedSession::new(answers);
        (
            QuerySession::new(Box::new(session), tabloxide_core::QueryLanguage::Sql),
            probe,
        )
    }

    #[test]
    fn a_read_can_be_explained_and_measured() {
        let result = check("select * from item", &Engine::postgres());

        assert_eq!(
            result,
            PlanCheck {
                explain: None,
                measure: None
            }
        );
    }

    #[test]
    fn a_change_can_be_explained_but_not_measured() {
        let result = check("delete from item where id = 1", &Engine::duckdb());

        assert_eq!(result.explain, None);
        let measure = result.measure.unwrap();
        assert_eq!(measure.reason, ExplainRejection::AnalyzeChangesData);
        assert!(
            measure
                .message
                .starts_with("Explain and measure runs the statement.")
        );
    }

    #[test]
    fn no_statement_has_no_plan_action() {
        let result = check("  ", &Engine::postgres());

        assert_eq!(
            result.explain.map(|block| block.reason),
            Some(ExplainRejection::NoStatement)
        );
        assert_eq!(
            result.measure.map(|block| block.reason),
            Some(ExplainRejection::NoStatement)
        );
    }

    #[tokio::test]
    async fn runs_explain_as_json_and_returns_the_cell_of_the_plan() {
        let (session, probe) = session(vec![Scripted::Rows(1)]);

        let result = read(&session, "select * from item;", true, &Engine::postgres()).await;

        assert_eq!(
            result,
            PlanRead::Plan {
                statement: "EXPLAIN (ANALYZE, VERBOSE, BUFFERS, FORMAT JSON) select * from item"
                    .to_owned(),
                json: "1".to_owned(),
                is_analyzed: true,
            }
        );
        assert_eq!(
            *probe.executed.lock().unwrap(),
            vec!["EXPLAIN (ANALYZE, VERBOSE, BUFFERS, FORMAT JSON) select * from item"]
        );
    }

    #[tokio::test]
    async fn a_result_without_rows_is_a_failure() {
        let (session, _probe) = session(vec![Scripted::Rows(0)]);

        let result = read(&session, "select 1", false, &Engine::postgres()).await;

        assert!(matches!(result, PlanRead::Failed { .. }));
    }

    #[tokio::test]
    async fn rejects_analyze_for_a_statement_that_changes_data() {
        let (session, probe) = session(vec![]);

        let result = read(&session, "delete from item", true, &Engine::postgres()).await;

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

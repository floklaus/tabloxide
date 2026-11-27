//! The execution plan of a statement. The adapter or the connector of the engine
//! reads the plan. The application checks the statement first.

use crate::error::CommandError;
use crate::state::{AppState, SessionEntry, SessionId};
use serde::Serialize;
use specta::Type;
use tabloxide_assistant::{ExplainRejection, checked_plan_statement};
use tabloxide_core::{Capabilities, Plan, QueryError, QueryLanguage};
use tauri::State;

/// Result of a plan read. A statement that fails is a normal result, not a command error.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum PlanRead {
    Plan {
        /// What the engine ran to make the plan.
        statement: String,
        /// The plan as the engine gives it, for example a JSON document.
        text: String,
        /// The plan in the common form. `None` if the engine gives only `text`.
        plan: Option<Box<Plan>>,
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

/// Why a plan action is not available, for the user.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct PlanBlock {
    pub reason: ExplainRejection,
    pub message: String,
}

impl From<ExplainRejection> for PlanBlock {
    fn from(reason: ExplainRejection) -> Self {
        Self {
            reason,
            message: reason.to_string(),
        }
    }
}

/// What the plan actions can do with a statement. `None` means that the action is
/// available. Else the value tells why it is not.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct PlanCheck {
    pub explain: Option<PlanBlock>,
    pub measure: Option<PlanBlock>,
}

/// Returns the statement for the engine, or why the engine does not read its plan.
fn statement_for(
    language: QueryLanguage,
    capabilities: Capabilities,
    sql: &str,
    measure: bool,
) -> Result<String, ExplainRejection> {
    if !capabilities.explain_plan {
        return Err(ExplainRejection::NoPlan);
    }
    if measure && !capabilities.measured_plan {
        return Err(ExplainRejection::NoMeasuredPlan);
    }
    checked_plan_statement(language, sql, measure)
}

fn check(language: QueryLanguage, capabilities: Capabilities, sql: &str) -> PlanCheck {
    let block = |measure| {
        statement_for(language, capabilities, sql, measure)
            .err()
            .map(PlanBlock::from)
    };
    PlanCheck {
        explain: block(false),
        measure: block(true),
    }
}

/// Checks the statement at the cursor for the plan actions. The editor uses the
/// result to show which actions are available. Nothing goes to the database.
#[tauri::command]
#[specta::specta]
pub fn plan_check(sql: String, language: QueryLanguage, capabilities: Capabilities) -> PlanCheck {
    check(language, capabilities, &sql)
}

async fn read(entry: &SessionEntry, sql: &str, measure: bool) -> PlanRead {
    let info = &entry.info;
    let statement = match statement_for(info.language, info.capabilities, sql, measure) {
        Ok(statement) => statement,
        Err(reason) => {
            return PlanRead::Rejected {
                reason,
                message: reason.to_string(),
            };
        }
    };
    match entry.session.read_plan(&statement, measure).await {
        Ok(plan) => PlanRead::Plan {
            statement: plan.statement,
            text: plan.text,
            plan: plan.plan.map(Box::new),
            is_analyzed: measure,
        },
        Err(error) => PlanRead::Failed { error },
    }
}

/// Reads the execution plan of the one statement in `sql`.
///
/// Without `measure`, the database does not run the statement. With `measure`, the
/// database runs it. Thus `measure` is permitted only for a statement that reads
/// data. The query history does not record the plan read. This closes the open result.
#[tauri::command]
#[specta::specta]
pub async fn plan_read(
    state: State<'_, AppState>,
    session_id: SessionId,
    sql: String,
    measure: bool,
) -> Result<PlanRead, CommandError> {
    let entry = state.session_entry(session_id)?;
    Ok(read(&entry, &sql, measure).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tabloxide_core::testing::{Probe, Scripted, ScriptedSession};
    use tabloxide_core::{ConnectionId, Engine, EngineInfo, QuerySession};

    const ALL: Capabilities = Capabilities {
        cancel: true,
        unix_socket: false,
        file_database: false,
        explain_plan: true,
        measured_plan: true,
    };

    fn entry(language: QueryLanguage, capabilities: Capabilities) -> (SessionEntry, Arc<Probe>) {
        let (session, probe) = ScriptedSession::new(vec![Scripted::Rows(1)]);
        let entry = SessionEntry {
            session: Arc::new(QuerySession::new(Box::new(session), language)),
            connection_id: ConnectionId::from("c1"),
            connection_name: "Shop".to_owned(),
            info: EngineInfo {
                engine: Engine::new("test"),
                display_name: "Test".to_owned(),
                language,
                default_port: None,
                capabilities,
            },
        };
        (entry, probe)
    }

    #[test]
    fn a_read_can_be_explained_and_measured() {
        let result = check(QueryLanguage::Sql, ALL, "select * from item");

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
        let result = check(QueryLanguage::Sql, ALL, "delete from item where id = 1");

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
        let result = check(QueryLanguage::Sql, ALL, "  ");

        assert_eq!(
            result.explain.map(|block| block.reason),
            Some(ExplainRejection::NoStatement)
        );
        assert_eq!(
            result.measure.map(|block| block.reason),
            Some(ExplainRejection::NoStatement)
        );
    }

    #[test]
    fn the_capabilities_of_the_engine_decide_first() {
        let without_plans = Capabilities {
            explain_plan: false,
            measured_plan: false,
            ..ALL
        };
        let estimate_only = Capabilities {
            measured_plan: false,
            ..ALL
        };

        let none = check(QueryLanguage::MongodbShell, without_plans, "db.a.find()");
        let some = check(QueryLanguage::MongodbShell, estimate_only, "db.a.find()");

        assert_eq!(none.explain.unwrap().reason, ExplainRejection::NoPlan);
        assert_eq!(some.explain, None);
        assert_eq!(
            some.measure.unwrap().reason,
            ExplainRejection::NoMeasuredPlan
        );
    }

    #[tokio::test]
    async fn the_session_gets_the_statement_without_explain() {
        let (entry, _probe) = entry(QueryLanguage::Sql, ALL);

        let result = read(&entry, "select * from item;", true).await;

        // The scripted session has no plan. Its default answer proves the call.
        let PlanRead::Failed { error } = result else {
            panic!("{result:?}");
        };
        assert!(error.message.contains("gives no execution plan"));
    }

    #[tokio::test]
    async fn rejects_a_measure_of_a_statement_that_changes_data() {
        let (entry, probe) = entry(QueryLanguage::MongodbShell, ALL);

        let result = read(&entry, "db.item.deleteMany({})", true).await;

        assert!(matches!(
            result,
            PlanRead::Rejected {
                reason: ExplainRejection::MeasureChangesData,
                ..
            }
        ));
        assert!(probe.executed.lock().unwrap().is_empty());
    }
}

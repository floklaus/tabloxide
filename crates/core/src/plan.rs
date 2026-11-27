//! The execution plan of a statement, in a form that does not depend on the engine.
//!
//! An adapter or a connector converts the plan of its engine into this form. The UI
//! shows the form and knows no engine. The original plan of the engine stays in
//! [`PlanText::text`] for the AI and for the "Original" view.

use crate::{QueryError, QueryErrorKind, Session};
use serde::Serialize;

/// The execution plan of a statement.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PlanText {
    /// The plan as the engine gives it, for example a JSON document.
    pub text: String,
    /// What the engine ran to make the plan, for the user.
    pub statement: String,
    /// The plan in the common form. `None` if the engine gives only `text`.
    pub plan: Option<Plan>,
}

/// A plan in the common form.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub root: PlanStep,
    /// `true` if the engine ran the statement and measured it.
    pub is_measured: bool,
    /// The total time in milliseconds. Only for a measured plan.
    pub total_ms: Option<f64>,
    /// The time of the planner in milliseconds, if the engine gives it.
    pub planning_ms: Option<f64>,
    /// The unit of the cost, for example `cost units` or `documents`.
    pub cost_unit: String,
    /// The data of the complete statement.
    pub totals: Vec<PlanField>,
    pub hints: Vec<PlanHint>,
}

/// One step of a plan.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PlanStep {
    /// The operation, for example `Hash Join` or `IXSCAN`.
    pub operation: String,
    /// The table, the collection, or the index that the step reads.
    pub target: Option<String>,
    /// One or two sentences for the user about the operation.
    pub explanation: Option<String>,
    /// All other data of the step, as the engine names it.
    pub fields: Vec<PlanField>,
    pub estimated_rows: Option<f64>,
    pub actual_rows: Option<f64>,
    /// How many times the step ran. Only for a measured plan.
    pub loops: Option<f64>,
    /// The cost of this step without its child steps, in [`Plan::cost_unit`].
    pub self_cost: Option<f64>,
    /// The time of this step without its child steps, in milliseconds.
    pub self_ms: Option<f64>,
    pub children: Vec<PlanStep>,
}

/// One value of a step or of the complete statement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PlanField {
    pub name: String,
    pub value: String,
    /// What the value means, for the user.
    pub explanation: Option<String>,
    /// The section of the field in the view of a step.
    pub group: FieldGroup,
}

impl PlanField {
    /// A field without an explanation in the group [`FieldGroup::Step`].
    #[must_use]
    pub fn new(name: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            value: value.into(),
            explanation: None,
            group: FieldGroup::Step,
        }
    }
}

/// The section of a field in the view of a step.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
pub enum FieldGroup {
    /// What the step does, for example the filter or the join condition.
    Step,
    /// Estimates of the planner.
    Estimate,
    /// Values that the engine measured when the statement ran.
    Measured,
    /// Memory and temporary files.
    Memory,
    /// Reads and writes of pages or bytes.
    Io,
}

/// Returns a JSON value of a plan as text for a field, or `None` for no value.
/// An empty text, an empty list, and `null` are no value. A list becomes the items
/// with commas. An object becomes its JSON text.
#[must_use]
pub fn json_field_text(value: &serde_json::Value) -> Option<String> {
    use serde_json::Value;
    match value {
        Value::Null => None,
        Value::Bool(flag) => Some(if *flag { "yes" } else { "no" }.to_owned()),
        Value::Number(number) => Some(number.to_string()),
        Value::String(text) if text.is_empty() => None,
        Value::String(text) => Some(text.clone()),
        Value::Array(items) if items.is_empty() => None,
        Value::Array(items) => Some(
            items
                .iter()
                .map(|item| match item {
                    Value::String(text) => text.clone(),
                    other => other.to_string(),
                })
                .collect::<Vec<_>>()
                .join(", "),
        ),
        Value::Object(_) => Some(value.to_string()),
    }
}

/// How important a hint is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
pub enum HintLevel {
    Info,
    Warning,
}

/// A probable cause of a slow statement, with what to do.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PlanHint {
    /// The path of the step: `0` is the root, `0.1` is the second child of the root.
    pub step: String,
    pub level: HintLevel,
    /// For example `No index for the filter`.
    pub title: String,
    /// What to do.
    pub text: String,
}

/// Runs an `EXPLAIN` statement that gives the plan as one JSON value, and returns
/// the JSON. PostgreSQL gives one cell. DuckDB gives a name and the plan, and the
/// plan is last. Thus the function takes the last cell with a value of the first row.
///
/// # Errors
///
/// Returns the error of the database, or an error if the result has no plan.
pub async fn read_explain_json<S: Session + ?Sized>(
    session: &mut S,
    explain: &str,
) -> Result<String, QueryError> {
    let mut stream = session.execute(explain).await?;
    let page = stream.next_page(MAX_PLAN_ROWS).await;
    stream.close().await;
    page?
        .rows
        .first()
        .and_then(|row| row.iter().rev().flatten().next().cloned())
        .ok_or_else(|| {
            QueryError::new(QueryErrorKind::Other, "The database did not return a plan.")
        })
}

/// The plan is one row. The limit protects against a different result.
const MAX_PLAN_ROWS: usize = 10;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{Scripted, ScriptedSession};

    #[test]
    fn a_json_value_becomes_the_text_of_a_field() {
        use serde_json::json;

        assert_eq!(json_field_text(&json!(null)), None);
        assert_eq!(json_field_text(&json!("")), None);
        assert_eq!(json_field_text(&json!([])), None);
        assert_eq!(json_field_text(&json!(true)).as_deref(), Some("yes"));
        assert_eq!(json_field_text(&json!(2.5)).as_deref(), Some("2.5"));
        assert_eq!(
            json_field_text(&json!(["a", 1, {"b": 2}])).as_deref(),
            Some("a, 1, {\"b\":2}")
        );
        assert_eq!(
            json_field_text(&json!({"b": 2})).as_deref(),
            Some("{\"b\":2}")
        );
    }

    #[tokio::test]
    async fn takes_the_last_cell_with_a_value_of_the_first_row() {
        let (mut session, probe) = ScriptedSession::new(vec![Scripted::Rows(1)]);

        let json = read_explain_json(&mut session, "EXPLAIN (FORMAT JSON) select 1").await;

        assert!(json.is_ok());
        assert_eq!(
            *probe.executed.lock().unwrap(),
            vec!["EXPLAIN (FORMAT JSON) select 1"]
        );
    }

    #[tokio::test]
    async fn a_result_without_rows_is_an_error() {
        let (mut session, _probe) = ScriptedSession::new(vec![Scripted::Rows(0)]);

        let error = read_explain_json(&mut session, "EXPLAIN select 1")
            .await
            .unwrap_err();

        assert_eq!(error.message, "The database did not return a plan.");
    }
}

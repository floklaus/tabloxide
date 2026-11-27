//! Reads the JSON plan of DuckDB into the common plan form. The rules come from the
//! DuckDB part of `ui/src/plan/planModel.ts`.

mod glossary;
mod hints;
mod json;
#[cfg(test)]
mod tests;

use json::{Json, fields_of, number, pick, text};
use serde_json::Value;
use tabloxide_core::{Plan, PlanField, PlanStep};

/// Steps that DuckDB adds around the plan of the statement.
const WRAPPERS: &[&str] = &["RESULT_COLLECTOR", "EXECUTE", "EXPLAIN_ANALYZE", "QUERY"];

/// Fields of `extra_info` that the step has as `target` and `estimated_rows`.
const HIDDEN: &[&str] = &["Estimated Cardinality", "Table"];

/// The fields of a DuckDB operator that the step has as values, or that are the tree.
const STRUCTURE: &[&str] = &[
    "children",
    "extra_info",
    "name",
    "type",
    "operator_type",
    "timing",
    "operator_timing",
    "operator_cardinality",
    "intermediate_rows",
];

/// The groups of the DuckDB profile with data of the complete statement.
const TOTAL_GROUPS: &[&str] = &["query", "system", "io", "planner", "physical_planner"];

/// DuckDB gives no cost. Its planner estimates only the number of rows.
const COST_UNIT: &str = "rows";

const MS_PER_SECOND: f64 = 1000.0;

/// Reads the JSON plan of `EXPLAIN (FORMAT JSON)` or of
/// `EXPLAIN (ANALYZE, FORMAT JSON)`. Returns `None` if the JSON is not a plan.
pub(crate) fn read_plan(json_text: &str) -> Option<Plan> {
    let json: Value = serde_json::from_str(json_text).ok()?;
    let operators = json
        .as_object()
        .and_then(|object| object.get("operator"))
        .and_then(Value::as_array);
    let is_measured = operators.is_some();
    let first = operators
        .or_else(|| json.as_array())?
        .first()?
        .as_object()?;
    let root = step_of(unwrap(first));
    let hints = hints::hints_of(&root, "0");
    Some(Plan {
        total_ms: is_measured.then(|| inclusive_ms(&root)),
        planning_ms: None,
        cost_unit: COST_UNIT.to_owned(),
        totals: if is_measured {
            totals_of(&json)
        } else {
            Vec::new()
        },
        hints,
        root,
        is_measured,
    })
}

/// Goes past the steps that DuckDB adds around the plan.
fn unwrap(node: &Json) -> &Json {
    let mut current = node;
    loop {
        let kind = text(pick(current, &["type", "name"]));
        let children = current
            .get("children")
            .and_then(Value::as_array)
            .map_or(&[][..], Vec::as_slice);
        let is_wrapper = kind.is_some_and(|kind| WRAPPERS.contains(&kind.as_str()));
        match children {
            [Value::Object(child)] if is_wrapper => current = child,
            _ => return current,
        }
    }
}

fn step_of(node: &Json) -> PlanStep {
    let empty = Json::new();
    let info = node
        .get("extra_info")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let children = node
        .get("children")
        .and_then(Value::as_array)
        .map(|children| {
            children
                .iter()
                .filter_map(Value::as_object)
                .map(step_of)
                .collect()
        })
        .unwrap_or_default();
    let operation =
        text(pick(node, &["name", "type", "operator_type"])).unwrap_or_else(|| "Step".to_owned());
    // DuckDB gives the time of each operator without its children, in seconds.
    let seconds = number(pick(node, &["timing", "operator_timing"]));
    let fields = fields_of(info, HIDDEN)
        .into_iter()
        .chain(fields_of(node, STRUCTURE))
        .map(|(name, value)| field(name, value))
        .collect();
    PlanStep {
        explanation: glossary::operation_text(&operation).map(str::to_owned),
        operation,
        target: text(info.get("Table")),
        fields,
        estimated_rows: number(info.get("Estimated Cardinality")),
        actual_rows: number(pick(node, &["operator_cardinality", "intermediate_rows"])),
        loops: None,
        self_cost: None,
        self_ms: seconds.map(|seconds| seconds * MS_PER_SECOND),
        children,
    }
}

/// Makes a field of a step with its group and its explanation.
fn field(name: String, value: String) -> PlanField {
    let (group, explanation) = glossary::field_info(&name);
    PlanField {
        explanation: explanation.map(str::to_owned),
        group,
        ..PlanField::new(name, value)
    }
}

/// The time of the step with its child steps, in milliseconds.
fn inclusive_ms(step: &PlanStep) -> f64 {
    step.self_ms.unwrap_or(0.0) + step.children.iter().map(inclusive_ms).sum::<f64>()
}

/// Returns the data of the complete statement from the groups of the profile.
fn totals_of(json: &Value) -> Vec<PlanField> {
    TOTAL_GROUPS
        .iter()
        .filter_map(|group| Some((group, json.get(group)?.as_object()?)))
        .flat_map(|(group, values)| {
            fields_of(values, &["sql"])
                .into_iter()
                .map(move |(key, value)| {
                    let name = format!("{group}.{key}");
                    PlanField {
                        explanation: glossary::total_text(&name).map(str::to_owned),
                        ..PlanField::new(name, value)
                    }
                })
        })
        .collect()
}

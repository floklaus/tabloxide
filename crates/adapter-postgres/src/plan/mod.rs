//! Reads the JSON plan of PostgreSQL into the common plan form of the core crate.
//!
//! The UI calculates the share of each step, the costliest steps, and the
//! misestimates. This module does not.

mod glossary;
mod hints;
#[cfg(test)]
mod tests;

use serde_json::{Map, Value};
use tabloxide_core::{Plan, PlanField, PlanStep, json_field_text};

/// The unit of the cost of the PostgreSQL planner.
const COST_UNIT: &str = "cost units";

/// The fields of a step that the step has in other members, or that are the tree.
const STEP_STRUCTURE: [&str; 2] = ["Node Type", "Plans"];

/// The fields of the plan that the plan has as numbers, or that are the tree.
const PLAN_STRUCTURE: [&str; 3] = ["Plan", "Planning Time", "Execution Time"];

/// Reads the JSON text of `EXPLAIN (FORMAT JSON)`. Returns `None` if the text is not
/// a plan. Then the UI shows only the original text.
pub(crate) fn read_plan_json(text: &str) -> Option<Plan> {
    let json: Value = serde_json::from_str(text).ok()?;
    let first = match &json {
        Value::Array(items) => items.first()?,
        other => other,
    };
    let first = first.as_object()?;
    let root = read_step(first.get("Plan")?.as_object()?).step;
    let execution = first.get("Execution Time").and_then(number);
    let totals = fields_of(first, &PLAN_STRUCTURE)
        .map(|(name, value)| {
            let (group, _) = glossary::field_info(&name);
            PlanField {
                explanation: glossary::total_text(&name).map(str::to_owned),
                name,
                value,
                group,
            }
        })
        .collect();
    let hints = hints::plan_hints(&root);
    Some(Plan {
        root,
        is_measured: execution.is_some(),
        total_ms: execution,
        planning_ms: first.get("Planning Time").and_then(number),
        cost_unit: COST_UNIT.to_owned(),
        totals,
        hints,
    })
}

/// A step with its cost and its time together with its child steps.
struct ReadStep {
    step: PlanStep,
    inclusive_cost: f64,
    inclusive_ms: f64,
}

fn read_step(node: &Map<String, Value>) -> ReadStep {
    let children: Vec<ReadStep> = node
        .get("Plans")
        .and_then(Value::as_array)
        .map(|plans| {
            plans
                .iter()
                .filter_map(Value::as_object)
                .map(read_step)
                .collect()
        })
        .unwrap_or_default();
    let children_cost: f64 = children.iter().map(|child| child.inclusive_cost).sum();
    let children_ms: f64 = children.iter().map(|child| child.inclusive_ms).sum();
    let loops = node.get("Actual Loops").and_then(number);
    // PostgreSQL gives the time of one loop. The time of the step is for all loops.
    let total_ms = node
        .get("Actual Total Time")
        .and_then(number)
        .map(|time| time * loops.unwrap_or(1.0));
    let self_cost = node
        .get("Total Cost")
        .and_then(number)
        .map(|cost| (cost - children_cost).max(0.0));
    let self_ms = total_ms.map(|time| (time - children_ms).max(0.0));
    let operation = node
        .get("Node Type")
        .and_then(text)
        .unwrap_or_else(|| "Step".to_owned());
    let fields = fields_of(node, &STEP_STRUCTURE)
        .map(|(name, value)| {
            let (group, explanation) = glossary::field_info(&name);
            PlanField {
                name,
                value,
                explanation: explanation.map(str::to_owned),
                group,
            }
        })
        .collect();
    ReadStep {
        inclusive_cost: self_cost.unwrap_or(0.0) + children_cost,
        inclusive_ms: self_ms.unwrap_or(0.0) + children_ms,
        step: PlanStep {
            explanation: glossary::operation_text(&operation).map(str::to_owned),
            operation,
            target: target(node),
            fields,
            estimated_rows: node.get("Plan Rows").and_then(number),
            // The estimate is for one loop. PostgreSQL also gives the rows of one loop.
            actual_rows: node.get("Actual Rows").and_then(number),
            loops,
            self_cost,
            self_ms,
            children: children.into_iter().map(|child| child.step).collect(),
        },
    }
}

/// Returns the table, the index, the WITH query, or the function of a step.
fn target(node: &Map<String, Value>) -> Option<String> {
    let field = |key: &str| node.get(key).and_then(text);
    let relation = field("Relation Name");
    let named = match (relation, field("Alias")) {
        (Some(relation), Some(alias)) if alias != relation => {
            Some(format!("{relation} AS {alias}"))
        }
        (relation, _) => relation,
    };
    let index = field("Index Name").map(|index| format!("index {index}"));
    let parts: Vec<String> = named.into_iter().chain(index).collect();
    if parts.is_empty() {
        field("CTE Name").or_else(|| field("Function Name"))
    } else {
        Some(parts.join(", "))
    }
}

/// Returns the fields of `object` as text, in their sequence, without the keys in
/// `skip` and without the fields that have no value.
fn fields_of<'a>(
    object: &'a Map<String, Value>,
    skip: &'a [&str],
) -> impl Iterator<Item = (String, String)> + 'a {
    object.iter().filter_map(move |(key, value)| {
        if skip.contains(&key.as_str()) {
            return None;
        }
        text(value).map(|shown| (key.clone(), shown))
    })
}

/// Returns a JSON value as text, or `None` for no value. A number has the form of
/// JavaScript, for example `189` and not `189.0`, as in the UI before.
fn text(value: &Value) -> Option<String> {
    match value {
        Value::Number(number) => number.as_f64().map(number_text),
        Value::Array(items) if !items.is_empty() => Some(
            items
                .iter()
                .map(|item| match item {
                    Value::Number(number) => number.as_f64().map(number_text).unwrap_or_default(),
                    Value::String(text) => text.clone(),
                    other => other.to_string(),
                })
                .collect::<Vec<_>>()
                .join(", "),
        ),
        other => json_field_text(other),
    }
}

/// Returns a JSON value as a number. A text with a number is also a number.
fn number(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64().filter(|value| value.is_finite()),
        Value::String(text) => parse_number(text),
        _ => None,
    }
}

/// Reads a number from a text like `Number(text)` of JavaScript. An empty text is 0.
fn parse_number(text: &str) -> Option<f64> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Some(0.0);
    }
    trimmed
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite())
}

/// Writes a number like `String(number)` of JavaScript: an integer has no decimals.
fn number_text(value: f64) -> String {
    if value.fract() == 0.0 && value.abs() < 1e21 {
        format!("{value:.0}")
    } else {
        value.to_string()
    }
}

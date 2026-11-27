//! The DuckDB cases of `ui/src/plan/planModel.test.ts` and `planHints.test.ts`.

use super::read_plan;
use serde_json::json;
use tabloxide_core::{FieldGroup, HintLevel, Plan, PlanField, PlanStep};

const EXPLAIN: &str = include_str!("fixtures/duckdb-explain.json");
const ANALYZE: &str = include_str!("fixtures/duckdb-analyze.json");

/// Returns the steps of the plan, each step before its children.
fn flatten(step: &PlanStep) -> Vec<&PlanStep> {
    std::iter::once(step)
        .chain(step.children.iter().flat_map(flatten))
        .collect()
}

fn has_field(fields: &[PlanField], name: &str, value: &str) -> bool {
    fields
        .iter()
        .any(|field| field.name == name && field.value == value)
}

fn parse(text: &str) -> Plan {
    read_plan(text).expect("the text is a plan")
}

#[test]
fn reads_the_steps_and_the_estimates_of_explain() {
    let plan = parse(EXPLAIN);

    assert!(!plan.is_measured);
    assert_eq!(plan.total_ms, None);
    assert_eq!(plan.cost_unit, "rows");
    let steps = flatten(&plan.root);
    assert_eq!(steps[0].operation, "PROJECTION");
    let scans: Vec<_> = steps
        .iter()
        .filter(|step| step.operation == "SEQ_SCAN")
        .collect();
    let targets: Vec<_> = scans.iter().map(|step| step.target.as_deref()).collect();
    assert_eq!(targets, [Some("memory.main.t"), Some("memory.main.u")]);
    assert!(has_field(&scans[0].fields, "Filters", "(id > 5)"));
    assert_eq!(scans[0].estimated_rows, Some(2000.0));
    // DuckDB gives no cost and no time without ANALYZE.
    assert!(
        steps
            .iter()
            .all(|step| step.self_cost.is_none() && step.self_ms.is_none())
    );
    assert!(plan.hints.is_empty());
}

#[test]
fn reads_the_times_of_explain_analyze_without_the_steps_around_the_plan() {
    let plan = parse(ANALYZE);

    assert!(plan.is_measured);
    assert_eq!(plan.root.operation, "PROJECTION");
    let steps = flatten(&plan.root);
    assert!(steps.iter().all(|step| step.operation != "EXPLAIN_ANALYZE"));
    let total = plan.total_ms.expect("a measured plan has a total time");
    assert!(total > 0.0);
    // The times of the steps without their children add up to the total time.
    let sum: f64 = steps.iter().filter_map(|step| step.self_ms).sum();
    assert!((sum / total - 1.0).abs() < 1e-5);
    // DuckDB expected 4 rows from the join and got more than 10 times more.
    let join = steps
        .iter()
        .find(|step| step.operation == "HASH_JOIN")
        .expect("the plan has a join");
    let actual = join.actual_rows.expect("the join has actual rows");
    let estimate = join.estimated_rows.expect("the join has an estimate");
    assert!(actual > 40.0);
    assert!(actual.max(1.0) / estimate.max(1.0) >= 10.0);
}

#[test]
fn gives_no_plan_for_text_that_is_not_a_plan() {
    assert_eq!(read_plan("not json"), None);
    assert_eq!(read_plan("[]"), None);
    assert_eq!(read_plan("{}"), None);
}

#[test]
fn keeps_the_measured_fields_and_the_totals_of_duckdb() {
    let plan = parse(ANALYZE);
    let steps = flatten(&plan.root);
    let scan = steps
        .iter()
        .find(|step| step.operation == "TABLE_SCAN")
        .expect("the plan has a table scan");

    assert!(has_field(&scan.fields, "rows_scanned", "7952"));
    assert!(has_field(&scan.fields, "Type", "Sequential Scan"));
    assert!(has_field(&plan.totals, "query.total_rows_scanned", "8052"));
    assert!(!plan.totals.iter().any(|field| field.name == "query.sql"));
}

#[test]
fn gives_the_explanations_and_the_groups_of_the_engine() {
    let plan = parse(ANALYZE);
    let steps = flatten(&plan.root);
    let scan = steps
        .iter()
        .find(|step| step.operation == "TABLE_SCAN")
        .expect("the plan has a table scan");
    let rows = scan
        .fields
        .iter()
        .find(|field| field.name == "rows_scanned")
        .expect("the scan has rows_scanned");

    assert!(scan.explanation.is_some());
    assert_eq!(rows.group, FieldGroup::Measured);
    assert!(rows.explanation.is_some());
    let peak = plan
        .totals
        .iter()
        .find(|field| field.name == "system.peak_temp_dir_size")
        .expect("the totals have the temporary files");
    assert!(
        peak.explanation
            .as_deref()
            .is_some_and(|text| text.contains("temporary files"))
    );
}

/// A measured table scan that reads `scanned` rows and gives 10.
fn scan(scanned: u32) -> serde_json::Value {
    json!({
        "type": "TABLE_SCAN",
        "timing": 0.001,
        "operator_cardinality": 10,
        "rows_scanned": scanned,
        "extra_info": { "Table": "t", "Estimated Cardinality": "10" },
        "children": [],
    })
}

#[test]
fn tells_when_a_duckdb_scan_reads_many_more_rows_than_it_gives() {
    let plan = parse(&json!({ "operator": [scan(50_000)] }).to_string());

    assert_eq!(plan.hints.len(), 1);
    let hint = &plan.hints[0];
    assert_eq!(hint.step, "0");
    assert_eq!(hint.level, HintLevel::Info);
    assert_eq!(hint.title, "Scan reads many rows");
    assert!(
        hint.text.contains("read 50,000 rows and gave 10"),
        "{}",
        hint.text
    );
}

#[test]
fn says_nothing_when_the_scan_reads_few_rows() {
    let plan = parse(&json!({ "operator": [scan(90)] }).to_string());

    assert!(plan.hints.is_empty());
}

#[test]
fn gives_the_path_of_the_step_of_a_hint() {
    let root = json!({
        "type": "PROJECTION",
        "operator_cardinality": 10,
        "children": [
            { "type": "FILTER", "operator_cardinality": 10, "children": [] },
            {
                "type": "FILTER",
                "operator_cardinality": 10,
                "children": [scan(105_000)],
            },
        ],
    });
    let wrapped = json!({ "type": "EXPLAIN_ANALYZE", "children": [root] });

    let plan = parse(&json!({ "operator": [wrapped] }).to_string());

    let steps: Vec<_> = plan.hints.iter().map(|hint| hint.step.as_str()).collect();
    assert_eq!(steps, ["0.1.0"]);
    assert!(plan.hints[0].text.contains("read 105,000 rows"));
}

//! The PostgreSQL cases of the tests of `planModel`, `planGlossary`, and `planHints`
//! of the UI, with the same expectations.

use super::glossary::{field_info, operation_text};
use super::hints::format_count;
use super::read_plan_json;
use serde_json::{Value, json};
use tabloxide_core::{FieldGroup, HintLevel, Plan, PlanField, PlanStep};

const EXPLAIN: &str = include_str!("fixtures/postgres-explain.json");
const ANALYZE: &str = include_str!("fixtures/postgres-analyze.json");

fn read(text: &str) -> Plan {
    read_plan_json(text).expect("the text must be a plan")
}

fn read_json(json: Value) -> Plan {
    read(&json.to_string())
}

/// Returns the steps of the plan, each step before its children.
fn flatten(step: &PlanStep) -> Vec<&PlanStep> {
    std::iter::once(step)
        .chain(step.children.iter().flat_map(flatten))
        .collect()
}

fn has_field(step: &PlanStep, name: &str, value: &str) -> bool {
    step.fields
        .iter()
        .any(|field| field.name == name && field.value == value)
}

/// Makes a measured plan with one step.
fn one_step(fields: Value) -> Plan {
    let mut step = json!({
        "Node Type": "Seq Scan",
        "Relation Name": "item",
        "Total Cost": 100,
        "Plan Rows": 10,
        "Actual Rows": 10,
        "Actual Loops": 1,
        "Actual Total Time": 5,
    });
    let step_object = step.as_object_mut().unwrap();
    for (key, value) in fields.as_object().unwrap() {
        step_object.insert(key.clone(), value.clone());
    }
    read_json(json!([{ "Plan": step, "Execution Time": 5 }]))
}

fn texts(plan: &Plan) -> Vec<String> {
    plan.hints.iter().map(|hint| hint.text.clone()).collect()
}

fn first_text(plan: &Plan) -> String {
    texts(plan)
        .into_iter()
        .next()
        .expect("the plan must have a hint")
}

#[test]
fn reads_the_steps_the_tables_and_the_costs_of_explain() {
    let plan = read(EXPLAIN);

    assert!(!plan.is_measured);
    assert_eq!(plan.total_ms, None);
    assert_eq!(plan.cost_unit, "cost units");
    let steps = flatten(&plan.root);
    let operations: Vec<&str> = steps.iter().map(|step| step.operation.as_str()).collect();
    assert_eq!(
        operations,
        [
            "Sort",
            "Aggregate",
            "Hash Join",
            "Seq Scan",
            "Hash",
            "Seq Scan"
        ]
    );
    let scan = steps[3];
    assert_eq!(scan.target.as_deref(), Some("t"));
    assert!(has_field(scan, "Filter", "(id > 5)"));
    assert_eq!(scan.estimated_rows, Some(9995.0));
    assert_eq!(scan.actual_rows, None);
    // The cost of each step without its children adds up to the cost of the plan.
    let self_costs: f64 = steps.iter().filter_map(|step| step.self_cost).sum();
    assert!((self_costs - 231.52).abs() < 1e-6, "{self_costs}");
    assert_eq!(scan.self_cost, Some(189.0));
}

#[test]
fn reads_the_times_and_the_actual_rows_of_explain_analyze() {
    let plan = read(ANALYZE);

    assert!(plan.is_measured);
    assert!(plan.total_ms.unwrap() > 0.0);
    assert!(plan.planning_ms.unwrap() > 0.0);
    let steps = flatten(&plan.root);
    let join = steps[2];
    assert_eq!(join.operation, "Hash Join");
    assert_eq!(join.actual_rows, Some(95.0));
    assert!(has_field(join, "Hash Cond", "(t.id = u.id)"));
    assert!(join.self_ms.unwrap() > 0.0);
    // The scan of the large table is the costliest step.
    let costliest = steps
        .iter()
        .max_by(|a, b| a.self_ms.unwrap().total_cmp(&b.self_ms.unwrap()))
        .unwrap();
    assert_eq!(costliest.target.as_deref(), Some("t"));
}

#[test]
fn text_that_is_not_a_plan_gives_no_plan() {
    assert_eq!(read_plan_json("not json"), None);
    assert_eq!(read_plan_json("[{}]"), None);
    assert_eq!(read_plan_json("[]"), None);
}

#[test]
fn keeps_each_field_of_a_step_also_the_measured_ones() {
    let plan = read(ANALYZE);
    let sort = &plan.root;

    assert!(has_field(sort, "Sort Space Type", "Memory"));
    assert!(has_field(sort, "Startup Cost", "231.5"));
    assert!(has_field(sort, "Parallel Aware", "no"));
    assert!(sort.fields.iter().all(|field| field.name != "Plans"));
    assert_eq!(sort.loops, Some(1.0));
}

#[test]
fn keeps_the_fields_of_the_complete_plan() {
    let plan = read_json(json!([{
        "Plan": { "Node Type": "Result" },
        "Triggers": [],
        "JIT": { "Functions": 3 },
        "Planning Time": 1,
    }]));

    let jit = PlanField {
        name: "JIT".to_owned(),
        value: "{\"Functions\":3}".to_owned(),
        explanation: super::glossary::total_text("JIT").map(str::to_owned),
        group: FieldGroup::Step,
    };
    assert_eq!(plan.totals, vec![jit]);
    assert!(plan.totals[0].explanation.is_some());
}

#[test]
fn explains_the_steps_and_the_fields() {
    let plan = read(EXPLAIN);
    let join = flatten(&plan.root)[2];

    assert!(join.explanation.as_deref().unwrap().contains("hash table"));
    assert!(operation_text("Hash Join").unwrap().contains("hash table"));
    assert_eq!(operation_text("HASH_JOIN"), None);
    let cond = join.fields.iter().find(|f| f.name == "Hash Cond").unwrap();
    assert_eq!(cond.group, FieldGroup::Step);
    assert!(cond.explanation.is_some());
}

#[test]
fn puts_each_field_into_a_group_and_explains_the_known_fields() {
    assert_eq!(field_info("Shared Read Blocks").0, FieldGroup::Io);
    assert!(
        field_info("Sort Method")
            .1
            .unwrap()
            .contains("external merge")
    );
    assert_eq!(field_info("Some New Blocks"), (FieldGroup::Io, None));
    assert_eq!(field_info("Actual Something"), (FieldGroup::Measured, None));
    assert_eq!(field_info("Some Disk Thing"), (FieldGroup::Memory, None));
    assert_eq!(field_info("Unknown"), (FieldGroup::Step, None));
}

#[test]
fn suggests_an_index_when_a_scan_removes_most_rows() {
    let plan = one_step(json!({
        "Filter": "(price > 10)",
        "Rows Removed by Filter": 99990,
    }));

    let hint = &plan.hints[0];
    assert_eq!(hint.step, "0");
    assert_eq!(hint.level, HintLevel::Warning);
    assert_eq!(hint.title, "Filter removes most rows");
    assert!(hint.text.contains(
        "read 100,000 rows and kept only 10. An index on the columns of the filter (price > 10)"
    ));
}

#[test]
fn says_nothing_when_the_filter_removes_few_rows() {
    let plan = one_step(json!({
        "Filter": "(price > 10)",
        "Rows Removed by Filter": 5,
    }));

    assert!(plan.hints.is_empty());
}

#[test]
fn tells_that_a_sort_or_a_hash_used_the_disk() {
    let sort = one_step(json!({ "Sort Method": "external merge", "Sort Space Used": 2048 }));
    assert!(first_text(&sort).contains("temporary files on disk (2,048 kB)"));
    let hash = one_step(json!({ "Hash Batches": 4 }));
    assert!(first_text(&hash).contains("did not fit in memory"));
    let temp = one_step(json!({ "Temp Written Blocks": 12 }));
    assert!(first_text(&temp).contains("wrote 12 pages"));
}

#[test]
fn explains_many_loops_and_missing_workers() {
    let loops = one_step(json!({ "Actual Loops": 5000 }));
    assert!(first_text(&loops).contains("ran 5,000 times"));
    let workers = one_step(json!({ "Workers Planned": 4, "Workers Launched": 2 }));
    assert!(first_text(&workers).contains("only 2 started"));
    let never = one_step(json!({ "Actual Loops": 0 }));
    assert!(first_text(&never).contains("did not run"));
}

#[test]
fn tells_about_pages_from_the_disk_and_heap_fetches() {
    let cache = one_step(json!({ "Shared Read Blocks": 5000, "Shared Hit Blocks": 10 }));
    assert!(first_text(&cache).contains("not in the cache"));
    let fetches = one_step(json!({ "Node Type": "Index Only Scan", "Heap Fetches": 30 }));
    assert!(first_text(&fetches).contains("VACUUM"));
    let lossy = one_step(json!({ "Lossy Heap Blocks": 3 }));
    assert!(first_text(&lossy).contains("work_mem"));
}

#[test]
fn uses_the_blocks_of_the_step_without_the_blocks_of_its_child_steps() {
    let plan = read_json(json!([{
        "Plan": {
            "Node Type": "Sort",
            "Actual Rows": 1,
            "Actual Loops": 1,
            "Shared Read Blocks": 5000,
            "Plans": [{
                "Node Type": "Seq Scan",
                "Actual Rows": 1,
                "Actual Loops": 1,
                "Shared Read Blocks": 5000,
            }],
        },
    }]));

    assert_eq!(plan.hints.len(), 1);
    assert_eq!(plan.hints[0].step, "0.0");
    assert!(plan.hints[0].text.contains("not in the cache"));
}

#[test]
fn counts_the_removed_rows_of_all_runs() {
    let plan = one_step(json!({
        "Actual Rows": 1,
        "Actual Loops": 200,
        "Rows Removed by Filter": 50,
    }));

    assert!(
        texts(&plan)
            .iter()
            .any(|text| text.contains("read 10,200 rows and kept only 200"))
    );
}

#[test]
fn gives_the_hints_depth_first_with_the_path_of_the_step() {
    let child = json!({ "Node Type": "Seq Scan", "Actual Loops": 0 });
    let plan = read_json(json!([{
        "Plan": {
            "Node Type": "Append",
            "Actual Loops": 0,
            "Plans": [child, { "Node Type": "Append", "Plans": [child] }],
        },
    }]));

    let steps: Vec<&str> = plan.hints.iter().map(|hint| hint.step.as_str()).collect();
    assert_eq!(steps, ["0", "0.0", "0.1.0"]);
}

#[test]
fn formats_numbers_like_the_ui() {
    assert_eq!(format_count(105_000.0), "105,000");
    assert_eq!(format_count(999.0), "999");
    assert_eq!(format_count(1_234_567.5), "1,234,567.5");
    assert_eq!(format_count(0.0), "0");
    assert_eq!(super::number_text(189.0), "189");
    assert_eq!(super::number_text(231.52), "231.52");
}

//! Converts the answer of the MongoDB command `explain` into the common plan form of
//! Tabloxide.
//!
//! MongoDB gives three forms:
//!
//! - The classic engine gives the tree of `queryPlanner.winningPlan`. With
//!   `executionStats`, `executionStages` is the same tree with measured values.
//! - The slot-based engine (SBE) gives the tree in `winningPlan.queryPlan`. Its
//!   `executionStages` is a different tree of engine stages. A `planNodeId` connects
//!   the two trees.
//! - `aggregate` gives a list `stages`. The first stage `$cursor` has the plan of
//!   the query. Each next stage gives its rows to the stage after it.

mod glossary;
mod hints;

use serde_json::{Map, Value};
use std::collections::HashMap;
use tabloxide_core::{Plan, PlanField, PlanStep, json_field_text};

type Object = Map<String, Value>;

/// The keys of a stage that have its child stages.
const CHILD_KEYS: [&str; 6] = [
    "inputStage",
    "inputStages",
    "outerStage",
    "innerStage",
    "thenStage",
    "elseStage",
];

/// The keys of a stage that the step has in a different form.
const STRUCTURE_KEYS: [&str; 2] = ["stage", "planNodeId"];

/// Returns the plan in the common form, or `None` if the answer has a form that
/// this module does not know, for example the answer of a sharded cluster.
pub(crate) fn plan_of(answer: &Value) -> Option<Plan> {
    let answer = answer.as_object()?;
    let (root, root_ms, query) = match answer.get("stages").and_then(Value::as_array) {
        Some(stages) => pipeline(stages)?,
        None => {
            let query = query(answer)?;
            (query.root.clone(), query.root_ms, query)
        }
    };
    let total_ms = match (query.total_ms, root_ms) {
        (Some(total), Some(root)) => Some(total.max(root)),
        (total, root) => total.or(root),
    };
    let mut plan = Plan {
        root,
        is_measured: query.is_measured,
        total_ms: if query.is_measured { total_ms } else { None },
        planning_ms: query.planning_ms,
        cost_unit: "documents and keys examined".to_owned(),
        totals: query.totals,
        hints: Vec::new(),
    };
    plan.hints = hints::of(&plan.root);
    Some(plan)
}

/// The plan of one query, from a `queryPlanner` and an `executionStats` section.
struct Query {
    root: PlanStep,
    /// The time of the root step with its child steps.
    root_ms: Option<f64>,
    totals: Vec<PlanField>,
    total_ms: Option<f64>,
    planning_ms: Option<f64>,
    is_measured: bool,
}

fn query(section: &Object) -> Option<Query> {
    let planner = section.get("queryPlanner")?.as_object()?;
    let winning = planner.get("winningPlan")?.as_object()?;
    let tree = winning
        .get("queryPlan")
        .and_then(Value::as_object)
        .unwrap_or(winning);
    tree.get("stage")?;
    let collection = planner
        .get("namespace")
        .and_then(Value::as_str)
        .map(|namespace| {
            namespace
                .split_once('.')
                .map_or(namespace, |(_, name)| name)
                .to_owned()
        });
    let stats = section.get("executionStats").and_then(Value::as_object);
    let stages = stats
        .and_then(|stats| stats.get("executionStages"))
        .and_then(Value::as_object);
    let (root, root_ms) = match stages {
        // The classic engine: the measured tree is the plan tree.
        Some(stages) if !tree.contains_key("planNodeId") => {
            step(stages, &Context::new(collection.as_deref(), None))
        }
        Some(stages) => {
            let measured = sbe_stats(stages);
            step(tree, &Context::new(collection.as_deref(), Some(&measured)))
        }
        None => step(tree, &Context::new(collection.as_deref(), None)),
    };
    Some(Query {
        root,
        root_ms,
        totals: totals(planner, stats),
        total_ms: stats.and_then(|stats| number(stats.get("executionTimeMillis"))),
        planning_ms: number(planner.get("optimizationTimeMillis")),
        is_measured: stats.is_some(),
    })
}

/// The plan of an `aggregate`: the plan of `$cursor`, then one step for each next
/// stage. Each stage has the stage before it as its child.
fn pipeline(stages: &[Value]) -> Option<(PlanStep, Option<f64>, Query)> {
    let (first, rest) = stages.split_first()?;
    let cursor = first.as_object()?.get("$cursor")?.as_object()?;
    let query = query(cursor)?;
    let mut current = query.root.clone();
    let mut current_ms = query.root_ms;
    for stage in rest {
        let (step, inclusive_ms) = pipeline_step(stage.as_object()?, current, current_ms)?;
        current = step;
        current_ms = inclusive_ms;
    }
    Some((current, current_ms, query))
}

/// The values of a stage of a pipeline that are not its definition.
const PIPELINE_STATS: [&str; 11] = [
    "nReturned",
    "executionTimeMillisEstimate",
    "totalDocsExamined",
    "totalKeysExamined",
    "collectionScans",
    "indexesUsed",
    "usedDisk",
    "spills",
    "spilledDataStorageSize",
    "totalDataSizeSortedBytesEstimate",
    "spilledBytes",
];

fn pipeline_step(
    stage: &Object,
    child: PlanStep,
    child_ms: Option<f64>,
) -> Option<(PlanStep, Option<f64>)> {
    let (operation, spec) = stage.iter().find(|(key, _)| key.starts_with('$'))?;
    let target = spec.get("from").and_then(Value::as_str).map(str::to_owned);
    let mut fields: Vec<PlanField> = match spec {
        Value::Object(spec) => spec
            .iter()
            .filter_map(|(name, value)| field(name, value))
            .collect(),
        other => field(operation, other).into_iter().collect(),
    };
    fields.extend(
        stage
            .iter()
            .filter(|(key, _)| PIPELINE_STATS.contains(&key.as_str()))
            .filter_map(|(name, value)| field(name, value)),
    );
    let inclusive_ms = number(stage.get("executionTimeMillisEstimate"));
    let step = PlanStep {
        operation: operation.clone(),
        target,
        explanation: glossary::stage_text(operation),
        actual_rows: number(stage.get("nReturned")),
        estimated_rows: None,
        loops: None,
        self_cost: examined(stage, "totalDocsExamined", "totalKeysExamined"),
        self_ms: own_ms(inclusive_ms, &[child_ms]),
        fields,
        children: vec![child],
    };
    Some((step, inclusive_ms))
}

/// The measured values of one node of the query plan in the SBE engine.
#[derive(Debug, Clone, Copy, Default)]
struct Measured {
    returned: Option<f64>,
    ms: Option<f64>,
}

/// Collects the measured values of the SBE stages by `planNodeId`. The first stage
/// of a node, from the root, gives the values of the node.
fn sbe_stats(stage: &Object) -> HashMap<u64, Measured> {
    let mut found = HashMap::new();
    collect_sbe(stage, &mut found);
    found
}

fn collect_sbe(stage: &Object, found: &mut HashMap<u64, Measured>) {
    if let Some(id) = stage.get("planNodeId").and_then(Value::as_u64) {
        found.entry(id).or_insert(Measured {
            returned: number(stage.get("nReturned")),
            ms: number(stage.get("executionTimeMillisEstimate")),
        });
    }
    for child in children_of(stage) {
        collect_sbe(child, found);
    }
}

struct Context<'a> {
    collection: Option<&'a str>,
    sbe: Option<&'a HashMap<u64, Measured>>,
}

impl<'a> Context<'a> {
    fn new(collection: Option<&'a str>, sbe: Option<&'a HashMap<u64, Measured>>) -> Self {
        Self { collection, sbe }
    }
}

fn children_of(stage: &Object) -> Vec<&Object> {
    CHILD_KEYS
        .iter()
        .filter_map(|key| stage.get(*key))
        .flat_map(|value| match value {
            Value::Array(items) => items.iter().filter_map(Value::as_object).collect(),
            Value::Object(object) => vec![object],
            _ => Vec::new(),
        })
        .collect()
}

/// Converts one stage and its child stages. Returns the step and its time with the
/// time of its child steps.
fn step(stage: &Object, context: &Context<'_>) -> (PlanStep, Option<f64>) {
    let (children, children_ms): (Vec<PlanStep>, Vec<Option<f64>>) = children_of(stage)
        .into_iter()
        .map(|child| step(child, context))
        .unzip();
    let operation = stage
        .get("stage")
        .and_then(Value::as_str)
        .unwrap_or("STAGE")
        .to_owned();
    let sbe = stage
        .get("planNodeId")
        .and_then(Value::as_u64)
        .and_then(|id| context.sbe?.get(&id).copied());
    let returned = sbe
        .and_then(|measured| measured.returned)
        .or_else(|| number(stage.get("nReturned")));
    let inclusive_ms = sbe
        .and_then(|measured| measured.ms)
        .or_else(|| number(stage.get("executionTimeMillisEstimate")));
    let mut fields: Vec<PlanField> = stage
        .iter()
        .filter(|(key, _)| {
            !STRUCTURE_KEYS.contains(&key.as_str()) && !CHILD_KEYS.contains(&key.as_str())
        })
        .filter_map(|(name, value)| field(name, value))
        .collect();
    if let Some(measured) = sbe {
        let values = [
            ("nReturned", measured.returned),
            ("executionTimeMillisEstimate", measured.ms),
        ];
        fields.extend(
            values
                .into_iter()
                .filter_map(|(name, value)| field(name, &Value::from(value?))),
        );
    }
    let target = match stage.get("indexName").and_then(Value::as_str) {
        Some(index) => Some(format!("index {index}")),
        None if glossary::reads_collection(&operation) => context.collection.map(str::to_owned),
        None => None,
    };
    let step = PlanStep {
        explanation: glossary::stage_text(&operation),
        operation,
        target,
        fields,
        estimated_rows: None,
        actual_rows: returned,
        loops: None,
        self_cost: examined(stage, "docsExamined", "keysExamined"),
        self_ms: own_ms(inclusive_ms, &children_ms),
        children,
    };
    (step, inclusive_ms)
}

/// The documents and the keys that a stage examined, or `None` if it gives neither.
fn examined(stage: &Object, documents: &str, keys: &str) -> Option<f64> {
    let documents = number(stage.get(documents));
    let keys = number(stage.get(keys));
    if documents.is_none() && keys.is_none() {
        return None;
    }
    Some(documents.unwrap_or(0.0) + keys.unwrap_or(0.0))
}

/// The time of a step without the time of its child steps. MongoDB gives the time
/// of a stage with the time of its child stages.
fn own_ms(inclusive_ms: Option<f64>, children_ms: &[Option<f64>]) -> Option<f64> {
    let children: f64 = children_ms.iter().flatten().sum();
    inclusive_ms.map(|total| (total - children).max(0.0))
}

fn number(value: Option<&Value>) -> Option<f64> {
    value?.as_f64()
}

fn field(name: &str, value: &Value) -> Option<PlanField> {
    let (group, explanation) = glossary::field_info(name);
    Some(PlanField {
        name: name.to_owned(),
        value: json_field_text(value)?,
        explanation: explanation.map(str::to_owned),
        group,
    })
}

/// The data of the complete statement.
fn totals(planner: &Object, stats: Option<&Object>) -> Vec<PlanField> {
    let mut totals: Vec<PlanField> = ["namespace", "parsedQuery", "indexFilterSet"]
        .into_iter()
        .filter_map(|name| field(name, planner.get(name)?))
        .collect();
    if let Some(rejected) = planner.get("rejectedPlans").and_then(Value::as_array) {
        totals.extend(field("rejectedPlans", &Value::from(rejected.len())));
    }
    if let Some(stats) = stats {
        totals.extend(
            ["nReturned", "totalKeysExamined", "totalDocsExamined"]
                .into_iter()
                .filter_map(|name| field(name, stats.get(name)?)),
        );
    }
    totals
}

#[cfg(test)]
mod tests {
    use super::*;
    use tabloxide_core::HintLevel;

    fn parse(text: &str) -> Plan {
        plan_of(&serde_json::from_str(text).unwrap()).expect("a plan")
    }

    fn value<'a>(step: &'a PlanStep, name: &str) -> Option<&'a str> {
        step.fields
            .iter()
            .find(|field| field.name == name)
            .map(|field| field.value.as_str())
    }

    #[test]
    fn a_measured_find_has_the_tree_of_the_classic_engine() {
        let plan = parse(include_str!("fixtures/find-sort-measured.json"));

        assert!(plan.is_measured);
        assert_eq!(plan.root.operation, "SORT");
        let fetch = &plan.root.children[0];
        let scan = &fetch.children[0];
        assert_eq!(fetch.operation, "FETCH");
        assert_eq!(scan.operation, "IXSCAN");
        assert_eq!(scan.target.as_deref(), Some("index status_1"));
        assert_eq!(scan.actual_rows, Some(285.0));
        assert_eq!(scan.self_cost, Some(285.0));
        assert_eq!(value(scan, "keysExamined"), Some("285"));
        assert!(scan.explanation.is_some());
        assert!(plan.total_ms.is_some());
        assert_eq!(plan.cost_unit, "documents and keys examined");
        assert!(
            plan.totals
                .iter()
                .any(|field| field.name == "totalDocsExamined")
        );
    }

    #[test]
    fn a_sort_in_memory_gets_a_warning() {
        let plan = parse(include_str!("fixtures/find-sort-measured.json"));

        let sort = plan
            .hints
            .iter()
            .find(|hint| hint.title == "Sort in memory")
            .expect("a sort hint");
        assert_eq!(sort.step, "0");
        assert_eq!(sort.level, HintLevel::Warning);
        assert!(sort.text.contains("orderedAt"), "{}", sort.text);
    }

    #[test]
    fn an_estimate_has_no_measured_values() {
        let plan = parse(include_str!("fixtures/find-sort-estimate.json"));

        assert!(!plan.is_measured);
        assert_eq!(plan.total_ms, None);
        assert_eq!(plan.root.actual_rows, None);
        assert_eq!(plan.root.children[0].children[0].operation, "IXSCAN");
    }

    #[test]
    fn a_collection_scan_that_returns_few_documents_needs_an_index() {
        let plan = parse(include_str!("fixtures/collscan-measured.json"));

        assert_eq!(plan.root.operation, "COLLSCAN");
        assert_eq!(plan.root.target.as_deref(), Some("orders"));
        let hint = plan
            .hints
            .iter()
            .find(|hint| hint.title == "No index for the filter")
            .expect("a scan hint");
        assert_eq!(hint.level, HintLevel::Warning);
        assert!(hint.text.contains("1,500"), "{}", hint.text);
    }

    #[test]
    fn a_pipeline_has_one_step_for_each_stage_after_the_cursor() {
        let plan = parse(include_str!("fixtures/aggregate-measured.json"));

        assert_eq!(plan.root.operation, "$lookup");
        assert_eq!(plan.root.target.as_deref(), Some("customers"));
        let sort = &plan.root.children[0];
        assert_eq!(sort.operation, "$sort");
        assert_eq!(sort.actual_rows, Some(136.0));
        // The SBE engine gives the query plan with a node identifier.
        let group = &sort.children[0];
        assert_eq!(group.operation, "GROUP");
        assert_eq!(group.actual_rows, Some(136.0));
        assert_eq!(group.children[0].children[0].operation, "IXSCAN");
        // A time of a pipeline stage includes the stages before it.
        assert!(plan.root.self_ms.unwrap() <= 10.0);
    }

    #[test]
    fn a_count_uses_its_count_scan() {
        let plan = parse(include_str!("fixtures/count-measured.json"));

        assert_eq!(plan.root.operation, "COUNT");
        assert_eq!(plan.root.children[0].operation, "COUNT_SCAN");
        assert_eq!(
            plan.root.children[0].target.as_deref(),
            Some("index status_1")
        );
    }

    #[test]
    fn an_unknown_form_has_no_plan() {
        assert!(plan_of(&serde_json::json!({ "shards": {} })).is_none());
        assert!(plan_of(&serde_json::json!([])).is_none());
    }
}

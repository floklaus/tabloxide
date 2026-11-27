//! Probable causes of a slow MongoDB statement, with what to do.

use tabloxide_core::{HintLevel, PlanHint, PlanStep};

/// A step that reads this many times more documents or keys than it returns reads
/// too much.
const EXAMINED_FACTOR: f64 = 10.0;
/// Fewer examined documents or keys than this are not important.
const MIN_EXAMINED: f64 = 1000.0;

/// Returns the hints of all steps. The path of the root is `0`.
pub(super) fn of(root: &PlanStep) -> Vec<PlanHint> {
    let mut hints = Vec::new();
    collect(root, "0", &mut hints);
    hints
}

fn collect(step: &PlanStep, path: &str, hints: &mut Vec<PlanHint>) {
    for rule in RULES {
        if let Some((level, title, text)) = rule(step) {
            hints.push(PlanHint {
                step: path.to_owned(),
                level,
                title: title.to_owned(),
                text,
            });
        }
    }
    for (index, child) in step.children.iter().enumerate() {
        collect(child, &format!("{path}.{index}"), hints);
    }
}

type Hint = (HintLevel, &'static str, String);

const RULES: [fn(&PlanStep) -> Option<Hint>; 6] = [
    collection_scan,
    sort_in_memory,
    fetch_filter,
    many_keys,
    lookup_without_index,
    spill_to_disk,
];

fn value<'a>(step: &'a PlanStep, name: &str) -> Option<&'a str> {
    step.fields
        .iter()
        .find(|field| field.name == name)
        .map(|field| field.value.as_str())
}

fn number(step: &PlanStep, name: &str) -> Option<f64> {
    value(step, name)?.parse().ok()
}

/// `true` if the step read many more items than it returned.
fn reads_too_much(examined: f64, returned: f64) -> bool {
    examined >= MIN_EXAMINED && examined >= returned.max(1.0) * EXAMINED_FACTOR
}

fn collection_scan(step: &PlanStep) -> Option<Hint> {
    if step.operation != "COLLSCAN" {
        return None;
    }
    let filter = value(step, "filter");
    let Some(examined) = number(step, "docsExamined") else {
        // An estimate has no counts. A scan with a filter is a probable problem.
        let filter = filter?;
        return Some((
            HintLevel::Info,
            "Collection scan",
            format!(
                "MongoDB reads all documents of the collection. If the collection is large, an index on the fields of the filter {filter} can help."
            ),
        ));
    };
    let returned = step.actual_rows.unwrap_or(0.0);
    if !reads_too_much(examined, returned) {
        return None;
    }
    let advice = match filter {
        Some(filter) => format!(
            " An index on the fields of the filter {filter} lets MongoDB read only the necessary documents."
        ),
        None => " The statement has no filter, thus MongoDB must read all documents.".to_owned(),
    };
    Some((
        HintLevel::Warning,
        "No index for the filter",
        format!(
            "The collection scan read {} documents and returned {}.{advice}",
            count(examined),
            count(returned)
        ),
    ))
}

fn sort_in_memory(step: &PlanStep) -> Option<Hint> {
    if !matches!(step.operation.as_str(), "SORT" | "sort" | "$sort") {
        return None;
    }
    let pattern = value(step, "sortPattern").or_else(|| value(step, "sortKey"));
    let on_disk = value(step, "usedDisk") == Some("yes");
    let fields = pattern.map_or_else(String::new, |pattern| format!(" ({pattern})"));
    if on_disk {
        return Some((
            HintLevel::Warning,
            "Sort on disk",
            format!(
                "The sort did not fit in memory and wrote data to disk. An index with the fields of the sort{fields}, after the fields of equality conditions, gives the documents in the correct sequence without a sort."
            ),
        ));
    }
    let level = if value(step, "limitAmount").is_some() {
        HintLevel::Info
    } else {
        HintLevel::Warning
    };
    Some((
        level,
        "Sort in memory",
        format!(
            "MongoDB sorts the documents in memory. An index with the fields of the sort{fields}, after the fields of equality conditions, gives the documents in the correct sequence without a sort."
        ),
    ))
}

fn fetch_filter(step: &PlanStep) -> Option<Hint> {
    if step.operation != "FETCH" {
        return None;
    }
    let filter = value(step, "filter")?;
    let examined = number(step, "docsExamined")?;
    let returned = step.actual_rows.unwrap_or(0.0);
    if !reads_too_much(examined, returned) {
        return None;
    }
    Some((
        HintLevel::Warning,
        "Index does not cover the filter",
        format!(
            "The step read {} documents and kept {}. The index finds the candidates, but the condition {filter} needs the documents. A compound index with these fields lets MongoDB skip the other documents.",
            count(examined),
            count(returned)
        ),
    ))
}

fn many_keys(step: &PlanStep) -> Option<Hint> {
    if !step.operation.contains("IXSCAN") {
        return None;
    }
    let examined = number(step, "keysExamined")?;
    let returned = step.actual_rows.unwrap_or(0.0);
    if !reads_too_much(examined, returned) {
        return None;
    }
    Some((
        HintLevel::Info,
        "Index reads many keys",
        format!(
            "The index scan read {} keys and returned {}. The sequence of the fields in the index can be wrong. Put the fields of equality conditions first, then the sort fields, then the range fields.",
            count(examined),
            count(returned)
        ),
    ))
}

fn lookup_without_index(step: &PlanStep) -> Option<Hint> {
    if step.operation != "$lookup" {
        return None;
    }
    let scans = number(step, "collectionScans")?;
    if scans <= 0.0 {
        return None;
    }
    let from = step.target.as_deref().unwrap_or("the other collection");
    let field = value(step, "foreignField")
        .map_or_else(String::new, |field| format!(" on the field {field}"));
    Some((
        HintLevel::Warning,
        "Lookup without an index",
        format!(
            "The $lookup read the collection {from} without an index {} times. An index{field} of {from} lets MongoDB find the matching documents directly.",
            count(scans)
        ),
    ))
}

fn spill_to_disk(step: &PlanStep) -> Option<Hint> {
    if matches!(step.operation.as_str(), "SORT" | "sort" | "$sort") {
        // The sort rule tells this case.
        return None;
    }
    let spills = number(step, "spills").unwrap_or(0.0);
    if value(step, "usedDisk") != Some("yes") && spills <= 0.0 {
        return None;
    }
    Some((
        HintLevel::Info,
        "Data on disk",
        "The step did not fit in memory and wrote data to disk. Disk is slower than memory. Fewer or smaller documents before this step can help.".to_owned(),
    ))
}

/// Writes a number as an integer with commas, for example `105,000`.
fn count(value: f64) -> String {
    // The values are counts of documents or keys, thus whole numbers.
    #[allow(clippy::cast_possible_truncation)]
    let digits = (value.round() as i64).unsigned_abs().to_string();
    let mut text = String::new();
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            text.push(',');
        }
        text.push(digit);
    }
    if value < 0.0 {
        text.insert(0, '-');
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use tabloxide_core::PlanField;

    fn step(operation: &str, fields: &[(&str, &str)], returned: f64) -> PlanStep {
        PlanStep {
            operation: operation.to_owned(),
            target: Some("customers".to_owned()),
            explanation: None,
            fields: fields
                .iter()
                .map(|(name, value)| PlanField::new(*name, *value))
                .collect(),
            estimated_rows: None,
            actual_rows: Some(returned),
            loops: None,
            self_cost: None,
            self_ms: None,
            children: Vec::new(),
        }
    }

    #[test]
    fn writes_counts_with_commas() {
        assert_eq!(count(5.0), "5");
        assert_eq!(count(1500.0), "1,500");
        assert_eq!(count(105_000.0), "105,000");
        assert_eq!(count(1_234_567.0), "1,234,567");
    }

    #[test]
    fn a_fetch_with_a_filter_that_removes_most_documents_gets_a_warning() {
        let fetch = step(
            "FETCH",
            &[
                ("filter", "{\"total\":{\"$gt\":100}}"),
                ("docsExamined", "5000"),
            ],
            12.0,
        );

        let hints = of(&fetch);

        assert_eq!(hints.len(), 1);
        assert_eq!(hints[0].title, "Index does not cover the filter");
        assert!(hints[0].text.contains("5,000 documents and kept 12"));
    }

    #[test]
    fn a_lookup_without_an_index_names_the_field() {
        let lookup = step(
            "$lookup",
            &[("collectionScans", "136"), ("foreignField", "customerId")],
            136.0,
        );

        let hints = of(&lookup);

        assert_eq!(hints[0].title, "Lookup without an index");
        assert!(hints[0].text.contains("customers"));
        assert!(hints[0].text.contains("customerId"));
    }

    #[test]
    fn a_top_k_sort_is_only_a_note() {
        let sort = step("SORT", &[("limitAmount", "10")], 10.0);

        assert_eq!(of(&sort)[0].level, HintLevel::Info);
    }

    #[test]
    fn a_scan_that_returns_most_documents_has_no_hint() {
        let scan = step("COLLSCAN", &[("docsExamined", "1500")], 1400.0);

        assert!(of(&scan).is_empty());
    }

    #[test]
    fn child_steps_have_their_path() {
        let mut root = step("LIMIT", &[], 1.0);
        root.children = vec![step("IXSCAN", &[], 1.0), step("SORT", &[], 1.0)];

        let hints = of(&root);

        assert_eq!(hints[0].step, "0.1");
    }
}

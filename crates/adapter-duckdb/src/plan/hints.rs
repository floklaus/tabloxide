//! The hints of the engine about the steps of a DuckDB plan. The rules come from
//! `ui/src/plan/planHints.ts`. The UI adds the hints for all engines: the costly
//! steps and the misestimates.

use super::json::{format_count, parse_number};
use tabloxide_core::{HintLevel, PlanHint, PlanStep};

/// A scan that reads this many times more rows than it gives reads too many rows.
const REMOVED_FACTOR: f64 = 10.0;
/// Fewer read rows than this are not important.
const MIN_REMOVED: f64 = 1000.0;

/// Returns the hints of `step` and of its child steps. The parent comes before its
/// child steps. `path` is the path of `step`, for example `0.1`.
pub(super) fn hints_of(step: &PlanStep, path: &str) -> Vec<PlanHint> {
    let own = scan_hint(step).map(|(level, title, text)| PlanHint {
        step: path.to_owned(),
        level,
        title: title.to_owned(),
        text,
    });
    own.into_iter()
        .chain(
            step.children
                .iter()
                .enumerate()
                .flat_map(|(index, child)| hints_of(child, &format!("{path}.{index}"))),
        )
        .collect()
}

/// Returns the number in the field `name` of the step.
fn number_of(step: &PlanStep, name: &str) -> Option<f64> {
    step.fields
        .iter()
        .find(|field| field.name == name)
        .and_then(|field| parse_number(&field.value))
}

/// Tells when a scan reads many more rows than it gives.
fn scan_hint(step: &PlanStep) -> Option<(HintLevel, &'static str, String)> {
    let scanned =
        number_of(step, "rows_scanned").or_else(|| number_of(step, "operator_rows_scanned"))?;
    let kept = step.actual_rows?;
    if scanned < MIN_REMOVED || scanned < kept.max(1.0) * REMOVED_FACTOR {
        return None;
    }
    Some((
        HintLevel::Info,
        "Scan reads many rows",
        format!(
            "The scan read {} rows and gave {}. If the table is sorted on the filter column, DuckDB can skip more row groups.",
            format_count(scanned),
            format_count(kept)
        ),
    ))
}

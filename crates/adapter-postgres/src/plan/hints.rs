//! Probable causes of a slow statement in a PostgreSQL plan.
//!
//! The UI adds the hints for the costliest steps and for the misestimates. These
//! hints apply to all engines. This module gives only the hints of PostgreSQL.

use super::{number_text, parse_number};
use tabloxide_core::{HintLevel, PlanHint, PlanStep};

/// A step that removes this many times more rows than it keeps reads too many rows.
const REMOVED_FACTOR: f64 = 10.0;
/// Fewer removed rows than this are not important.
const MIN_REMOVED: f64 = 1000.0;
/// An inner step that runs this many times or more is important.
const MANY_LOOPS: f64 = 1000.0;
/// Fewer blocks than this from the disk are not important.
const MIN_READ_BLOCKS: f64 = 1000.0;

/// A hint without the path of its step.
struct Hint {
    level: HintLevel,
    title: &'static str,
    text: String,
}

type HintRule = fn(&PlanStep) -> Option<Hint>;

/// The rules in the sequence of the hints of one step.
const STEP_HINTS: [HintRule; 10] = [
    filter_hint,
    sort_hint,
    hash_hint,
    temp_hint,
    lossy_hint,
    heap_fetch_hint,
    cache_hint,
    loop_hint,
    worker_hint,
    never_hint,
];

/// Returns the hints of all steps. A parent step comes before its child steps.
pub(super) fn plan_hints(root: &PlanStep) -> Vec<PlanHint> {
    let mut hints = Vec::new();
    collect(root, "0", &mut hints);
    hints
}

fn collect(step: &PlanStep, path: &str, hints: &mut Vec<PlanHint>) {
    hints.extend(
        STEP_HINTS
            .iter()
            .filter_map(|rule| rule(step))
            .map(|hint| PlanHint {
                step: path.to_owned(),
                level: hint.level,
                title: hint.title.to_owned(),
                text: hint.text,
            }),
    );
    for (index, child) in step.children.iter().enumerate() {
        collect(child, &format!("{path}.{index}"), hints);
    }
}

fn value<'a>(step: &'a PlanStep, key: &str) -> Option<&'a str> {
    step.fields
        .iter()
        .find(|field| field.name == key)
        .map(|field| field.value.as_str())
}

fn number_of(step: &PlanStep, key: &str) -> Option<f64> {
    value(step, key).and_then(parse_number)
}

/// Returns the value of a block counter for the step alone. PostgreSQL counts the
/// blocks of a step together with the blocks of its child steps.
fn own_blocks(step: &PlanStep, key: &str) -> Option<f64> {
    let total = number_of(step, key)?;
    let children: f64 = step
        .children
        .iter()
        .map(|child| number_of(child, key).unwrap_or(0.0))
        .sum();
    Some((total - children).max(0.0))
}

fn warning(title: &'static str, text: String) -> Option<Hint> {
    Some(Hint {
        level: HintLevel::Warning,
        title,
        text,
    })
}

fn info(title: &'static str, text: String) -> Option<Hint> {
    Some(Hint {
        level: HintLevel::Info,
        title,
        text,
    })
}

fn filter_hint(step: &PlanStep) -> Option<Hint> {
    // PostgreSQL gives the removed rows of one run, as the actual rows.
    let loops = step.loops.unwrap_or(1.0);
    let removed = number_of(step, "Rows Removed by Filter")? * loops;
    let kept = step.actual_rows.unwrap_or(0.0) * loops;
    if removed < MIN_REMOVED || removed < kept.max(1.0) * REMOVED_FACTOR {
        return None;
    }
    let advice = match value(step, "Filter") {
        Some(filter) if step.operation.contains("Seq Scan") => format!(
            " An index on the columns of the filter {filter} can let the database read only the necessary rows."
        ),
        _ => " The condition removes most rows only after the read.".to_owned(),
    };
    warning(
        "Filter removes most rows",
        format!(
            "The step read {} rows and kept only {}.{advice}",
            format_count(removed + kept),
            format_count(kept)
        ),
    )
}

fn sort_hint(step: &PlanStep) -> Option<Hint> {
    let method = value(step, "Sort Method").unwrap_or_default();
    if !method.contains("external") && value(step, "Sort Space Type") != Some("Disk") {
        return None;
    }
    let space = match number_of(step, "Sort Space Used") {
        None => ". ".to_owned(),
        Some(space) => format!(" ({} kB). ", format_count(space)),
    };
    warning(
        "Sort on disk",
        format!(
            "The sort did not fit in memory and used temporary files on disk{space}A larger work_mem can keep it in memory. An index with the sort columns can make the sort unnecessary."
        ),
    )
}

fn hash_hint(step: &PlanStep) -> Option<Hint> {
    let batches = number_of(step, "Hash Batches").or_else(|| number_of(step, "HashAgg Batches"));
    let disk = number_of(step, "Disk Usage");
    if batches.is_none_or(|batches| batches <= 1.0) && disk.is_none_or(|disk| disk <= 0.0) {
        return None;
    }
    warning(
        "Hash table on disk",
        "The hash table did not fit in memory, so the database divided it into parts on disk. A larger work_mem (or hash_mem_multiplier) can keep it in memory.".to_owned(),
    )
}

fn temp_hint(step: &PlanStep) -> Option<Hint> {
    let written = own_blocks(step, "Temp Written Blocks").filter(|written| *written > 0.0)?;
    warning(
        "Temporary files",
        format!(
            "The step wrote {} pages (8 kB each) to temporary files. Temporary files are slower than memory.",
            format_count(written)
        ),
    )
}

fn lossy_hint(step: &PlanStep) -> Option<Hint> {
    number_of(step, "Lossy Heap Blocks").filter(|lossy| *lossy > 0.0)?;
    info(
        "Lossy bitmap",
        "The bitmap did not fit in work_mem. For some pages, the step had to check each row again."
            .to_owned(),
    )
}

fn heap_fetch_hint(step: &PlanStep) -> Option<Hint> {
    let fetches = number_of(step, "Heap Fetches").filter(|fetches| *fetches > 0.0)?;
    if !step.operation.contains("Index Only") {
        return None;
    }
    info(
        "Reads from the table",
        format!(
            "The index-only scan read {} rows from the table. VACUUM on the table updates the visibility map and decreases these reads.",
            format_count(fetches)
        ),
    )
}

fn cache_hint(step: &PlanStep) -> Option<Hint> {
    let read = own_blocks(step, "Shared Read Blocks")?;
    let hit = own_blocks(step, "Shared Hit Blocks").unwrap_or(0.0);
    if read < MIN_READ_BLOCKS || read <= hit {
        return None;
    }
    info(
        "Pages not in the cache",
        format!(
            "Most pages ({} of {}) were not in the cache of the server. A second run is often faster, because the pages are then in the cache.",
            format_count(read),
            format_count(read + hit)
        ),
    )
}

fn loop_hint(step: &PlanStep) -> Option<Hint> {
    let loops = step.loops.filter(|loops| *loops >= MANY_LOOPS)?;
    let loops = format_count(loops);
    info(
        "Step runs many times",
        format!(
            "This step ran {loops} times, one time for each row of the step above it. The time of one run is small, but the total is the time × {loops}."
        ),
    )
}

fn worker_hint(step: &PlanStep) -> Option<Hint> {
    let planned = number_of(step, "Workers Planned")?;
    let launched = number_of(step, "Workers Launched")?;
    if launched >= planned {
        return None;
    }
    info(
        "Fewer parallel workers",
        format!(
            "The planner wanted {} parallel processes, but only {} started. The server had no more free processes (max_parallel_workers).",
            number_text(planned),
            number_text(launched)
        ),
    )
}

fn never_hint(step: &PlanStep) -> Option<Hint> {
    if step.loops != Some(0.0) {
        return None;
    }
    info(
        "Step did not run",
        "This step did not run. The database did not need its rows, for example because a different step gave no rows.".to_owned(),
    )
}

/// Writes a number with commas between the groups of thousands and a maximum of
/// three decimals, as `Intl.NumberFormat('en')` does. For example `105,000`.
pub(super) fn format_count(value: f64) -> String {
    let fixed = format!("{:.3}", value.abs());
    let (whole, decimals) = fixed.split_once('.').unwrap_or((&fixed, ""));
    let decimals = decimals.trim_end_matches('0');
    let mut grouped = String::new();
    for (index, digit) in whole.chars().enumerate() {
        if index > 0 && (whole.len() - index) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(digit);
    }
    let sign = if value < 0.0 && fixed.chars().any(|digit| ('1'..='9').contains(&digit)) {
        "-"
    } else {
        ""
    };
    if decimals.is_empty() {
        format!("{sign}{grouped}")
    } else {
        format!("{sign}{grouped}.{decimals}")
    }
}

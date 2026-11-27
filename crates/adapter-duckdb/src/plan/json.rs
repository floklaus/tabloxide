//! Helpers that read values of the JSON plan. They give the same text as the
//! JavaScript of the UI gave before, so that the fields do not change.

use serde_json::{Map, Value};

pub(super) type Json = Map<String, Value>;

/// Returns the value of the first key that has a value that is not `null`.
pub(super) fn pick<'a>(object: &'a Json, keys: &[&str]) -> Option<&'a Value> {
    keys.iter()
        .find_map(|key| object.get(*key).filter(|value| !value.is_null()))
}

/// Returns a number, or a text with a number, as a finite number.
pub(super) fn number(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Number(number) => number.as_f64().filter(|value| value.is_finite()),
        Value::String(text) => parse_number(text),
        _ => None,
    }
}

/// Reads a text as a number, as the JavaScript `Number` function does for decimal
/// text. An empty text is 0.
pub(super) fn parse_number(text: &str) -> Option<f64> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Some(0.0);
    }
    trimmed
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite())
}

/// Returns a JSON value as the text of a field, or `None` for no value.
pub(super) fn text(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::Null => None,
        Value::String(text) if text.is_empty() => None,
        Value::Array(items) if items.is_empty() => None,
        Value::Array(items) => Some(items.iter().map(item_text).collect::<Vec<_>>().join(", ")),
        other => Some(item_text(other)),
    }
}

/// Returns the text of one value, as the JavaScript `String` function does. An
/// object becomes its JSON text.
fn item_text(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(flag) => if *flag { "yes" } else { "no" }.to_owned(),
        Value::Number(number) => number
            .as_f64()
            .map_or_else(|| number.to_string(), js_number),
        Value::String(text) => text.clone(),
        Value::Array(items) => items.iter().map(item_text).collect::<Vec<_>>().join(","),
        Value::Object(_) => value.to_string(),
    }
}

/// Returns the fields of `object` as name and text, without the keys in `skip`.
pub(super) fn fields_of(object: &Json, skip: &[&str]) -> Vec<(String, String)> {
    object
        .iter()
        .filter(|(key, _)| !skip.contains(&key.as_str()))
        .filter_map(|(key, value)| text(Some(value)).map(|shown| (key.clone(), shown)))
        .collect()
}

/// The largest exponent that JavaScript writes without the `e` notation.
const MAX_PLAIN_DIGITS: i32 = 21;
/// The smallest exponent that JavaScript writes without the `e` notation.
const MIN_PLAIN_EXPONENT: i32 = -6;

/// Writes a number as the JavaScript `String` function does, for example `0.000087245`
/// or `3e-7`.
pub(super) fn js_number(value: f64) -> String {
    if value == 0.0 {
        return "0".to_owned();
    }
    let sign = if value < 0.0 { "-" } else { "" };
    // The `e` format of Rust gives the shortest digits that read back as the same number.
    let scientific = format!("{:e}", value.abs());
    let (mantissa, exponent) = scientific
        .split_once('e')
        .unwrap_or((scientific.as_str(), "0"));
    let digits = mantissa.replace('.', "");
    let count = i32::try_from(digits.len()).unwrap_or(i32::MAX);
    let point = exponent.parse::<i32>().unwrap_or(0) + 1;
    let body = if count <= point && point <= MAX_PLAIN_DIGITS {
        format!("{digits}{}", zeros(point - count))
    } else if 0 < point && point <= MAX_PLAIN_DIGITS {
        let (whole, fraction) = digits.split_at(usize::try_from(point).unwrap_or(0));
        format!("{whole}.{fraction}")
    } else if MIN_PLAIN_EXPONENT < point && point <= 0 {
        format!("0.{}{digits}", zeros(-point))
    } else {
        let (first, rest) = digits.split_at(1);
        let shown = if rest.is_empty() {
            first.to_owned()
        } else {
            format!("{first}.{rest}")
        };
        let exponent = point - 1;
        let exponent_sign = if exponent >= 0 { "+" } else { "-" };
        format!("{shown}e{exponent_sign}{}", exponent.abs())
    };
    format!("{sign}{body}")
}

fn zeros(count: i32) -> String {
    "0".repeat(usize::try_from(count).unwrap_or(0))
}

/// The fraction digits of a formatted count, as in `Intl.NumberFormat('en')`.
const COUNT_FRACTION_DIGITS: i32 = 3;

/// Writes a count with commas between the groups of three digits, for example
/// `105,000`. A fraction keeps a maximum of three digits.
pub(super) fn format_count(value: f64) -> String {
    let scale = 10_f64.powi(COUNT_FRACTION_DIGITS);
    let rounded = (value.abs() * scale).round() / scale;
    let plain = format!("{rounded:.3}");
    let (whole, fraction) = plain.split_once('.').unwrap_or((plain.as_str(), ""));
    let fraction = fraction.trim_end_matches('0');
    let mut grouped = String::new();
    for (index, digit) in whole.chars().enumerate() {
        if index > 0 && (whole.len() - index) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(digit);
    }
    let sign = if value < 0.0 && rounded > 0.0 {
        "-"
    } else {
        ""
    };
    if fraction.is_empty() {
        format!("{sign}{grouped}")
    } else {
        format!("{sign}{grouped}.{fraction}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn writes_numbers_as_javascript_does() {
        assert_eq!(js_number(0.0), "0");
        assert_eq!(js_number(7952.0), "7952");
        assert_eq!(js_number(0.000_087_245), "0.000087245");
        assert_eq!(js_number(3e-7), "3e-7");
        assert_eq!(js_number(-2.5), "-2.5");
        assert_eq!(js_number(1e21), "1e+21");
        assert_eq!(js_number(123_000.0), "123000");
    }

    #[test]
    fn formats_counts_with_commas() {
        assert_eq!(format_count(0.0), "0");
        assert_eq!(format_count(999.0), "999");
        assert_eq!(format_count(105_000.0), "105,000");
        assert_eq!(format_count(1_234_567.0), "1,234,567");
        assert_eq!(format_count(2.5), "2.5");
        assert_eq!(format_count(-1000.0), "-1,000");
    }

    #[test]
    fn reads_values_as_text_and_numbers() {
        assert_eq!(text(Some(&json!(["id", "g"]))).as_deref(), Some("id, g"));
        assert_eq!(text(Some(&json!(true))).as_deref(), Some("yes"));
        assert_eq!(text(Some(&json!(0.0))).as_deref(), Some("0"));
        assert_eq!(text(Some(&json!(""))), None);
        assert_eq!(number(Some(&json!("2000"))), Some(2000.0));
        assert_eq!(number(Some(&json!(true))), None);
        assert_eq!(number(Some(&json!("abc"))), None);
    }
}

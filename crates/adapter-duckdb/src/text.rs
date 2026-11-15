//! Conversion of result data to text, and column metadata.

use duckdb::arrow::array::Array;
use duckdb::arrow::datatypes::DataType;
use duckdb::arrow::record_batch::RecordBatch;
use duckdb::arrow::util::display::{ArrayFormatter, FormatOptions};
use tabloxide_core::{Column, ColumnKind, Row};

/// The text for a value that the formatter cannot show.
const NOT_SHOWN: &str = "(the application cannot show this value)";

/// The category of a DuckDB type name, for example `DECIMAL(10,2)` or `TIMESTAMP WITH TIME ZONE`.
pub(crate) fn kind_of_type_name(type_name: &str) -> ColumnKind {
    let upper = type_name.to_ascii_uppercase();
    // A list, a structure, or a map is not in the category of its elements.
    if upper.ends_with(']') || upper.starts_with("STRUCT") || upper.starts_with("MAP") {
        return ColumnKind::Other;
    }
    let base = upper.split(['(', ' ']).next().unwrap_or_default();
    match base {
        "TINYINT" | "SMALLINT" | "INTEGER" | "BIGINT" | "HUGEINT" | "UTINYINT" | "USMALLINT"
        | "UINTEGER" | "UBIGINT" | "UHUGEINT" | "FLOAT" | "DOUBLE" | "DECIMAL" => {
            ColumnKind::Number
        }
        "BOOLEAN" => ColumnKind::Boolean,
        "DATE" | "TIME" | "TIMESTAMP" | "TIMESTAMP_S" | "TIMESTAMP_MS" | "TIMESTAMP_NS"
        | "TIMESTAMPTZ" | "TIMETZ" | "INTERVAL" => ColumnKind::Temporal,
        "JSON" => ColumnKind::Json,
        "VARCHAR" | "UUID" | "ENUM" => ColumnKind::Text,
        _ => ColumnKind::Other,
    }
}

fn kind_of_arrow_type(data_type: &DataType) -> ColumnKind {
    match data_type {
        DataType::Boolean => ColumnKind::Boolean,
        DataType::Utf8 | DataType::LargeUtf8 | DataType::Utf8View => ColumnKind::Text,
        DataType::Date32
        | DataType::Date64
        | DataType::Time32(_)
        | DataType::Time64(_)
        | DataType::Timestamp(..)
        | DataType::Duration(_)
        | DataType::Interval(_) => ColumnKind::Temporal,
        other if other.is_numeric() => ColumnKind::Number,
        _ => ColumnKind::Other,
    }
}

/// The columns of a result that the adapter did not convert to text in DuckDB.
/// The type names are the names of the Arrow format.
pub(crate) fn columns_of_batch_schema(schema: &duckdb::arrow::datatypes::Schema) -> Vec<Column> {
    schema
        .fields()
        .iter()
        .map(|field| Column {
            name: field.name().clone(),
            type_name: Some(field.data_type().to_string()),
            kind: kind_of_arrow_type(field.data_type()),
        })
        .collect()
}

/// Converts the rows `start..end` of a batch to text. `None` is NULL.
pub(crate) fn rows_of_batch(batch: &RecordBatch, start: usize, end: usize) -> Vec<Row> {
    let options = FormatOptions::default();
    let columns: Vec<(&dyn Array, Option<ArrayFormatter<'_>>)> = batch
        .columns()
        .iter()
        .map(|column| {
            let array = column.as_ref();
            (array, ArrayFormatter::try_new(array, &options).ok())
        })
        .collect();
    (start..end)
        .map(|row| {
            columns
                .iter()
                .map(|(array, formatter)| {
                    if array.is_null(row) {
                        return None;
                    }
                    let text = formatter
                        .as_ref()
                        .and_then(|formatter| formatter.value(row).try_to_string().ok());
                    Some(text.unwrap_or_else(|| NOT_SHOWN.to_owned()))
                })
                .collect()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_type_names_to_kinds() {
        let cases = [
            ("BIGINT", ColumnKind::Number),
            ("DECIMAL(10,2)", ColumnKind::Number),
            ("double", ColumnKind::Number),
            ("BOOLEAN", ColumnKind::Boolean),
            ("TIMESTAMP WITH TIME ZONE", ColumnKind::Temporal),
            ("DATE", ColumnKind::Temporal),
            ("INTERVAL", ColumnKind::Temporal),
            ("JSON", ColumnKind::Json),
            ("VARCHAR", ColumnKind::Text),
            ("UUID", ColumnKind::Text),
            ("INTEGER[]", ColumnKind::Other),
            ("STRUCT(a INTEGER)", ColumnKind::Other),
            ("MAP(VARCHAR, INTEGER)", ColumnKind::Other),
            ("BLOB", ColumnKind::Other),
        ];
        for (name, expected) in cases {
            assert_eq!(kind_of_type_name(name), expected, "{name}");
        }
    }
}

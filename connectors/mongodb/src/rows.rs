//! Shows documents as rows. Section 10.3 of `docs/Connector Design.md` gives the rules.

use mongodb::bson::{Bson, Document, spec::BinarySubtype};
use tabloxide_core::{Column, ColumnKind, Row};

/// The last column of a result with more pages. It holds the fields that the first
/// page did not have.
pub const MORE_FIELDS: &str = "(more fields)";

/// The columns of a result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Shape {
    pub columns: Vec<Column>,
    names: Vec<String>,
    has_more_fields: bool,
}

/// The type name of a value, as the MongoDB shell names it.
fn type_name(value: &Bson) -> &'static str {
    match value {
        Bson::Double(_) => "double",
        Bson::String(_) => "string",
        Bson::Array(_) => "array",
        Bson::Document(_) => "object",
        Bson::Boolean(_) => "bool",
        Bson::Null | Bson::Undefined => "null",
        Bson::RegularExpression(_) => "regex",
        Bson::JavaScriptCode(_) | Bson::JavaScriptCodeWithScope(_) => "javascript",
        Bson::Int32(_) => "int",
        Bson::Int64(_) => "long",
        Bson::Timestamp(_) => "timestamp",
        Bson::Binary(_) => "binData",
        Bson::ObjectId(_) => "objectId",
        Bson::DateTime(_) => "date",
        Bson::Symbol(_) => "symbol",
        Bson::Decimal128(_) => "decimal",
        Bson::MaxKey => "maxKey",
        Bson::MinKey => "minKey",
        Bson::DbPointer(_) => "dbPointer",
    }
}

fn kind_of(value: &Bson) -> ColumnKind {
    match value {
        Bson::Double(_) | Bson::Int32(_) | Bson::Int64(_) | Bson::Decimal128(_) => {
            ColumnKind::Number
        }
        Bson::Boolean(_) => ColumnKind::Boolean,
        Bson::DateTime(_) | Bson::Timestamp(_) => ColumnKind::Temporal,
        Bson::Document(_) | Bson::Array(_) => ColumnKind::Json,
        Bson::String(_) => ColumnKind::Text,
        _ => ColumnKind::Other,
    }
}

/// The kind of a column: the kind of all its values, `Json` if a value is a document
/// or an array, or else `Other`. `null` does not count.
fn column_kind<'a>(values: impl Iterator<Item = &'a Bson>) -> ColumnKind {
    let mut kinds: Vec<ColumnKind> = Vec::new();
    for value in values.filter(|value| !matches!(value, Bson::Null | Bson::Undefined)) {
        let kind = kind_of(value);
        if !kinds.contains(&kind) {
            kinds.push(kind);
        }
    }
    match kinds.as_slice() {
        [] => ColumnKind::Other,
        [kind] => *kind,
        _ if kinds.contains(&ColumnKind::Json) => ColumnKind::Json,
        _ => ColumnKind::Other,
    }
}

/// The type names of the values of a column, for example `int|null`.
fn column_type<'a>(values: impl Iterator<Item = &'a Bson>) -> Option<String> {
    let mut names: Vec<&str> = Vec::new();
    for value in values {
        let name = type_name(value);
        if !names.contains(&name) {
            names.push(name);
        }
    }
    (!names.is_empty()).then(|| names.join("|"))
}

impl Shape {
    /// The columns of `first`: the top-level fields in the sequence of their first
    /// appearance, with `_id` first. `has_more_pages` adds the column `(more fields)`.
    #[must_use]
    pub fn of(first: &[Document], has_more_pages: bool) -> Self {
        let mut names: Vec<String> = Vec::new();
        for document in first {
            for key in document.keys() {
                if !names.contains(key) {
                    names.push(key.clone());
                }
            }
        }
        if let Some(position) = names.iter().position(|name| name == "_id") {
            let id = names.remove(position);
            names.insert(0, id);
        }
        let mut columns: Vec<Column> = names
            .iter()
            .map(|name| Column {
                name: name.clone(),
                type_name: column_type(first.iter().filter_map(|document| document.get(name))),
                kind: column_kind(first.iter().filter_map(|document| document.get(name))),
            })
            .collect();
        if has_more_pages {
            columns.push(Column {
                name: MORE_FIELDS.to_owned(),
                type_name: Some("object".to_owned()),
                kind: ColumnKind::Json,
            });
        }
        Self {
            columns,
            names,
            has_more_fields: has_more_pages,
        }
    }

    /// The row of a document. A field that the document does not have is NULL.
    #[must_use]
    pub fn row(&self, document: &Document) -> Row {
        let mut row: Row = self
            .names
            .iter()
            .map(|name| document.get(name).and_then(cell))
            .collect();
        if self.has_more_fields {
            let extra: Document = document
                .iter()
                .filter(|(key, _)| !self.names.contains(key))
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect();
            row.push(
                (!extra.is_empty())
                    .then(|| Bson::Document(extra).into_relaxed_extjson().to_string()),
            );
        }
        row
    }
}

/// The text of one value. `null` is NULL. A document or an array is relaxed Extended
/// JSON. An ObjectId, a date, and a UUID have the form that the editor accepts.
#[must_use]
pub fn cell(value: &Bson) -> Option<String> {
    Some(match value {
        Bson::Null | Bson::Undefined => return None,
        Bson::String(text) => text.clone(),
        Bson::Boolean(value) => value.to_string(),
        Bson::Int32(value) => value.to_string(),
        Bson::Int64(value) => value.to_string(),
        Bson::Double(value) => value.to_string(),
        Bson::Decimal128(value) => value.to_string(),
        Bson::ObjectId(id) => format!("ObjectId(\"{}\")", id.to_hex()),
        Bson::DateTime(date) => date
            .try_to_rfc3339_string()
            .unwrap_or_else(|_| date.timestamp_millis().to_string()),
        Bson::Binary(binary) if binary.subtype == BinarySubtype::Uuid => {
            match <[u8; 16]>::try_from(binary.bytes.as_slice()) {
                Ok(bytes) => format!("UUID(\"{}\")", mongodb::bson::Uuid::from_bytes(bytes)),
                Err(_) => value.clone().into_relaxed_extjson().to_string(),
            }
        }
        other => other.clone().into_relaxed_extjson().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::{DateTime, doc, oid::ObjectId};

    #[test]
    fn the_columns_are_the_fields_of_the_first_page_with_id_first() {
        let first = [
            doc! { "name": "a", "_id": 1, "age": 30 },
            doc! { "_id": 2, "name": "b", "tags": ["x"] },
        ];

        let shape = Shape::of(&first, false);
        let names: Vec<&str> = shape.columns.iter().map(|c| c.name.as_str()).collect();

        assert_eq!(names, ["_id", "name", "age", "tags"]);
        assert_eq!(shape.columns[0].kind, ColumnKind::Number);
        assert_eq!(shape.columns[1].kind, ColumnKind::Text);
        assert_eq!(shape.columns[3].kind, ColumnKind::Json);
        assert_eq!(shape.columns[3].type_name.as_deref(), Some("array"));
        assert_eq!(
            shape.row(&first[1]),
            vec![
                Some("2".to_owned()),
                Some("b".to_owned()),
                None,
                Some("[\"x\"]".to_owned())
            ]
        );
    }

    #[test]
    fn more_pages_add_a_column_for_the_new_fields() {
        let shape = Shape::of(&[doc! { "_id": 1 }], true);

        let row = shape.row(&doc! { "_id": 2, "late": { "a": 1 } });

        assert_eq!(shape.columns.last().unwrap().name, MORE_FIELDS);
        assert_eq!(
            row,
            vec![Some("2".to_owned()), Some(r#"{"late":{"a":1}}"#.to_owned())]
        );
        assert_eq!(shape.row(&doc! { "_id": 3 })[1], None);
    }

    #[test]
    fn mixed_values_are_other_and_null_does_not_count() {
        let shape = Shape::of(
            &[doc! { "a": 1 }, doc! { "a": "x" }, doc! { "a": null }],
            false,
        );

        assert_eq!(shape.columns[0].kind, ColumnKind::Other);
        assert_eq!(
            shape.columns[0].type_name.as_deref(),
            Some("int|string|null")
        );
    }

    #[test]
    fn special_values_have_the_form_of_the_editor() {
        let id = ObjectId::parse_str("65a1b2c3d4e5f6a7b8c9d0e1").unwrap();

        assert_eq!(
            cell(&Bson::ObjectId(id)).unwrap(),
            "ObjectId(\"65a1b2c3d4e5f6a7b8c9d0e1\")"
        );
        assert_eq!(
            cell(&Bson::DateTime(DateTime::from_millis(0))).unwrap(),
            "1970-01-01T00:00:00Z"
        );
        assert_eq!(cell(&Bson::Null), None);
    }
}

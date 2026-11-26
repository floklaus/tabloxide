//! The catalog of MongoDB: a schema is a database, a relation is a collection or a view.

use crate::connect::query_error;
use futures_util::TryStreamExt;
use mongodb::bson::{Bson, Document, doc};
use mongodb::results::CollectionType;
use mongodb::{Client, Database};
use tabloxide_core::{
    ColumnInfo, ConstraintInfo, ConstraintKind, IndexInfo, QueryError, RelationDetail,
    RelationInfo, RelationKind, SchemaInfo,
};

/// The databases of the server itself.
const SYSTEM_DATABASES: [&str; 3] = ["admin", "config", "local"];

/// Number of documents that the structure of a collection comes from.
const SAMPLE_SIZE: i32 = 100;

/// Lists the databases, user databases first. A user without the right to list the
/// databases sees the current database only.
pub async fn schemas(client: &Client, current: &str) -> Result<Vec<SchemaInfo>, QueryError> {
    let mut names = client
        .list_database_names()
        .await
        .unwrap_or_else(|_| vec![current.to_owned()]);
    if !names.iter().any(|name| name == current) {
        names.push(current.to_owned());
    }
    names.sort_by_key(|name| (SYSTEM_DATABASES.contains(&name.as_str()), name.clone()));
    Ok(names
        .into_iter()
        .map(|name| SchemaInfo {
            is_system: SYSTEM_DATABASES.contains(&name.as_str()),
            name,
        })
        .collect())
}

/// Lists the collections and the views, in alphabetical sequence, without the
/// `system.` collections.
pub async fn relations(database: &Database) -> Result<Vec<RelationInfo>, QueryError> {
    let specifications: Vec<_> = database
        .list_collections()
        .await
        .map_err(|error| query_error(&error))?
        .try_collect()
        .await
        .map_err(|error| query_error(&error))?;
    let mut relations: Vec<RelationInfo> = specifications
        .into_iter()
        .filter(|specification| !specification.name.starts_with("system."))
        .map(|specification| RelationInfo {
            kind: match specification.collection_type {
                CollectionType::View => RelationKind::View,
                _ => RelationKind::Table,
            },
            name: specification.name,
        })
        .collect();
    relations.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(relations)
}

fn type_of(value: &Bson) -> &'static str {
    match value {
        Bson::Double(_) => "double",
        Bson::String(_) => "string",
        Bson::Array(_) => "array",
        Bson::Document(_) => "object",
        Bson::Boolean(_) => "bool",
        Bson::Null | Bson::Undefined => "null",
        Bson::Int32(_) => "int",
        Bson::Int64(_) => "long",
        Bson::Decimal128(_) => "decimal",
        Bson::ObjectId(_) => "objectId",
        Bson::DateTime(_) => "date",
        Bson::Binary(_) => "binData",
        Bson::Timestamp(_) => "timestamp",
        _ => "other",
    }
}

/// The top-level fields of `sample`, with their types. `_id` is first.
fn columns_of(sample: &[Document]) -> Vec<ColumnInfo> {
    let mut columns: Vec<(String, Vec<&'static str>, usize)> = Vec::new();
    for document in sample {
        for (key, value) in document {
            let position = columns.iter().position(|(name, _, _)| name == key);
            let entry = match position {
                Some(position) => &mut columns[position],
                None => {
                    columns.push((key.clone(), Vec::new(), 0));
                    columns.last_mut().expect("the column was just added")
                }
            };
            let name = type_of(value);
            if !entry.1.contains(&name) {
                entry.1.push(name);
            }
            entry.2 += 1;
        }
    }
    if let Some(position) = columns.iter().position(|(name, _, _)| name == "_id") {
        let id = columns.remove(position);
        columns.insert(0, id);
    }
    columns
        .into_iter()
        .map(|(name, types, seen)| ColumnInfo {
            is_nullable: seen < sample.len() || types.contains(&"null"),
            is_primary_key: name == "_id",
            data_type: types.join("|"),
            default: None,
            name,
        })
        .collect()
}

fn index_of(collection: &str, index: &Document) -> IndexInfo {
    let name = index.get_str("name").unwrap_or_default().to_owned();
    let keys = index.get_document("key").cloned().unwrap_or_default();
    let mut options = Document::new();
    for (key, value) in index {
        if !["v", "key", "ns"].contains(&key.as_str()) {
            options.insert(key.clone(), value.clone());
        }
    }
    let collection = serde_json::to_string(collection).unwrap_or_default();
    IndexInfo {
        definition: format!(
            "db.getCollection({collection}).createIndex({}, {})",
            Bson::Document(keys).into_relaxed_extjson(),
            Bson::Document(options).into_relaxed_extjson()
        ),
        is_unique: name == "_id_" || index.get_bool("unique").unwrap_or(false),
        is_primary: name == "_id_",
        name,
    }
}

/// Reads the fields (from a sample), the indexes, and the validator of a collection.
pub async fn relation_detail(
    database: &Database,
    collection: &str,
) -> Result<RelationDetail, QueryError> {
    let handle = database.collection::<Document>(collection);
    let sample: Vec<Document> = handle
        .aggregate([doc! { "$sample": { "size": SAMPLE_SIZE } }])
        .await
        .map_err(|error| query_error(&error))?
        .try_collect()
        .await
        .map_err(|error| query_error(&error))?;
    // A view has no indexes. Then the list is empty.
    let indexes: Vec<Document> = match handle.list_indexes().await {
        Ok(cursor) => cursor
            .try_collect::<Vec<_>>()
            .await
            .unwrap_or_default()
            .into_iter()
            .filter_map(|model| mongodb::bson::to_document(&model).ok())
            .collect(),
        Err(_) => Vec::new(),
    };
    let validator = database
        .list_collections()
        .filter(doc! { "name": collection })
        .await
        .map_err(|error| query_error(&error))?
        .try_next()
        .await
        .ok()
        .flatten()
        .and_then(|specification| specification.options.validator);
    Ok(RelationDetail {
        columns: columns_of(&sample),
        indexes: indexes
            .iter()
            .map(|index| index_of(collection, index))
            .collect(),
        constraints: validator
            .map(|validator| ConstraintInfo {
                name: "validator".to_owned(),
                kind: ConstraintKind::Check,
                definition: Bson::Document(validator).into_relaxed_extjson().to_string(),
            })
            .into_iter()
            .collect(),
        columns_from_sample: true,
    })
}

/// The statement that reads the first `limit` documents of a collection.
#[must_use]
pub fn sample_statement(current: &str, database: &str, collection: &str, limit: u32) -> String {
    let quote = |text: &str| serde_json::to_string(text).unwrap_or_default();
    let prefix = if database == current {
        "db".to_owned()
    } else {
        format!("db.getSiblingDB({})", quote(database))
    };
    format!(
        "{prefix}.getCollection({}).find({{}}).limit({limit})",
        quote(collection)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tabloxide_core::mongo::parse_statement;

    #[test]
    fn the_fields_of_the_sample_have_names_and_types_and_no_values() {
        let sample = [
            doc! { "_id": 1, "email": "ada@example.com", "card": { "number": "4111-1111" } },
            doc! { "_id": 2, "email": "bob@example.com", "score": 99.5 },
        ];

        let columns = columns_of(&sample);
        let text = column_text(&columns);

        for value in ["ada@example.com", "bob@example.com", "4111-1111", "99.5"] {
            assert!(!text.contains(value), "{text}");
        }
        assert!(columns.iter().all(|column| column.default.is_none()));
        assert_eq!(
            columns.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
            ["_id", "email", "card", "score"]
        );
    }

    /// All text of the columns, as the assistant can get it.
    fn column_text(columns: &[ColumnInfo]) -> String {
        columns
            .iter()
            .map(|column| format!("{} {} {:?}", column.name, column.data_type, column.default))
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn the_columns_come_from_the_sample_with_their_types() {
        let sample = [
            doc! { "name": "a", "_id": 1 },
            doc! { "_id": 2, "name": null, "age": 3 },
        ];

        let columns = columns_of(&sample);

        assert_eq!(columns[0].name, "_id");
        assert!(columns[0].is_primary_key);
        assert!(!columns[0].is_nullable);
        assert_eq!(columns[1].data_type, "string|null");
        assert!(columns[1].is_nullable);
        assert!(columns[2].is_nullable, "age is missing in one document");
    }

    #[test]
    fn the_sample_statement_is_valid_syntax_with_any_name() {
        let here = sample_statement("app", "app", "my \"odd\" coll", 5);
        let there = sample_statement("app", "sales", "orders", 5);

        assert_eq!(
            here,
            r#"db.getCollection("my \"odd\" coll").find({}).limit(5)"#
        );
        assert_eq!(
            there,
            r#"db.getSiblingDB("sales").getCollection("orders").find({}).limit(5)"#
        );
        assert!(parse_statement(&here).is_ok());
        assert!(parse_statement(&there).is_ok());
    }

    #[test]
    fn an_index_definition_can_run_again() {
        let index = index_of(
            "users",
            &doc! { "v": 2, "key": { "email": 1 }, "name": "email_1", "unique": true },
        );

        assert!(index.is_unique);
        assert_eq!(
            index.definition,
            r#"db.getCollection("users").createIndex({"email":1}, {"name":"email_1","unique":true})"#
        );
        assert!(parse_statement(&index.definition).is_ok());
    }
}

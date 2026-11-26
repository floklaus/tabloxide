//! The structure of a database, as text for the AI service.
//!
//! The text has names, types, and the definitions of indexes and constraints. It has no
//! rows, no default expressions, no passwords, and no address of the database server.

use std::fmt::Write as _;
use tabloxide_core::{
    ConstraintKind, QueryError, QueryLanguage, QuerySession, RelationDetail, RelationInfo,
    RelationKind,
};

/// The context has the columns of this number of tables and views at most.
/// It has only the names of the other tables and views.
pub const MAX_DETAILED_RELATIONS: usize = 200;

/// One table or view. `detail` is `None` if the context has only its name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelationContext {
    pub name: String,
    pub kind: RelationKind,
    pub detail: Option<RelationDetail>,
}

/// The tables and views of one schema.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SchemaGroup {
    pub name: String,
    pub relations: Vec<RelationContext>,
}

/// The structure of the user schemas of one database.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SchemaContext {
    pub schemas: Vec<SchemaGroup>,
}

fn kind_word(kind: RelationKind, language: QueryLanguage) -> &'static str {
    match kind {
        RelationKind::Table if language == QueryLanguage::MongodbShell => "collection",
        RelationKind::Table => "table",
        RelationKind::View => "view",
        RelationKind::MaterializedView => "materialized view",
        RelationKind::ForeignTable => "foreign table",
    }
}

fn constraint_word(kind: ConstraintKind) -> &'static str {
    match kind {
        ConstraintKind::PrimaryKey => "primary key",
        ConstraintKind::ForeignKey => "foreign key",
        ConstraintKind::Unique => "unique",
        ConstraintKind::Check => "check",
        ConstraintKind::Exclusion => "exclusion",
        ConstraintKind::Other => "constraint",
    }
}

fn render_detail(out: &mut String, detail: &RelationDetail) {
    if detail.columns_from_sample {
        out.push_str(
            "  (The fields come from a sample of documents. The object can have more fields.)\n",
        );
    }
    for column in &detail.columns {
        let _ = write!(out, "  {} {}", column.name, column.data_type);
        if !column.is_nullable {
            out.push_str(" NOT NULL");
        }
        if column.is_primary_key {
            out.push_str(" PRIMARY KEY");
        }
        // The text has no default expression. A default can contain a private value.
        if column.default.is_some() {
            out.push_str(" HAS DEFAULT");
        }
        out.push('\n');
    }
    // The primary key is on its columns. Its index and its constraint add nothing.
    for index in detail.indexes.iter().filter(|index| !index.is_primary) {
        let _ = writeln!(out, "  index: {}", index.definition);
    }
    for constraint in &detail.constraints {
        if constraint.kind == ConstraintKind::PrimaryKey {
            continue;
        }
        let _ = writeln!(
            out,
            "  {} {}: {}",
            constraint_word(constraint.kind),
            constraint.name,
            constraint.definition
        );
    }
}

/// Returns the text of the structure of one table or view: its columns, indexes, and
/// constraints. The text has no default expressions and no rows.
#[must_use]
pub fn relation_text(detail: &RelationDetail) -> String {
    let mut out = String::new();
    render_detail(&mut out, detail);
    out
}

impl SchemaContext {
    /// Number of tables and views.
    #[must_use]
    pub fn relation_count(&self) -> usize {
        self.schemas.iter().map(|s| s.relations.len()).sum()
    }

    /// Number of tables, collections, and views whose columns come from a sample.
    #[must_use]
    pub fn sampled_count(&self) -> usize {
        self.schemas
            .iter()
            .flat_map(|schema| &schema.relations)
            .filter(|relation| {
                relation
                    .detail
                    .as_ref()
                    .is_some_and(|detail| detail.columns_from_sample)
            })
            .count()
    }

    /// Number of tables and views for which the context has the columns.
    #[must_use]
    pub fn detailed_count(&self) -> usize {
        self.schemas
            .iter()
            .flat_map(|schema| &schema.relations)
            .filter(|relation| relation.detail.is_some())
            .count()
    }

    /// Returns the text for the AI service, with the words of `language`: tables and
    /// columns for SQL, collections and fields for MongoDB.
    #[must_use]
    pub fn render(&self, language: QueryLanguage) -> String {
        let missing = if language == QueryLanguage::MongodbShell {
            " (fields not included)\n"
        } else {
            " (columns not included)\n"
        };
        let mut out = String::new();
        for schema in &self.schemas {
            for relation in &schema.relations {
                let _ = write!(
                    out,
                    "{} {}.{}",
                    kind_word(relation.kind, language),
                    schema.name,
                    relation.name
                );
                match &relation.detail {
                    Some(detail) => {
                        out.push('\n');
                        render_detail(&mut out, detail);
                    }
                    None => out.push_str(missing),
                }
            }
        }
        if out.is_empty() {
            out.push_str("The database has no tables and no views in its user schemas.\n");
        }
        out
    }
}

/// Reads the structure of the user schemas of the database of `session`.
///
/// The function reads the columns of `max_detailed` tables and views at most.
/// This closes the open result of the session.
///
/// # Errors
///
/// Returns the error of the database.
pub async fn collect_schema(
    session: &QuerySession,
    max_detailed: usize,
) -> Result<SchemaContext, QueryError> {
    let mut schemas: Vec<SchemaGroup> = Vec::new();
    let mut detailed = 0usize;
    for schema in session.schemas().await? {
        if schema.is_system {
            continue;
        }
        let infos: Vec<RelationInfo> = session.relations(&schema.name).await?;
        let mut relations = Vec::with_capacity(infos.len());
        for info in infos {
            let detail = if detailed < max_detailed {
                detailed += 1;
                Some(session.relation_detail(&schema.name, &info.name).await?)
            } else {
                None
            };
            relations.push(RelationContext {
                name: info.name,
                kind: info.kind,
                detail,
            });
        }
        schemas.push(SchemaGroup {
            name: schema.name,
            relations,
        });
    }
    Ok(SchemaContext { schemas })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tabloxide_core::testing::ScriptedSession;
    use tabloxide_core::{ColumnInfo, ConstraintInfo, IndexInfo};

    fn column(name: &str, data_type: &str) -> ColumnInfo {
        ColumnInfo {
            name: name.to_owned(),
            data_type: data_type.to_owned(),
            is_nullable: true,
            default: None,
            is_primary_key: false,
        }
    }

    fn sample() -> SchemaContext {
        let detail = RelationDetail {
            columns: vec![
                ColumnInfo {
                    is_nullable: false,
                    is_primary_key: true,
                    ..column("order_id", "bigint")
                },
                ColumnInfo {
                    default: Some("now()".to_owned()),
                    ..column("created_at", "timestamptz")
                },
            ],
            indexes: vec![
                IndexInfo {
                    name: "orders_pkey".to_owned(),
                    definition: "CREATE UNIQUE INDEX orders_pkey ON orders (order_id)".to_owned(),
                    is_unique: true,
                    is_primary: true,
                },
                IndexInfo {
                    name: "orders_created".to_owned(),
                    definition: "CREATE INDEX orders_created ON orders (created_at)".to_owned(),
                    is_unique: false,
                    is_primary: false,
                },
            ],
            constraints: vec![
                ConstraintInfo {
                    name: "orders_pkey".to_owned(),
                    kind: ConstraintKind::PrimaryKey,
                    definition: "PRIMARY KEY (order_id)".to_owned(),
                },
                ConstraintInfo {
                    name: "orders_customer_fk".to_owned(),
                    kind: ConstraintKind::ForeignKey,
                    definition: "FOREIGN KEY (customer_id) REFERENCES customer(id)".to_owned(),
                },
            ],
            columns_from_sample: false,
        };
        SchemaContext {
            schemas: vec![SchemaGroup {
                name: "sales".to_owned(),
                relations: vec![
                    RelationContext {
                        name: "orders".to_owned(),
                        kind: RelationKind::Table,
                        detail: Some(detail),
                    },
                    RelationContext {
                        name: "report".to_owned(),
                        kind: RelationKind::View,
                        detail: None,
                    },
                ],
            }],
        }
    }

    #[test]
    fn the_text_has_the_columns_the_indexes_and_the_constraints() {
        let text = sample().render(QueryLanguage::Sql);

        assert_eq!(
            text,
            "table sales.orders\n\
             \x20 order_id bigint NOT NULL PRIMARY KEY\n\
             \x20 created_at timestamptz HAS DEFAULT\n\
             \x20 index: CREATE INDEX orders_created ON orders (created_at)\n\
             \x20 foreign key orders_customer_fk: FOREIGN KEY (customer_id) REFERENCES customer(id)\n\
             view sales.report (columns not included)\n"
        );
    }

    #[test]
    fn the_counts_show_how_many_relations_have_columns() {
        let context = sample();

        assert_eq!(context.relation_count(), 2);
        assert_eq!(context.detailed_count(), 1);
    }

    #[test]
    fn an_empty_database_gives_a_sentence() {
        assert_eq!(
            SchemaContext::default().render(QueryLanguage::Sql),
            "The database has no tables and no views in its user schemas.\n"
        );
    }

    #[tokio::test]
    async fn collect_reads_the_user_schemas_and_stops_the_detail_at_the_limit() {
        let (scripted, _) = ScriptedSession::new(vec![]);
        let session = QuerySession::new(Box::new(scripted), tabloxide_core::QueryLanguage::Sql);

        let all = collect_schema(&session, 100).await.unwrap();
        let limited = collect_schema(&session, 1).await.unwrap();

        assert_eq!(
            all.schemas.len(),
            1,
            "the system schema is not in the context"
        );
        assert_eq!(all.schemas[0].name, "public");
        assert_eq!(all.relation_count(), 2);
        assert_eq!(all.detailed_count(), 2);
        assert_eq!(limited.relation_count(), 2);
        assert_eq!(limited.detailed_count(), 1);
        assert_eq!(limited.schemas[0].relations[1].detail, None);
    }
}

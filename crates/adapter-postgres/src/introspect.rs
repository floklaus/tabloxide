//! Reads the structure of a database from the system catalogs.
//!
//! Each query gets the object names as parameters.

use crate::error::map_query_error;
use tabloxide_core::{
    ColumnInfo, ConstraintInfo, ConstraintKind, IndexInfo, QueryError, RelationDetail,
    RelationInfo, RelationKind, SchemaInfo,
};
use tokio_postgres::types::ToSql;
use tokio_postgres::{Client, Row};

const SCHEMAS: &str = "
    SELECT n.nspname::text,
           (n.nspname LIKE 'pg\\_%' OR n.nspname = 'information_schema') AS is_system
    FROM pg_catalog.pg_namespace AS n
    WHERE n.nspname NOT LIKE 'pg\\_temp\\_%'
      AND n.nspname NOT LIKE 'pg\\_toast%'
    ORDER BY is_system, n.nspname";

const RELATIONS: &str = "
    SELECT c.relname::text, c.relkind::text
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = $1
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    ORDER BY c.relname";

const COLUMNS: &str = "
    SELECT a.attname::text,
           pg_catalog.format_type(a.atttypid, a.atttypmod),
           NOT a.attnotnull,
           pg_catalog.pg_get_expr(d.adbin, d.adrelid),
           EXISTS (
               SELECT 1 FROM pg_catalog.pg_index AS i
               WHERE i.indrelid = c.oid AND i.indisprimary
                 AND a.attnum = ANY (i.indkey::int2[])
           )
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute AS a ON a.attrelid = c.oid
    LEFT JOIN pg_catalog.pg_attrdef AS d ON d.adrelid = c.oid AND d.adnum = a.attnum
    WHERE n.nspname = $1 AND c.relname = $2
      AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum";

const INDEXES: &str = "
    SELECT ic.relname::text,
           pg_catalog.pg_get_indexdef(i.indexrelid),
           i.indisunique,
           i.indisprimary
    FROM pg_catalog.pg_index AS i
    JOIN pg_catalog.pg_class AS ic ON ic.oid = i.indexrelid
    JOIN pg_catalog.pg_class AS c ON c.oid = i.indrelid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relname = $2
    ORDER BY ic.relname";

const CONSTRAINTS: &str = "
    SELECT con.conname::text,
           con.contype::text,
           pg_catalog.pg_get_constraintdef(con.oid)
    FROM pg_catalog.pg_constraint AS con
    JOIN pg_catalog.pg_class AS c ON c.oid = con.conrelid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relname = $2
    ORDER BY con.conname";

fn relation_kind(code: &str) -> RelationKind {
    match code {
        "v" => RelationKind::View,
        "m" => RelationKind::MaterializedView,
        "f" => RelationKind::ForeignTable,
        _ => RelationKind::Table,
    }
}

fn constraint_kind(code: &str) -> ConstraintKind {
    match code {
        "p" => ConstraintKind::PrimaryKey,
        "f" => ConstraintKind::ForeignKey,
        "u" => ConstraintKind::Unique,
        "c" => ConstraintKind::Check,
        "x" => ConstraintKind::Exclusion,
        _ => ConstraintKind::Other,
    }
}

/// Runs a catalog query and converts each row.
async fn read<T>(
    client: &Client,
    query: &str,
    params: &[&(dyn ToSql + Sync)],
    convert: fn(&Row) -> Result<T, tokio_postgres::Error>,
) -> Result<Vec<T>, QueryError> {
    let rows = client
        .query(query, params)
        .await
        .map_err(|e| map_query_error(&e))?;
    rows.iter()
        .map(|row| convert(row).map_err(|e| map_query_error(&e)))
        .collect()
}

pub(crate) async fn schemas(client: &Client) -> Result<Vec<SchemaInfo>, QueryError> {
    read(client, SCHEMAS, &[], |row| {
        Ok(SchemaInfo {
            name: row.try_get(0)?,
            is_system: row.try_get(1)?,
        })
    })
    .await
}

pub(crate) async fn relations(
    client: &Client,
    schema: &str,
) -> Result<Vec<RelationInfo>, QueryError> {
    read(client, RELATIONS, &[&schema], |row| {
        Ok(RelationInfo {
            name: row.try_get(0)?,
            kind: relation_kind(row.try_get(1)?),
        })
    })
    .await
}

pub(crate) async fn relation_detail(
    client: &Client,
    schema: &str,
    relation: &str,
) -> Result<RelationDetail, QueryError> {
    let params: [&(dyn ToSql + Sync); 2] = [&schema, &relation];
    let columns = read(client, COLUMNS, &params, |row| {
        Ok(ColumnInfo {
            name: row.try_get(0)?,
            data_type: row.try_get(1)?,
            is_nullable: row.try_get(2)?,
            default: row.try_get(3)?,
            is_primary_key: row.try_get(4)?,
        })
    })
    .await?;
    let indexes = read(client, INDEXES, &params, |row| {
        Ok(IndexInfo {
            name: row.try_get(0)?,
            definition: row.try_get(1)?,
            is_unique: row.try_get(2)?,
            is_primary: row.try_get(3)?,
        })
    })
    .await?;
    let constraints = read(client, CONSTRAINTS, &params, |row| {
        Ok(ConstraintInfo {
            name: row.try_get(0)?,
            kind: constraint_kind(row.try_get(1)?),
            definition: row.try_get(2)?,
        })
    })
    .await?;
    Ok(RelationDetail {
        columns,
        indexes,
        constraints,
        columns_from_sample: false,
    })
}

/// Puts an identifier in double quotes. A double quote in the identifier is doubled.
pub(crate) fn quote_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

pub(crate) fn sample_statement(schema: &str, relation: &str, limit: u32) -> String {
    format!(
        "SELECT * FROM {}.{} LIMIT {limit}",
        quote_identifier(schema),
        quote_identifier(relation)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_identifiers() {
        assert_eq!(quote_identifier("item"), "\"item\"");
        assert_eq!(quote_identifier("My Table"), "\"My Table\"");
        assert_eq!(quote_identifier("a\"b"), "\"a\"\"b\"");
    }

    #[test]
    fn a_quote_in_a_name_cannot_end_the_identifier() {
        let statement = sample_statement("public", "x\"; DROP TABLE y; --", 100);

        assert_eq!(
            statement,
            "SELECT * FROM \"public\".\"x\"\"; DROP TABLE y; --\" LIMIT 100"
        );
    }

    #[test]
    fn maps_the_catalog_codes() {
        assert_eq!(relation_kind("r"), RelationKind::Table);
        assert_eq!(relation_kind("p"), RelationKind::Table);
        assert_eq!(relation_kind("m"), RelationKind::MaterializedView);
        assert_eq!(constraint_kind("f"), ConstraintKind::ForeignKey);
        assert_eq!(constraint_kind("t"), ConstraintKind::Other);
    }
}

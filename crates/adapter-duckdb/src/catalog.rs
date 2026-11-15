//! Reads the structure of the database. Each query has its values as parameters.

use duckdb::{Connection, Row, ToSql};
use tabloxide_core::{
    ColumnInfo, ConstraintInfo, ConstraintKind, IndexInfo, RelationDetail, RelationInfo,
    RelationKind, SchemaInfo,
};

const SCHEMAS: &str = "
    SELECT schema_name, schema_name IN ('information_schema', 'pg_catalog') AS is_system
    FROM information_schema.schemata
    WHERE catalog_name = current_database()
    ORDER BY is_system, schema_name";

const RELATIONS: &str = "
    SELECT table_name, table_type
    FROM information_schema.tables
    WHERE table_catalog = current_database() AND table_schema = ?
    ORDER BY table_name";

const COLUMNS: &str = "
    SELECT c.column_name, c.data_type, c.is_nullable = 'YES', c.column_default,
           list_contains(coalesce(pk.names, []), c.column_name)
    FROM information_schema.columns AS c
    LEFT JOIN (
        SELECT constraint_column_names AS names
        FROM duckdb_constraints()
        WHERE database_name = current_database() AND schema_name = ?1 AND table_name = ?2
          AND constraint_type = 'PRIMARY KEY'
        LIMIT 1
    ) AS pk ON true
    WHERE c.table_catalog = current_database() AND c.table_schema = ?1 AND c.table_name = ?2
    ORDER BY c.ordinal_position";

const INDEXES: &str = "
    SELECT index_name, coalesce(sql, ''), is_unique, is_primary
    FROM duckdb_indexes()
    WHERE database_name = current_database() AND schema_name = ? AND table_name = ?
    ORDER BY index_name";

// Each column that is not nullable has a NOT NULL constraint. The column list shows that.
const CONSTRAINTS: &str = "
    SELECT coalesce(constraint_name, ''), constraint_type, coalesce(constraint_text, '')
    FROM duckdb_constraints()
    WHERE database_name = current_database() AND schema_name = ? AND table_name = ?
      AND constraint_type <> 'NOT NULL'
    ORDER BY constraint_type, constraint_name";

fn query<T>(
    connection: &Connection,
    sql: &str,
    params: &[&dyn ToSql],
    read: impl Fn(&Row<'_>) -> duckdb::Result<T>,
) -> duckdb::Result<Vec<T>> {
    let mut statement = connection.prepare(sql)?;
    let rows = statement.query_map(params, |row| read(row))?;
    rows.collect()
}

fn relation_kind(table_type: &str) -> RelationKind {
    if table_type == "VIEW" {
        RelationKind::View
    } else {
        RelationKind::Table
    }
}

fn constraint_kind(constraint_type: &str) -> ConstraintKind {
    match constraint_type {
        "PRIMARY KEY" => ConstraintKind::PrimaryKey,
        "FOREIGN KEY" => ConstraintKind::ForeignKey,
        "UNIQUE" => ConstraintKind::Unique,
        "CHECK" => ConstraintKind::Check,
        _ => ConstraintKind::Other,
    }
}

pub(crate) fn schemas(connection: &Connection) -> duckdb::Result<Vec<SchemaInfo>> {
    query(connection, SCHEMAS, &[], |row| {
        Ok(SchemaInfo {
            name: row.get(0)?,
            is_system: row.get(1)?,
        })
    })
}

pub(crate) fn relations(
    connection: &Connection,
    schema: &str,
) -> duckdb::Result<Vec<RelationInfo>> {
    query(connection, RELATIONS, &[&schema], |row| {
        Ok(RelationInfo {
            name: row.get(0)?,
            kind: relation_kind(&row.get::<_, String>(1)?),
        })
    })
}

pub(crate) fn relation_detail(
    connection: &Connection,
    schema: &str,
    relation: &str,
) -> duckdb::Result<RelationDetail> {
    let params: [&dyn ToSql; 2] = [&schema, &relation];
    let columns = query(connection, COLUMNS, &params, |row| {
        Ok(ColumnInfo {
            name: row.get(0)?,
            data_type: row.get(1)?,
            is_nullable: row.get(2)?,
            default: row.get(3)?,
            is_primary_key: row.get(4)?,
        })
    })?;
    let indexes = query(connection, INDEXES, &params, |row| {
        Ok(IndexInfo {
            name: row.get(0)?,
            definition: row.get(1)?,
            is_unique: row.get(2)?,
            is_primary: row.get(3)?,
        })
    })?;
    let constraints = query(connection, CONSTRAINTS, &params, |row| {
        Ok(ConstraintInfo {
            name: row.get(0)?,
            kind: constraint_kind(&row.get::<_, String>(1)?),
            definition: row.get(2)?,
        })
    })?;
    Ok(RelationDetail {
        columns,
        indexes,
        constraints,
    })
}

/// Puts an identifier in double quotes.
fn quote_identifier(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
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
    fn the_sample_statement_has_its_identifiers_in_quotes() {
        assert_eq!(
            sample_statement("main", "my \"table\"", 100),
            "SELECT * FROM \"main\".\"my \"\"table\"\"\" LIMIT 100"
        );
    }
}

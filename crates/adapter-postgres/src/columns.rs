//! Column metadata of a result.

use tabloxide_core::{Column, ColumnKind};
use tokio_postgres::types::Type;
use tokio_postgres::{Client, SimpleColumn};

fn kind_of(data_type: &Type) -> ColumnKind {
    match *data_type {
        Type::INT2
        | Type::INT4
        | Type::INT8
        | Type::FLOAT4
        | Type::FLOAT8
        | Type::NUMERIC
        | Type::MONEY
        | Type::OID => ColumnKind::Number,
        Type::BOOL => ColumnKind::Boolean,
        Type::DATE
        | Type::TIME
        | Type::TIMETZ
        | Type::TIMESTAMP
        | Type::TIMESTAMPTZ
        | Type::INTERVAL => ColumnKind::Temporal,
        Type::JSON | Type::JSONB => ColumnKind::Json,
        Type::TEXT | Type::VARCHAR | Type::BPCHAR | Type::NAME | Type::CHAR | Type::UUID => {
            ColumnKind::Text
        }
        _ => ColumnKind::Other,
    }
}

/// The types of the result columns of `statement`.
///
/// The simple query protocol gives the column names only. A prepared statement gives the
/// types and does not run the statement. The result is `None` if the server cannot prepare
/// the statement. In that condition the run of the statement gives the error to the user.
pub(crate) async fn column_types(client: &Client, statement: &str) -> Option<Vec<Type>> {
    let prepared = client.prepare(statement).await.ok()?;
    Some(
        prepared
            .columns()
            .iter()
            .map(|column| column.type_().clone())
            .collect(),
    )
}

/// Joins the column names of the result with the types of the prepared statement.
pub(crate) fn describe(names: &[SimpleColumn], types: Option<&[Type]>) -> Vec<Column> {
    let types = types.filter(|types| types.len() == names.len());
    names
        .iter()
        .enumerate()
        .map(|(index, column)| {
            let data_type = types.map(|types| &types[index]);
            Column {
                name: column.name().to_owned(),
                type_name: data_type.map(|t| t.name().to_owned()),
                kind: data_type.map_or(ColumnKind::Other, kind_of),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_types_to_kinds() {
        assert_eq!(kind_of(&Type::INT8), ColumnKind::Number);
        assert_eq!(kind_of(&Type::NUMERIC), ColumnKind::Number);
        assert_eq!(kind_of(&Type::BOOL), ColumnKind::Boolean);
        assert_eq!(kind_of(&Type::TIMESTAMPTZ), ColumnKind::Temporal);
        assert_eq!(kind_of(&Type::JSONB), ColumnKind::Json);
        assert_eq!(kind_of(&Type::TEXT), ColumnKind::Text);
        assert_eq!(kind_of(&Type::INT4_ARRAY), ColumnKind::Other);
    }
}

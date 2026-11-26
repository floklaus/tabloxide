//! Types that describe the objects of a database. They do not depend on a database engine.

use serde::Serialize;

/// One schema (namespace) of a database.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct SchemaInfo {
    pub name: String,
    /// `true` for a schema of the database engine itself.
    pub is_system: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
pub enum RelationKind {
    Table,
    View,
    MaterializedView,
    ForeignTable,
}

/// One table or view.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct RelationInfo {
    pub name: String,
    pub kind: RelationKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    /// The default expression of the column.
    pub default: Option<String>,
    pub is_primary_key: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct IndexInfo {
    pub name: String,
    /// The statement that makes the index.
    pub definition: String,
    pub is_unique: bool,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
pub enum ConstraintKind {
    PrimaryKey,
    ForeignKey,
    Unique,
    Check,
    Exclusion,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ConstraintInfo {
    pub name: String,
    pub kind: ConstraintKind,
    pub definition: String,
}

/// The structure of one table or view.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct RelationDetail {
    pub columns: Vec<ColumnInfo>,
    pub indexes: Vec<IndexInfo>,
    pub constraints: Vec<ConstraintInfo>,
    /// `true` if the columns come from a sample of documents, as for a MongoDB
    /// collection. Then the list can be incomplete. A column has a name and a type,
    /// and no value of the sample.
    pub columns_from_sample: bool,
}

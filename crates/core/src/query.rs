//! Types for query results and query errors. They do not depend on a database engine.

use serde::Serialize;

/// General category of a column type. The grid uses it for the alignment and the sort.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
pub enum ColumnKind {
    Number,
    Boolean,
    Temporal,
    Json,
    Text,
    /// The type is not known, or it is not in a different category.
    Other,
}

/// One column of a result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Column {
    pub name: String,
    /// Type name of the database engine. `None` if the engine did not give the type.
    pub type_name: Option<String>,
    pub kind: ColumnKind,
}

/// One row. Each value is in the text form of the database engine. `None` is NULL.
pub type Row = Vec<Option<String>>;

/// The largest number of messages that an engine keeps for one statement.
pub const MAX_STATEMENT_MESSAGES: usize = 200;

/// Data about a statement that is complete.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Completion {
    /// Number of rows that the statement returned or changed.
    pub affected_rows: u64,
    /// Messages of the engine about the statement, for example the notices and the
    /// warnings of PostgreSQL. They are not errors.
    pub messages: Vec<String>,
}

impl Completion {
    /// A completion without messages.
    #[must_use]
    pub fn new(affected_rows: u64) -> Self {
        Self {
            affected_rows,
            messages: Vec::new(),
        }
    }
}

/// A group of rows from a result. `end` has a value when the statement is complete.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Page {
    pub rows: Vec<Row>,
    pub end: Option<Completion>,
}

/// Category of a query failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
pub enum QueryErrorKind {
    /// The database server rejected the statement.
    Database,
    /// The user cancelled the statement.
    Cancelled,
    /// The statement did not answer in the query timeout of the connection.
    Timeout,
    /// The connection to the server closed.
    ConnectionLost,
    Other,
}

/// A query failure.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[error("{message}")]
pub struct QueryError {
    pub kind: QueryErrorKind,
    pub message: String,
    pub detail: Option<String>,
    pub hint: Option<String>,
    /// Error code of the database engine (SQLSTATE).
    pub code: Option<String>,
    /// Position of the error in the statement text, in characters. The first character is 1.
    pub position: Option<u32>,
}

impl QueryError {
    #[must_use]
    pub fn new(kind: QueryErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            detail: None,
            hint: None,
            code: None,
            position: None,
        }
    }
}

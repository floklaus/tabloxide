//! Domain types that do not depend on a database engine or on Tauri.
//!
//! A later milestone adds the safety classifier to this crate.

mod adapter;
mod connection;
pub mod csv;
mod error;
mod query;
mod runner;
mod schema;
mod secret;
mod sessions;
pub mod sql;
#[cfg(any(test, feature = "testing"))]
pub mod testing;
mod validation;

pub use adapter::{CancelHandle, Capabilities, DbAdapter, ResultStream, Session};
pub use connection::{
    ConnectionId, ConnectionProfile, DEFAULT_CONNECT_TIMEOUT_SECS, DEFAULT_PORT, Environment,
    SecretSource, ServerInfo, TlsMode,
};
pub use error::{ConnectError, ConnectErrorKind};
pub use query::{Column, ColumnKind, Completion, Page, QueryError, QueryErrorKind, Row};
pub use runner::{
    Outcome, RunLimits, RunOutput, RunTarget, StatementReport, TextRange, run_script,
};
pub use schema::{
    ColumnInfo, ConstraintInfo, ConstraintKind, IndexInfo, RelationDetail, RelationInfo,
    RelationKind, SchemaInfo,
};
pub use secret::Secret;
pub use sessions::{FetchedPage, QuerySession, ResultId, RunReport};
pub use validation::{MAX_TIMEOUT_SECS, ValidationIssue, validate_profile};

//! Domain types that do not depend on a database engine or on Tauri.
//!

mod adapter;
mod connection;
pub mod csv;
mod error;
mod language;
pub mod mongo;
mod query;
mod runner;
mod schema;
mod secret;
mod sessions;
pub mod sql;
#[cfg(any(test, feature = "testing"))]
pub mod testing;
mod validation;

pub use adapter::{
    CancelHandle, Capabilities, DbAdapter, EngineInfo, PlanText, ResultStream, Session,
};
pub use connection::{
    ConnectionId, ConnectionProfile, DEFAULT_CONNECT_TIMEOUT_SECS, DEFAULT_PORT, Engine,
    Environment, MEMORY_DATABASE, SecretSource, ServerInfo, TlsMode,
};
pub use error::{ConnectError, ConnectErrorKind};
pub use language::QueryLanguage;
pub use query::{Column, ColumnKind, Completion, Page, QueryError, QueryErrorKind, Row};
pub use runner::{
    Outcome, RunLimits, RunOutput, RunTarget, StatementPreview, StatementReport, TextRange,
    preview_run, run_script,
};
pub use schema::{
    ColumnInfo, ConstraintInfo, ConstraintKind, IndexInfo, RelationDetail, RelationInfo,
    RelationKind, SchemaInfo,
};
pub use secret::Secret;
pub use sessions::{FetchedPage, QuerySession, ResultId, RunReport};
pub use sql::Risk;
pub use validation::{MAX_TIMEOUT_SECS, ValidationIssue, validate_profile};

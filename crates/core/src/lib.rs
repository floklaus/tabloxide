//! Domain types that do not depend on a database engine or on Tauri.
//!
//! Later milestones add the `DbAdapter` trait, the SQL statement splitter,
//! and the safety classifier to this crate.

mod connection;
mod error;
mod secret;
mod validation;

pub use connection::{
    ConnectionId, ConnectionProfile, DEFAULT_CONNECT_TIMEOUT_SECS, DEFAULT_PORT, Environment,
    SecretSource, ServerInfo, TlsMode,
};
pub use error::{ConnectError, ConnectErrorKind};
pub use secret::Secret;
pub use validation::{MAX_TIMEOUT_SECS, ValidationIssue, validate_profile};

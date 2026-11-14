//! Project configuration, local state, and secret references.
//!
//! - [`WorkspaceConfig`] is the `tabloxide.toml` file in the workspace root. Git tracks it.
//!   It contains no secret.
//! - [`SecretStore`] reads and writes passwords in the credential store of the operating system.
//! - [`RecentWorkspaces`] is machine-specific state in the application data directory.

mod config;
mod error;
mod recent;
mod secrets;
mod workspace;

pub use config::{CONFIG_FILE_NAME, WorkspaceConfig};
pub use error::WorkspaceError;
pub use recent::{MAX_RECENT_WORKSPACES, RecentWorkspace, RecentWorkspaces};
pub use secrets::{KeyringStore, MemoryStore, SecretError, SecretStore, resolve_secret};
pub use workspace::Workspace;

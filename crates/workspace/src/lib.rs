//! Project configuration, local state, and secret references.
//!
//! - [`WorkspaceConfig`] is the `tabloxide.toml` file in the workspace root. Git tracks it.
//!   It contains no secret.
//! - [`SecretStore`] reads and writes passwords in the credential store of the operating system.
//! - [`RecentWorkspaces`] is machine-specific state in the application data directory.
//! - [`LocalState`] is the SQLite database for the query history, the open tabs, and the
//!   preferences. It is also in the application data directory.
//! - [`files`] reads and writes the files in the workspace folder.
//! - [`WorkspaceWatcher`] reports changes that a different program made in the workspace folder.

mod config;
mod error;
pub mod files;
mod history;
mod local_state;
mod preferences;
mod recent;
mod secrets;
mod watch;
mod workspace;

pub use config::{CONFIG_FILE_NAME, WorkspaceConfig};
pub use error::WorkspaceError;
pub use files::FileEntry;
pub use history::{
    HistoryEntry, HistoryStatus, NOT_RECORDED, NewHistoryEntry, entries_from_report,
};
pub use local_state::{LocalState, MAX_HISTORY_RESULTS, TabState, UiState};
pub use preferences::{ConfirmRule, EditorPreferences, Guardrails, Preferences};
pub use recent::{MAX_RECENT_WORKSPACES, RecentWorkspace, RecentWorkspaces};
pub use secrets::{KeyringStore, MemoryStore, SecretError, SecretStore, resolve_secret};
pub use watch::{QUIET_TIME, WorkspaceWatcher, is_relevant};
pub use workspace::Workspace;

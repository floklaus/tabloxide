use std::path::PathBuf;
use tabloxide_core::{ConnectionId, ValidationIssue};

#[derive(Debug, thiserror::Error)]
pub enum WorkspaceError {
    #[error("The folder does not exist or is not a directory: {}", .0.display())]
    NotADirectory(PathBuf),

    #[error("Cannot read or write {}: {source}", path.display())]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("{} is not valid: {message}", path.display())]
    Parse { path: PathBuf, message: String },

    #[error(
        "{} has version {found}. This application supports version {supported} or earlier.",
        path.display()
    )]
    UnsupportedVersion {
        path: PathBuf,
        found: u32,
        supported: u32,
    },

    #[error("The connection settings are not valid.")]
    InvalidProfile(Vec<ValidationIssue>),

    #[error("The connection does not exist: {0}")]
    ConnectionNotFound(ConnectionId),

    #[error("The path is not in the workspace folder: {0}")]
    OutsideWorkspace(String),

    #[error("{} is too large to open. The limit is {limit_mb} MB.", path.display())]
    FileTooLarge { path: PathBuf, limit_mb: u64 },

    #[error("{} is not a UTF-8 text file.", path.display())]
    NotText { path: PathBuf },

    #[error("The local state database failed: {0}")]
    Database(String),

    #[error(transparent)]
    Secret(#[from] crate::secrets::SecretError),
}

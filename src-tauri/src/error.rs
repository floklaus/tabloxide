//! The error type that commands return to the UI.

use serde::Serialize;
use specta::Type;
use tabloxide_core::ValidationIssue;
use tabloxide_workspace::{SecretError, WorkspaceError};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum CommandErrorKind {
    /// No workspace is open.
    NoWorkspace,
    /// The connection settings are not valid. `issues` lists the problems.
    InvalidProfile,
    /// A workspace file or folder operation failed.
    Workspace,
    /// The credential store or an environment variable failed.
    Secret,
    /// An error in the application itself.
    Internal,
}

/// A command failure. `message` is for the user. It never contains a secret.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub kind: CommandErrorKind,
    pub message: String,
    pub issues: Vec<ValidationIssue>,
}

impl CommandError {
    pub fn new(kind: CommandErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            issues: Vec::new(),
        }
    }

    pub fn no_workspace() -> Self {
        Self::new(CommandErrorKind::NoWorkspace, "No workspace is open.")
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(CommandErrorKind::Internal, message)
    }

    pub fn invalid_profile(issues: Vec<ValidationIssue>) -> Self {
        Self {
            kind: CommandErrorKind::InvalidProfile,
            message: "The connection settings are not valid.".to_owned(),
            issues,
        }
    }
}

impl From<SecretError> for CommandError {
    fn from(error: SecretError) -> Self {
        Self::new(CommandErrorKind::Secret, error.to_string())
    }
}

impl From<WorkspaceError> for CommandError {
    fn from(error: WorkspaceError) -> Self {
        match error {
            WorkspaceError::InvalidProfile(issues) => Self::invalid_profile(issues),
            WorkspaceError::Secret(secret) => secret.into(),
            other => Self::new(CommandErrorKind::Workspace, other.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_invalid_profile_error_keeps_the_issues() {
        let issues = vec![ValidationIssue {
            field: "name".to_owned(),
            message: "Enter a name.".to_owned(),
        }];

        let error: CommandError = WorkspaceError::InvalidProfile(issues.clone()).into();

        assert_eq!(error.kind, CommandErrorKind::InvalidProfile);
        assert_eq!(error.issues, issues);
    }

    #[test]
    fn a_secret_error_in_a_workspace_error_has_the_secret_kind() {
        let error: CommandError = WorkspaceError::Secret(SecretError::NotInStore).into();

        assert_eq!(error.kind, CommandErrorKind::Secret);
    }
}

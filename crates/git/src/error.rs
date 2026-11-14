//! Errors of Git operations.

use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum GitError {
    #[error(
        "Git is not installed, or it is not in the PATH. Install Git from https://git-scm.com, then start the application again."
    )]
    NotInstalled,

    #[error("The folder is not in a Git repository: {}", .0.display())]
    NotARepository(PathBuf),

    #[error(
        "Git does not know your name and e-mail address. Run these commands in a terminal, then commit again:\n  git config --global user.name \"Your Name\"\n  git config --global user.email \"you@example.com\""
    )]
    MissingIdentity,

    #[error("The name is not valid: {0}")]
    InvalidName(String),

    #[error("The file is binary or too large to show: {0}")]
    NotText(String),

    /// `message` is the error output of Git, without credentials.
    #[error("{message}")]
    Failed { message: String },

    #[error("Cannot run Git: {0}")]
    Io(#[from] std::io::Error),
}

/// Replaces the user and the password in each URL of `text`.
/// Git can print a remote URL that contains a token.
pub(crate) fn redact_credentials(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("://") {
        let after = start + 3;
        result.push_str(&rest[..after]);
        rest = &rest[after..];
        let authority_end = rest
            .find(|c: char| c == '/' || c.is_whitespace())
            .unwrap_or(rest.len());
        if let Some(at) = rest[..authority_end].rfind('@') {
            result.push_str("***@");
            rest = &rest[at + 1..];
        }
    }
    result.push_str(rest);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_the_credentials_from_urls() {
        let text = "fatal: unable to access 'https://user:s3cr3t@example.com/a/b.git/': 403\n\
                    remote: https://token@host.example/x and ssh://git@host/y";

        let redacted = redact_credentials(text);

        assert!(!redacted.contains("s3cr3t"));
        assert!(!redacted.contains("token@"));
        assert!(redacted.contains("https://***@example.com/a/b.git/"));
        assert!(redacted.contains("ssh://***@host/y"));
    }

    #[test]
    fn keeps_text_without_credentials() {
        let text = "error: failed to push to 'https://example.com/a.git' at 10:30 user@host";

        assert_eq!(redact_credentials(text), text);
    }
}

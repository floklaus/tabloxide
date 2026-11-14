//! Runs the `git` executable.

use crate::error::{GitError, redact_credentials};
use std::ffi::OsStr;
use std::path::Path;
use std::process::{Command, Stdio};

/// The `git` executable and its environment.
#[derive(Debug, Clone, Default)]
pub struct Git {
    extra_env: Vec<(String, String)>,
}

/// The output of a `git` command that ended.
pub(crate) struct Output {
    pub is_success: bool,
    pub stdout: Vec<u8>,
    pub stderr: String,
}

impl Output {
    pub(crate) fn stdout_text(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }

    /// The text that Git wrote for the user. Git writes progress and results to the two streams.
    pub(crate) fn message(&self) -> String {
        let text = format!("{}\n{}", self.stderr.trim(), self.stdout_text().trim());
        redact_credentials(text.trim())
    }
}

impl Git {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds environment variables to each `git` command. Tests use this to ignore the
    /// Git configuration of the machine.
    #[must_use]
    pub fn with_env(mut self, name: &str, value: &str) -> Self {
        self.extra_env.push((name.to_owned(), value.to_owned()));
        self
    }

    /// Runs `git` in `directory` and waits for the end.
    pub(crate) fn output<I, S>(&self, directory: &Path, args: I) -> Result<Output, GitError>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let result = Command::new("git")
            .current_dir(directory)
            .args(args)
            // Git must fail, and not wait, when it needs a credential or a passphrase.
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_SSH_COMMAND", "ssh -oBatchMode=yes")
            // The parsers of this crate read the English output.
            .env("LC_ALL", "C")
            .envs(self.extra_env.iter().map(|(name, value)| (name, value)))
            .stdin(Stdio::null())
            .output();
        match result {
            Ok(output) => Ok(Output {
                is_success: output.status.success(),
                stdout: output.stdout,
                stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Err(GitError::NotInstalled)
            }
            Err(error) => Err(GitError::Io(error)),
        }
    }

    /// Runs `git` and returns the output. A command that fails is an error.
    pub(crate) fn run<I, S>(&self, directory: &Path, args: I) -> Result<Output, GitError>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let output = self.output(directory, args)?;
        if output.is_success {
            Ok(output)
        } else {
            Err(GitError::Failed {
                message: output.message(),
            })
        }
    }
}

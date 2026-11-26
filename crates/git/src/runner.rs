//! Runs the `git` executable.

use crate::error::{GitError, redact_credentials};
use std::ffi::OsStr;
use std::io::{BufReader, Read};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Arc;

/// Receives each progress line that Git writes during a remote operation.
pub type ProgressHandler = Arc<dyn Fn(&str) + Send + Sync>;

/// The `git` executable and its environment.
#[derive(Clone, Default)]
pub struct Git {
    extra_env: Vec<(String, String)>,
    /// `true` if a helper program answers the prompts of Git and SSH.
    has_askpass: bool,
    progress: Option<ProgressHandler>,
}

pub(crate) fn spawn_error(error: std::io::Error) -> GitError {
    if error.kind() == std::io::ErrorKind::NotFound {
        GitError::NotInstalled
    } else {
        GitError::Io(error)
    }
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
        let text = format!(
            "{}\n{}",
            final_lines(&self.stderr).trim(),
            self.stdout_text().trim()
        );
        redact_credentials(text.trim())
    }
}

/// Git writes a progress line again and again, with a carriage return between the
/// versions. This function keeps the last version of each line.
fn final_lines(text: &str) -> String {
    let lines: Vec<&str> = text
        .lines()
        .map(|line| line.trim_end_matches('\r'))
        .map(|line| line.rsplit('\r').next().unwrap_or(line))
        .collect();
    lines.join("\n")
}

/// Reads `stream` to its end. Calls `on_line` for each part that ends with a line
/// feed or a carriage return. Returns all the text.
fn read_lines(stream: impl Read, on_line: &dyn Fn(&str)) -> String {
    let mut all = Vec::new();
    let mut line_start = 0;
    for byte in BufReader::new(stream).bytes().map_while(Result::ok) {
        all.push(byte);
        if byte == b'\n' || byte == b'\r' {
            let line = String::from_utf8_lossy(&all[line_start..all.len() - 1]);
            if !line.trim().is_empty() {
                on_line(&redact_credentials(line.trim()));
            }
            line_start = all.len();
        }
    }
    String::from_utf8_lossy(&all).into_owned()
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

    /// Makes Git and SSH send their prompts to a helper program. `env` comes from
    /// [`crate::AskpassSession::env`].
    #[must_use]
    pub fn with_askpass(mut self, env: Vec<(String, String)>) -> Self {
        self.extra_env.extend(env);
        self.has_askpass = true;
        self
    }

    /// Sends each progress line of fetch, pull, push, and clone to `handler`.
    #[must_use]
    pub fn with_progress(mut self, handler: ProgressHandler) -> Self {
        self.progress = Some(handler);
        self
    }

    pub(crate) fn has_progress(&self) -> bool {
        self.progress.is_some()
    }

    pub(crate) fn command<I, S>(&self, directory: &Path, args: I) -> Command
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let mut command = Command::new("git");
        command
            .current_dir(directory)
            .args(args)
            // Git must fail, and not wait, when it cannot ask for a credential.
            .env("GIT_TERMINAL_PROMPT", "0")
            // The parsers of this crate read the English output.
            .env("LC_ALL", "C")
            .stdin(Stdio::null());
        if !self.has_askpass {
            // Without a helper program, SSH must fail when it needs a passphrase.
            command.env("GIT_SSH_COMMAND", "ssh -oBatchMode=yes");
        }
        command.envs(self.extra_env.iter().map(|(name, value)| (name, value)));
        command
    }

    /// Runs `git` in `directory` and waits for the end.
    pub(crate) fn output<I, S>(&self, directory: &Path, args: I) -> Result<Output, GitError>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let result = self.command(directory, args).output();
        match result {
            Ok(output) => Ok(Output {
                is_success: output.status.success(),
                stdout: output.stdout,
                stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            }),
            Err(error) => Err(spawn_error(error)),
        }
    }

    /// Runs a remote operation. Sends each line of the error stream to the progress
    /// handler while Git runs. A command that fails is an error.
    pub(crate) fn run_remote<I, S>(&self, directory: &Path, args: I) -> Result<Output, GitError>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let Some(progress) = &self.progress else {
            return self.run(directory, args);
        };
        let mut child = self
            .command(directory, args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(spawn_error)?;
        let stdout_pipe = child.stdout.take();
        let stderr_pipe = child.stderr.take();
        // Read the two streams at the same time. If not, a full pipe stops Git.
        let (stdout, stderr) = std::thread::scope(|scope| {
            let reader = scope.spawn(move || {
                let mut bytes = Vec::new();
                if let Some(mut pipe) = stdout_pipe {
                    // A read error ends the output at that point.
                    let _ = pipe.read_to_end(&mut bytes);
                }
                bytes
            });
            let stderr = stderr_pipe
                .map(|pipe| read_lines(pipe, progress.as_ref()))
                .unwrap_or_default();
            (reader.join().unwrap_or_default(), stderr)
        });
        let output = Output {
            is_success: child.wait()?.success(),
            stdout,
            stderr,
        };
        if output.is_success {
            Ok(output)
        } else {
            Err(GitError::Failed {
                message: output.message(),
            })
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn keeps_the_last_version_of_each_progress_line() {
        let text = "remote: Counting objects:  50% (1/2)\rremote: Counting objects: 100% (2/2), done.\nFrom origin\r\n";

        assert_eq!(
            final_lines(text),
            "remote: Counting objects: 100% (2/2), done.\nFrom origin"
        );
    }

    #[test]
    fn sends_each_line_without_credentials_and_returns_all_text() {
        let lines = Mutex::new(Vec::new());
        let text = "one  1%\rone 100%\n\nFrom https://ada:s3cr3t@example.com/x\nlast";

        let all = read_lines(text.as_bytes(), &|line| {
            lines.lock().unwrap().push(line.to_owned());
        });

        assert_eq!(all, text);
        assert_eq!(
            *lines.lock().unwrap(),
            vec!["one  1%", "one 100%", "From https://***@example.com/x"]
        );
    }
}

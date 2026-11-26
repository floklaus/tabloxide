//! The Git console: one Git command that the user types.
//!
//! The console runs only the `git` executable, with the words of the line as
//! arguments. It runs no shell. Thus pipes, redirects, and variables do not operate.
//! The check refuses:
//! - characters that only a shell knows, outside quotes;
//! - options that make Git run a different program;
//! - commands that need a terminal, an editor, or a window;
//! - aliases that run a shell command;
//! - configuration values that name a program.
//!
//! A command that can remove work gets a confirmation with its effect before it runs.

use crate::error::GitError;
use crate::runner::Git;
use serde::Serialize;
use std::io::Read;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// The console keeps this number of bytes of each output stream at most. A longer
/// output keeps its end.
pub const MAX_CONSOLE_OUTPUT_BYTES: usize = 1_048_576;

/// The editor of a console command. No program has this name. Thus a command that
/// opens an editor fails at once, and does not wait for a window.
const NO_EDITOR: &str = "tabloxide-console-has-no-editor";

/// The result of the check of a line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum ConsoleCheck {
    /// The command can run.
    Ready,
    /// The command can remove work. The user must confirm `effect` first.
    Confirm { effect: String },
    /// The command does not run, because of `reason`.
    Refused { reason: String },
}

/// The output of a command of the console.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ConsoleOutput {
    pub stdout: String,
    pub stderr: String,
    pub is_success: bool,
    /// `true` if the output was longer than the limit. The text has its end.
    pub is_cut: bool,
    pub is_cancelled: bool,
    /// An explanation of the application, for example that Git wanted an editor.
    pub note: Option<String>,
}

/// A line split into the parts of a Git command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConsoleCommand {
    /// The options before the subcommand, for example `--no-pager`.
    pub global: Vec<String>,
    pub subcommand: String,
    pub args: Vec<String>,
}

impl ConsoleCommand {
    /// The arguments for the `git` executable. The console adds options that stop the
    /// pager and the colours, because the output goes to a text view.
    #[must_use]
    pub fn git_args(&self) -> Vec<String> {
        let mut all = vec![
            "--no-pager".to_owned(),
            "-c".to_owned(),
            "color.ui=never".to_owned(),
        ];
        all.extend(self.global.iter().cloned());
        all.push(self.subcommand.clone());
        all.extend(self.args.iter().cloned());
        all
    }

    fn has(&self, option: &str) -> bool {
        self.args.iter().any(|arg| arg == option)
    }

    /// `true` if an argument is `option`, or starts with `option=`.
    fn has_value_option(&self, option: &str) -> bool {
        self.args
            .iter()
            .any(|arg| arg == option || arg.starts_with(&format!("{option}=")))
    }

    /// `true` if a group of short options, for example `-fdx`, has `letter`.
    fn has_short(&self, letter: char) -> bool {
        self.args.iter().any(|arg| {
            arg.len() > 1
                && arg.starts_with('-')
                && !arg.starts_with("--")
                && arg[1..].chars().all(|c| c.is_ascii_alphabetic())
                && arg[1..].contains(letter)
        })
    }

    /// The arguments that are not options, without `--`.
    fn operands(&self) -> Vec<&str> {
        self.args
            .iter()
            .map(String::as_str)
            .filter(|arg| !arg.starts_with('-'))
            .collect()
    }
}

/// Returns the first character outside quotes that only a shell knows, or `None`.
/// The console runs no shell, thus such a character would not do what the user wants.
#[must_use]
pub fn shell_character(line: &str) -> Option<String> {
    let mut quote: Option<char> = None;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match quote {
            Some('\'') => {
                if c == '\'' {
                    quote = None;
                }
            }
            Some(_) => match c {
                '"' => quote = None,
                '\\' => {
                    chars.next();
                }
                '$' | '`' => return Some(c.to_string()),
                _ => {}
            },
            None => match c {
                '\'' | '"' => quote = Some(c),
                '\\' => {
                    chars.next();
                }
                '|' | '>' | '<' | ';' | '&' | '$' | '`' => return Some(c.to_string()),
                _ => {}
            },
        }
    }
    None
}

/// The options before the subcommand that the console permits. The other options,
/// for example `-c`, `-C`, `--exec-path`, or `--git-dir`, can change the program or
/// the folder.
const GLOBAL_OPTIONS: &[&str] = &[
    "--no-pager",
    "--no-replace-objects",
    "--literal-pathspecs",
    "--glob-pathspecs",
    "--noglob-pathspecs",
    "--icase-pathspecs",
    "--no-optional-locks",
];

/// Splits `line` into a Git command.
///
/// # Errors
///
/// Returns the reason if the line is not a Git command that the console can run.
pub fn parse(line: &str) -> Result<ConsoleCommand, String> {
    if let Some(character) = shell_character(line) {
        return Err(format!(
            "The Git console has no shell. The character {character} does not operate \
             here. Type one Git command, without pipes, redirects, or variables."
        ));
    }
    let mut words = shell_words::split(line)
        .map_err(|_| "The command has a quote without its end.".to_owned())?
        .into_iter()
        .peekable();
    if words.peek().map(String::as_str) == Some("git") {
        words.next();
    }
    let mut global = Vec::new();
    while let Some(word) = words.next_if(|word| word.starts_with('-')) {
        if word == "--help" || word == "-h" {
            return Err(HELP.to_owned());
        }
        if !GLOBAL_OPTIONS.contains(&word.as_str()) {
            return Err(format!(
                "The Git console does not accept the option {word} before the command. \
                 Such an option can change the program or the folder of Git."
            ));
        }
        global.push(word);
    }
    let Some(subcommand) = words.next() else {
        return Err("Type a Git command, for example status.".to_owned());
    };
    Ok(ConsoleCommand {
        global,
        subcommand,
        args: words.collect(),
    })
}

const HELP: &str = "The help of Git opens a different program. For a short help text in \
the console, use -h after the command, for example log -h.";

const TERMINAL: &str = "This command asks questions in a terminal, and the Git console \
has no terminal. Use the terminal of your system.";

const SHELL: &str = "This command runs shell commands. The Git console runs no shell. \
Use the terminal of your system.";

const PROGRAM: &str = "This option makes Git run a different program. The Git console \
runs only Git.";

/// Returns the reason if the console refuses the command. Aliases and configuration
/// are not part of this check.
#[must_use]
pub fn refusal(command: &ConsoleCommand) -> Option<String> {
    let c = command;
    if c.has("--help") {
        return Some(HELP.to_owned());
    }
    let reason = match c.subcommand.as_str() {
        "help" | "instaweb" | "web--browse" | "gui" | "citool" | "gitk" | "difftool"
        | "mergetool" | "daemon" | "credential" | "send-email" => {
            "This command opens a different program or waits for input. The Git console \
             cannot show it. Use the terminal of your system."
        }
        "rebase" if c.has_short('i') || c.has("--interactive") || c.has("--edit-todo") => {
            "This command opens an editor, and the Git console cannot show an editor. Use \
             the terminal of your system for an interactive rebase."
        }
        "rebase" if c.has_short('x') || c.has_value_option("--exec") => SHELL,
        "submodule" if c.operands().first() == Some(&"foreach") => SHELL,
        "bisect" if c.operands().first() == Some(&"run") => SHELL,
        "filter-branch" => SHELL,
        "add"
            if c.has_short('p')
                || c.has_short('i')
                || c.has_short('e')
                || c.has("--patch")
                || c.has("--interactive")
                || c.has("--edit") =>
        {
            TERMINAL
        }
        "commit" if c.has_short('p') || c.has("--patch") || c.has("--interactive") => TERMINAL,
        "checkout" | "reset" | "restore" | "stash" if c.has_short('p') || c.has("--patch") => {
            TERMINAL
        }
        "config" if c.has_short('e') || c.has("--edit") => {
            "This command opens an editor, and the Git console cannot show an editor. Use \
             the terminal of your system."
        }
        "clone"
            if c.has_short('u')
                || c.has_value_option("--upload-pack")
                || c.has_value_option("--template")
                || c.has_short('c')
                || c.has_value_option("--config") =>
        {
            PROGRAM
        }
        "fetch" | "pull" | "ls-remote" if c.has_value_option("--upload-pack") => PROGRAM,
        "push" if c.has_value_option("--receive-pack") || c.has_value_option("--exec") => PROGRAM,
        "archive" if c.has_value_option("--exec") => PROGRAM,
        "diff" | "log" | "show" if c.has("--ext-diff") || c.has("--textconv") => PROGRAM,
        _ => return config_refusal(c),
    };
    Some(reason.to_owned())
}

/// The configuration keys that name a program, or that load other configuration.
fn is_program_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    const KEYS: &[&str] = &[
        "core.pager",
        "core.editor",
        "core.sshcommand",
        "core.fsmonitor",
        "core.hookspath",
        "core.askpass",
        "sequence.editor",
        "diff.external",
        "gpg.program",
        "include.path",
        "credential.helper",
    ];
    const ENDINGS: &[&str] = &[
        ".textconv",
        ".command",
        ".driver",
        ".clean",
        ".smudge",
        ".process",
        ".cmd",
        ".helper",
        ".program",
        ".path",
    ];
    KEYS.contains(&key.as_str())
        || ENDINGS.iter().any(|ending| key.ends_with(ending))
        || key.starts_with("includeif.")
        || key.starts_with("alias.")
}

/// Refuses a change of configuration that names a program. Git runs such a program
/// later, for example for the next fetch.
fn config_refusal(command: &ConsoleCommand) -> Option<String> {
    if command.subcommand != "config" {
        return None;
    }
    let operands = command.operands();
    // `git config set <key> <value>` and `git config <key> <value>` change a value.
    let (key, value) = match operands.as_slice() {
        ["set", key, value, ..] => (*key, Some(*value)),
        [key, value, ..] if *key != "get" && *key != "list" => (*key, Some(*value)),
        _ => return None,
    };
    if !is_program_key(key) {
        return None;
    }
    // An alias without `!` runs Git only. Thus it can stay.
    if key.to_ascii_lowercase().starts_with("alias.") && !value.is_some_and(|v| v.starts_with('!'))
    {
        return None;
    }
    Some(format!(
        "The Git console does not set {key}, because Git runs the program of this value \
         later. Use the terminal of your system."
    ))
}

fn plural(count: u32, noun: &str) -> String {
    if count == 1 {
        format!("1 {noun}")
    } else {
        format!("{count} {noun}s")
    }
}

const NO_UNDO: &str = "You cannot undo it in Tabloxide.";

impl Git {
    /// Checks a line of the console.
    ///
    /// # Errors
    ///
    /// Returns an error if Git fails while the check reads the repository.
    pub fn console_check(&self, root: &Path, line: &str) -> Result<ConsoleCheck, GitError> {
        let command = match parse(line) {
            Ok(command) => command,
            Err(reason) => return Ok(ConsoleCheck::Refused { reason }),
        };
        if let Some(reason) = refusal(&command) {
            return Ok(ConsoleCheck::Refused { reason });
        }
        if self.is_shell_alias(root, &command.subcommand)? {
            return Ok(ConsoleCheck::Refused {
                reason: format!(
                    "The alias {} runs a shell command. The Git console runs no shell.",
                    command.subcommand
                ),
            });
        }
        Ok(match self.effect(root, &command)? {
            Some(effect) => ConsoleCheck::Confirm { effect },
            None => ConsoleCheck::Ready,
        })
    }

    fn is_shell_alias(&self, root: &Path, name: &str) -> Result<bool, GitError> {
        let key = format!("alias.{name}");
        let output = self.output(root, ["config", "--get", &key])?;
        Ok(output.is_success && output.stdout_text().trim_start().starts_with('!'))
    }

    /// Tells what a command removes, or `None` if it does not remove work.
    fn effect(&self, root: &Path, c: &ConsoleCommand) -> Result<Option<String>, GitError> {
        let text = match c.subcommand.as_str() {
            "reset" if c.has("--hard") => self.reset_effect(root, c)?,
            "clean"
                if (c.has_short('f') || c.has("--force"))
                    && !(c.has_short('n') || c.has("--dry-run")) =>
            {
                match self.clean_effect(root, c)? {
                    Some(text) => text,
                    None => return Ok(None),
                }
            }
            "checkout" if c.has_short('f') || c.has("--force") || c.has("--") || c.has(".") => {
                format!(
                    "This command can overwrite the changes of files on disk with the version \
                     of Git. {NO_UNDO}"
                )
            }
            "restore"
                if !(c.has_short('S') || c.has("--staged"))
                    || c.has_short('W')
                    || c.has("--worktree") =>
            {
                format!(
                    "This command overwrites the changes of files on disk with the version of \
                     Git. {NO_UNDO}"
                )
            }
            "rm" if !c.has("--cached") => {
                format!("This command deletes files on disk. {NO_UNDO}")
            }
            "push"
                if c.has_short('f')
                    || c.has_short('d')
                    || c.has("--force")
                    || c.has_value_option("--force-with-lease")
                    || c.has("--mirror")
                    || c.has("--delete")
                    || c.has("--prune")
                    || c.operands()
                        .iter()
                        .skip(1)
                        .any(|refspec| refspec.starts_with('+') || refspec.starts_with(':')) =>
            {
                "This command can remove commits or branches of the remote repository. \
                 Other people can lose work."
                    .to_owned()
            }
            "branch"
                if c.has_short('D')
                    || ((c.has_short('d') || c.has("--delete"))
                        && (c.has_short('f') || c.has("--force")))
                    || c.has_short('M') =>
            {
                format!(
                    "This command deletes or replaces a branch, also when it has commits that \
                     are in no other branch. {NO_UNDO}"
                )
            }
            "stash" if matches!(c.operands().first(), Some(&("drop" | "clear"))) => {
                format!("This command deletes stashed changes. {NO_UNDO}")
            }
            "tag" if c.has_short('d') || c.has("--delete") => {
                format!("This command deletes a tag. {NO_UNDO}")
            }
            "update-ref" if c.has_short('d') => {
                format!("This command deletes a reference. {NO_UNDO}")
            }
            "reflog" if matches!(c.operands().first(), Some(&("expire" | "delete"))) => {
                format!(
                    "This command deletes entries of the reflog, and with them the way back to earlier commits. {NO_UNDO}"
                )
            }
            "gc" if c.has_value_option("--prune") => {
                format!("This command deletes commits that no branch refers to. {NO_UNDO}")
            }
            "prune" => format!("This command deletes commits that no branch refers to. {NO_UNDO}"),
            _ => return Ok(None),
        };
        Ok(Some(text))
    }

    fn reset_effect(&self, root: &Path, c: &ConsoleCommand) -> Result<String, GitError> {
        let status = self.status(root)?;
        let changed = status
            .files
            .iter()
            .filter(|file| !file.is_untracked && (file.staged.is_some() || file.unstaged.is_some()))
            .count();
        let changed = u32::try_from(changed).unwrap_or(u32::MAX);
        let target = c.operands().first().copied().unwrap_or("HEAD");
        let behind = if status.has_commits && self.has_revision(root, target)? {
            let range = format!("{target}..HEAD");
            self.output(root, ["rev-list", "--count", &range])?
                .stdout_text()
                .trim()
                .parse::<u32>()
                .unwrap_or(0)
        } else {
            0
        };
        let branch = status.branch.unwrap_or_else(|| "HEAD".to_owned());
        let files = if changed == 0 {
            "This command removes no changes of files".to_owned()
        } else {
            format!(
                "This command removes the changes in {}",
                plural(changed, "file")
            )
        };
        let moves = if behind == 0 {
            String::new()
        } else {
            format!(" and moves {branch} back by {}", plural(behind, "commit"))
        };
        Ok(format!("{files}{moves}. {NO_UNDO}"))
    }

    /// Lists the files that `clean` deletes. Returns `None` if it deletes no files.
    fn clean_effect(&self, root: &Path, c: &ConsoleCommand) -> Result<Option<String>, GitError> {
        let mut args = vec!["clean".to_owned(), "-n".to_owned()];
        args.extend(
            c.args
                .iter()
                .filter(|arg| arg.as_str() != "--force")
                .map(|arg| {
                    if arg.starts_with('-') && !arg.starts_with("--") {
                        arg.replace('f', "")
                    } else {
                        arg.clone()
                    }
                })
                .filter(|arg| arg != "-"),
        );
        let output = self.run(root, &args)?;
        let files: Vec<String> = output
            .stdout_text()
            .lines()
            .filter_map(|line| line.strip_prefix("Would remove ").map(str::to_owned))
            .collect();
        if files.is_empty() {
            return Ok(None);
        }
        let count = u32::try_from(files.len()).unwrap_or(u32::MAX);
        let shown: Vec<&str> = files.iter().take(5).map(String::as_str).collect();
        let more = if files.len() > shown.len() {
            ", and more"
        } else {
            ""
        };
        Ok(Some(format!(
            "This command deletes {} that Git does not track: {}{more}. {NO_UNDO}",
            plural(count, "file"),
            shown.join(", ")
        )))
    }

    /// Runs a command of the console in `root`. The command must have passed
    /// [`Git::console_check`]. A `true` in `cancel` stops it.
    ///
    /// # Errors
    ///
    /// Returns an error if the `git` executable cannot start.
    pub fn console_run(
        &self,
        root: &Path,
        command: &ConsoleCommand,
        cancel: &AtomicBool,
    ) -> Result<ConsoleOutput, GitError> {
        let mut child = self
            .command(root, command.git_args())
            .env("GIT_EDITOR", NO_EDITOR)
            .env("GIT_SEQUENCE_EDITOR", NO_EDITOR)
            .env("GIT_MERGE_AUTOEDIT", "no")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(crate::runner::spawn_error)?;
        let stdout_pipe = child.stdout.take();
        let stderr_pipe = child.stderr.take();
        let mut is_cancelled = false;
        let ((stdout, stdout_cut), (stderr, stderr_cut)) = std::thread::scope(|scope| {
            let out = scope.spawn(move || read_tail(stdout_pipe));
            let err = scope.spawn(move || read_tail(stderr_pipe));
            loop {
                if let Ok(Some(_)) = child.try_wait() {
                    break;
                }
                if cancel.load(Ordering::Relaxed) {
                    // The process can end at the same time. Then the kill has no effect.
                    let _ = child.kill();
                    is_cancelled = true;
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            (
                out.join().unwrap_or_default(),
                err.join().unwrap_or_default(),
            )
        });
        let is_success = !is_cancelled && child.wait()?.success();
        let stderr = crate::error::redact_credentials(&stderr);
        let note = stderr.contains(NO_EDITOR).then(|| {
            "Git wanted to open an editor. The Git console cannot show an editor. Give the \
             text in the command, for example commit -m \"Fix the report\"."
                .to_owned()
        });
        Ok(ConsoleOutput {
            stdout: crate::error::redact_credentials(&stdout),
            stderr,
            is_success,
            is_cut: stdout_cut || stderr_cut,
            is_cancelled,
            note,
        })
    }
}

/// The names that the console completes with the Tab key.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ConsoleNames {
    /// Local branches, and remote branches as `origin/main`.
    pub branches: Vec<String>,
    pub remotes: Vec<String>,
    pub tags: Vec<String>,
    /// The files of the repository, without the ignored files.
    pub files: Vec<String>,
}

/// The completion has this number of files at most.
const MAX_COMPLETION_FILES: usize = 5000;

impl Git {
    /// Reads the names that the console completes.
    ///
    /// # Errors
    ///
    /// Returns an error if Git fails.
    pub fn console_names(&self, root: &Path) -> Result<ConsoleNames, GitError> {
        let lines = |args: &[&str]| -> Result<Vec<String>, GitError> {
            Ok(self
                .run(root, args)?
                .stdout_text()
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty() && !line.ends_with("/HEAD"))
                .map(str::to_owned)
                .collect())
        };
        let mut files = lines(&["ls-files", "--cached", "--others", "--exclude-standard"])?;
        files.truncate(MAX_COMPLETION_FILES);
        Ok(ConsoleNames {
            branches: lines(&[
                "for-each-ref",
                "--format=%(refname:short)",
                "refs/heads",
                "refs/remotes",
            ])?,
            remotes: lines(&["remote"])?,
            tags: lines(&["tag", "--list"])?,
            files,
        })
    }
}

/// Reads a stream to its end. Keeps the last [`MAX_CONSOLE_OUTPUT_BYTES`] bytes, and
/// tells if it removed the start.
fn read_tail(pipe: Option<impl Read>) -> (String, bool) {
    let Some(mut pipe) = pipe else {
        return (String::new(), false);
    };
    let mut kept: Vec<u8> = Vec::new();
    let mut is_cut = false;
    let mut buffer = [0u8; 8192];
    // A read error ends the output at that point.
    while let Ok(count) = pipe.read(&mut buffer) {
        if count == 0 {
            break;
        }
        kept.extend_from_slice(&buffer[..count]);
        if kept.len() > 2 * MAX_CONSOLE_OUTPUT_BYTES {
            kept.drain(..kept.len() - MAX_CONSOLE_OUTPUT_BYTES);
            is_cut = true;
        }
    }
    if kept.len() > MAX_CONSOLE_OUTPUT_BYTES {
        kept.drain(..kept.len() - MAX_CONSOLE_OUTPUT_BYTES);
        is_cut = true;
    }
    (String::from_utf8_lossy(&kept).into_owned(), is_cut)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn refused(line: &str) -> String {
        let command = match parse(line) {
            Ok(command) => command,
            Err(reason) => return reason,
        };
        refusal(&command).unwrap_or_default()
    }

    #[test]
    fn a_long_output_keeps_its_end() {
        let text = format!("{}END", "x".repeat(3 * MAX_CONSOLE_OUTPUT_BYTES));

        let (kept, is_cut) = read_tail(Some(text.as_bytes()));
        let (short, is_short_cut) = read_tail(Some("ok".as_bytes()));

        assert!(is_cut);
        assert_eq!(kept.len(), MAX_CONSOLE_OUTPUT_BYTES);
        assert!(kept.ends_with("END"));
        assert_eq!((short.as_str(), is_short_cut), ("ok", false));
    }

    #[test]
    fn finds_shell_characters_only_outside_quotes() {
        assert_eq!(shell_character("log | head"), Some("|".to_owned()));
        assert_eq!(shell_character("log > out.txt"), Some(">".to_owned()));
        assert_eq!(shell_character("status; rm x"), Some(";".to_owned()));
        assert_eq!(shell_character("log $HOME"), Some("$".to_owned()));
        assert_eq!(shell_character("commit -m \"$(id)\""), Some("$".to_owned()));
        assert_eq!(shell_character("log `id`"), Some("`".to_owned()));
        assert_eq!(shell_character("commit -m 'a | b > c; $d'"), None);
        assert_eq!(shell_character("commit -m \"a | b > c; d\""), None);
        assert_eq!(shell_character("log a\\|b"), None);
    }

    #[test]
    fn parses_the_words_with_quotes_and_without_the_git_word() {
        let command = parse("git --no-pager commit -m \"Fix the report\"").unwrap();

        assert_eq!(command.global, ["--no-pager"]);
        assert_eq!(command.subcommand, "commit");
        assert_eq!(command.args, ["-m", "Fix the report"]);
        assert_eq!(
            command.git_args(),
            [
                "--no-pager",
                "-c",
                "color.ui=never",
                "--no-pager",
                "commit",
                "-m",
                "Fix the report"
            ]
        );
        assert!(parse("commit -m \"open").unwrap_err().contains("quote"));
        assert!(parse("git").unwrap_err().contains("Type a Git command"));
    }

    #[test]
    fn refuses_global_options_that_change_the_program_or_the_folder() {
        for line in [
            "-c core.pager=sh log",
            "-C /tmp status",
            "--exec-path=/tmp status",
            "--git-dir=/tmp/x status",
            "--work-tree=/tmp status",
            "--config-env=core.pager=X log",
        ] {
            assert!(
                refused(line).contains("does not accept the option"),
                "{line}"
            );
        }
    }

    #[test]
    fn refuses_commands_that_need_an_editor_a_terminal_or_a_window() {
        assert!(refused("rebase -i HEAD~3").contains("interactive rebase"));
        assert!(refused("rebase --interactive main").contains("editor"));
        assert!(refused("add -p").contains("terminal"));
        assert!(refused("checkout --patch x.sql").contains("terminal"));
        assert!(refused("config --edit").contains("editor"));
        assert!(refused("mergetool").contains("different program"));
        assert!(refused("help log").contains("different program"));
        assert!(refused("log --help").contains("-h"));
        assert!(refused("--help").contains("-h"));
    }

    #[test]
    fn refuses_commands_and_options_that_run_other_programs() {
        assert!(refused("rebase -x 'make test' main").contains("shell"));
        assert!(refused("rebase --exec=make main").contains("shell"));
        assert!(refused("submodule foreach ls").contains("shell"));
        assert!(refused("bisect run ./test.sh").contains("shell"));
        assert!(refused("clone -u /tmp/x url").contains("different program"));
        assert!(refused("clone --upload-pack=x url").contains("different program"));
        assert!(refused("clone --template=/tmp/hooks url").contains("different program"));
        assert!(refused("fetch --upload-pack x origin").contains("different program"));
        assert!(refused("push --receive-pack=x origin").contains("different program"));
        assert!(refused("diff --ext-diff").contains("different program"));
    }

    #[test]
    fn refuses_configuration_that_names_a_program() {
        assert!(refused("config core.sshCommand 'sh -c id'").contains("core.sshCommand"));
        assert!(refused("config set core.pager less").contains("core.pager"));
        assert!(refused("config diff.sql.textconv cat").contains("textconv"));
        assert!(refused("config alias.x '!sh'").contains("alias.x"));
        assert_eq!(refused("config alias.st status"), "");
        assert_eq!(refused("config user.name Ada"), "");
        assert_eq!(refused("config core.pager"), "");
    }

    #[test]
    fn accepts_plain_commands_and_the_safe_short_options() {
        for line in [
            "status -sb",
            "log --oneline -3",
            "stash push -m \"wip revenue\"",
            "push -u origin main",
            "commit -C HEAD",
            "commit -m 'a; b'",
            "diff --stat",
        ] {
            assert_eq!(refused(line), "", "{line}");
        }
    }
}

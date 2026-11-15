//! Git operations on one repository.

use crate::error::GitError;
use crate::runner::Git;
use crate::status::{StatusReport, parse_status};
use serde::Serialize;
use std::path::{Component, Path, PathBuf};

/// The `.gitignore` that a new repository gets. It excludes exports and logs.
pub const STARTER_GITIGNORE: &str = "# Result exports\n*.csv\n/exports/\n\n# Logs\n*.log\n";

/// Largest file that the diff view shows.
const MAX_DIFF_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
}

/// The result of a request to delete a branch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
pub enum BranchDeletion {
    Deleted,
    /// The branch has commits that are in no other branch. Git did not delete it.
    NotMerged,
}

/// The two sides of the diff of one file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct FileDiff {
    pub original: String,
    pub modified: String,
}

pub(crate) fn invalid(name: &str) -> GitError {
    GitError::InvalidName(name.to_owned())
}

/// A path for a Git command must stay in the repository and must not look like an option.
pub(crate) fn check_path(path: &str) -> Result<(), GitError> {
    let is_plain = Path::new(path)
        .components()
        .all(|part| matches!(part, Component::Normal(_)));
    if path.is_empty() || path.starts_with('-') || !is_plain {
        return Err(invalid(path));
    }
    Ok(())
}

pub(crate) fn to_text(bytes: Vec<u8>, path: &str) -> Result<String, GitError> {
    if bytes.len() > MAX_DIFF_BYTES || bytes.contains(&0) {
        return Err(GitError::NotText(path.to_owned()));
    }
    String::from_utf8(bytes).map_err(|_| GitError::NotText(path.to_owned()))
}

impl Git {
    /// Returns the version text of the `git` executable.
    ///
    /// # Errors
    ///
    /// Returns [`GitError::NotInstalled`] if the executable is not in the PATH.
    pub fn version(&self) -> Result<String, GitError> {
        let output = self.run(Path::new("."), ["--version"])?;
        Ok(output
            .stdout_text()
            .trim()
            .trim_start_matches("git version ")
            .to_owned())
    }

    /// Returns the root of the repository that contains `directory`,
    /// or `None` if the directory is not in a repository.
    ///
    /// # Errors
    ///
    /// Returns an error if Git is not installed.
    pub fn find_root(&self, directory: &Path) -> Result<Option<PathBuf>, GitError> {
        let output = self.output(directory, ["rev-parse", "--show-toplevel"])?;
        Ok(output
            .is_success
            .then(|| PathBuf::from(output.stdout_text().trim_end_matches(['\n', '\r']))))
    }

    /// Makes a repository in `directory`. Adds the starter `.gitignore` if the
    /// directory has no `.gitignore`.
    ///
    /// # Errors
    ///
    /// Returns an error if Git fails or the file is not writable.
    pub fn init(&self, directory: &Path) -> Result<(), GitError> {
        self.run(directory, ["init"])?;
        let ignore = directory.join(".gitignore");
        if !ignore.exists() {
            std::fs::write(ignore, STARTER_GITIGNORE)?;
        }
        Ok(())
    }

    /// Clones `url` into the new directory `destination`.
    ///
    /// # Errors
    ///
    /// Returns an error if the URL looks like an option, or if Git fails.
    pub fn clone_repository(&self, url: &str, destination: &Path) -> Result<(), GitError> {
        if url.trim().is_empty() || url.starts_with('-') {
            return Err(invalid(url));
        }
        let parent = destination.parent().unwrap_or(Path::new("."));
        let mut args: Vec<&std::ffi::OsStr> = vec!["clone".as_ref()];
        args.extend(self.progress_flag().map(std::ffi::OsStr::new));
        args.extend(["--".as_ref(), url.as_ref(), destination.as_os_str()]);
        self.run_remote(parent, args).map(|_| ())
    }

    /// Reads the branch, the upstream counts, and the changed files.
    ///
    /// # Errors
    ///
    /// Returns an error if `root` is not a repository.
    pub fn status(&self, root: &Path) -> Result<StatusReport, GitError> {
        let args = [
            // The status must not write the index. A write would start the file
            // watcher of the application, which reads the status again.
            "--no-optional-locks",
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "--untracked-files=all",
        ];
        let output = self.run(root, args)?;
        Ok(parse_status(&output.stdout_text()))
    }

    fn with_paths(&self, root: &Path, command: &[&str], paths: &[String]) -> Result<(), GitError> {
        if paths.is_empty() {
            return Ok(());
        }
        for path in paths {
            check_path(path)?;
        }
        let args = command
            .iter()
            .copied()
            .chain(["--"])
            .chain(paths.iter().map(String::as_str));
        self.run(root, args).map(|_| ())
    }

    /// Adds the changes of `paths` to the index.
    ///
    /// # Errors
    ///
    /// Returns an error if a path is not valid or Git fails.
    pub fn stage(&self, root: &Path, paths: &[String]) -> Result<(), GitError> {
        self.with_paths(root, &["add"], paths)
    }

    /// Removes the changes of `paths` from the index. The working tree does not change.
    ///
    /// # Errors
    ///
    /// Returns an error if a path is not valid or Git fails.
    pub fn unstage(&self, root: &Path, paths: &[String]) -> Result<(), GitError> {
        self.with_paths(root, &["reset", "--quiet"], paths)
    }

    /// Discards the changes of one file in the working tree. This deletes an untracked file.
    /// The user cannot undo this operation.
    ///
    /// # Errors
    ///
    /// Returns an error if the path is not valid or Git fails.
    pub fn discard(&self, root: &Path, path: &str, is_untracked: bool) -> Result<(), GitError> {
        let command: &[&str] = if is_untracked {
            &["clean", "--force", "--quiet"]
        } else {
            &["checkout", "--quiet"]
        };
        self.with_paths(root, command, &[path.to_owned()])
    }

    /// Reads one version of a file from the object database. A missing version is empty text.
    pub(crate) fn show(&self, root: &Path, revision: &str, path: &str) -> Result<String, GitError> {
        let output = self.output(root, ["show", &format!("{revision}:{path}")])?;
        if output.is_success {
            to_text(output.stdout, path)
        } else {
            Ok(String::new())
        }
    }

    /// Returns the two sides of the diff of one file.
    ///
    /// With `staged`, the sides are the last commit and the index.
    /// Without `staged`, the sides are the index and the working tree.
    ///
    /// # Errors
    ///
    /// Returns an error if the path is not valid, or the file is binary or too large.
    pub fn diff(&self, root: &Path, path: &str, staged: bool) -> Result<FileDiff, GitError> {
        check_path(path)?;
        if staged {
            return Ok(FileDiff {
                original: self.show(root, "HEAD", path)?,
                modified: self.show(root, "", path)?,
            });
        }
        let modified = match std::fs::read(root.join(path)) {
            Ok(bytes) => to_text(bytes, path)?,
            // A deleted file has an empty working tree side.
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(error) => return Err(error.into()),
        };
        Ok(FileDiff {
            original: self.show(root, "", path)?,
            modified,
        })
    }

    fn has_config(&self, root: &Path, key: &str) -> Result<bool, GitError> {
        let output = self.output(root, ["config", "--get", key])?;
        Ok(output.is_success && !output.stdout_text().trim().is_empty())
    }

    /// Commits the index with `message`.
    ///
    /// # Errors
    ///
    /// Returns [`GitError::MissingIdentity`] if Git has no user name or e-mail address.
    /// Returns an error if the message is empty or Git fails.
    pub fn commit(&self, root: &Path, message: &str) -> Result<(), GitError> {
        if message.trim().is_empty() {
            return Err(GitError::Failed {
                message: "Enter a commit message.".to_owned(),
            });
        }
        if !self.has_config(root, "user.name")? || !self.has_config(root, "user.email")? {
            return Err(GitError::MissingIdentity);
        }
        self.run(root, ["commit", "--quiet", "--message", message])
            .map(|_| ())
    }

    /// Lists the local branches in alphabetical sequence.
    ///
    /// # Errors
    ///
    /// Returns an error if Git fails.
    pub fn branches(&self, root: &Path) -> Result<Vec<BranchInfo>, GitError> {
        let output = self.run(
            root,
            [
                "branch",
                "--format=%(HEAD)%(refname:short)",
                "--sort=refname",
            ],
        )?;
        Ok(output
            .stdout_text()
            .lines()
            .filter(|line| line.len() > 1 && !line[1..].starts_with('('))
            .map(|line| BranchInfo {
                name: line[1..].to_owned(),
                is_current: line.starts_with('*'),
            })
            .collect())
    }

    fn check_branch_name(&self, root: &Path, name: &str) -> Result<(), GitError> {
        if name.starts_with('-') {
            return Err(invalid(name));
        }
        let output = self.output(root, ["check-ref-format", "--branch", name])?;
        if output.is_success {
            Ok(())
        } else {
            Err(invalid(name))
        }
    }

    /// Makes the branch `name` at the current commit and switches to it.
    ///
    /// # Errors
    ///
    /// Returns an error if the name is not valid or Git fails.
    pub fn create_branch(&self, root: &Path, name: &str) -> Result<(), GitError> {
        self.check_branch_name(root, name)?;
        self.run(root, ["switch", "--quiet", "--create", name])
            .map(|_| ())
    }

    /// Switches to the branch `name`. Git refuses the switch if it would lose a change
    /// of the working tree.
    ///
    /// # Errors
    ///
    /// Returns an error if the name is not valid or Git fails.
    pub fn switch_branch(&self, root: &Path, name: &str) -> Result<(), GitError> {
        self.check_branch_name(root, name)?;
        self.run(root, ["switch", "--quiet", name]).map(|_| ())
    }

    /// Gives the branch `old_name` the name `new_name`.
    ///
    /// # Errors
    ///
    /// Returns an error if a name is not valid, or a branch with the new name exists.
    pub fn rename_branch(
        &self,
        root: &Path,
        old_name: &str,
        new_name: &str,
    ) -> Result<(), GitError> {
        self.check_branch_name(root, old_name)?;
        self.check_branch_name(root, new_name)?;
        self.run(root, ["branch", "--move", old_name, new_name])
            .map(|_| ())
    }

    /// Deletes the branch `name`. Without `force`, Git does not delete a branch that
    /// has commits that are in no other branch.
    ///
    /// # Errors
    ///
    /// Returns an error if the name is not valid, or the branch is the current branch.
    pub fn delete_branch(
        &self,
        root: &Path,
        name: &str,
        force: bool,
    ) -> Result<BranchDeletion, GitError> {
        self.check_branch_name(root, name)?;
        let mode = if force { "--force" } else { "--no-force" };
        let output = self.output(root, ["branch", "--delete", mode, name])?;
        if output.is_success {
            Ok(BranchDeletion::Deleted)
        } else if !force && output.stderr.contains("not fully merged") {
            Ok(BranchDeletion::NotMerged)
        } else {
            Err(GitError::Failed {
                message: output.message(),
            })
        }
    }

    /// Git writes progress lines only to a terminal, unless this flag is set.
    fn progress_flag(&self) -> Option<&'static str> {
        self.has_progress().then_some("--progress")
    }

    /// Runs a remote operation and returns the text that Git wrote.
    fn remote(&self, root: &Path, command: &[&str]) -> Result<String, GitError> {
        let (name, rest) = command.split_first().unwrap_or((&"", &[]));
        let args = std::iter::once(*name)
            .chain(self.progress_flag())
            .chain(rest.iter().copied());
        Ok(self.run_remote(root, args)?.message())
    }

    /// Gets the new commits of the remote. Returns the text that Git wrote.
    ///
    /// # Errors
    ///
    /// Returns an error if Git fails, for example because a credential is missing.
    pub fn fetch(&self, root: &Path) -> Result<String, GitError> {
        self.remote(root, &["fetch", "--prune"])
    }

    /// Gets the new commits of the upstream branch and merges them. The merge is a
    /// fast-forward when that is possible. Returns the text that Git wrote.
    ///
    /// # Errors
    ///
    /// Returns an error if Git fails. A merge conflict is such a failure.
    pub fn pull(&self, root: &Path) -> Result<String, GitError> {
        self.remote(root, &["pull", "--no-rebase", "--no-edit"])
    }

    /// Sends the commits of the current branch to the remote. A branch without an
    /// upstream gets the branch of the same name on `origin` as its upstream.
    ///
    /// # Errors
    ///
    /// Returns an error if Git fails, for example because the remote has new commits.
    pub fn push(&self, root: &Path) -> Result<String, GitError> {
        let status = self.status(root)?;
        match (&status.upstream, &status.branch) {
            (None, Some(branch)) => {
                self.remote(root, &["push", "--set-upstream", "origin", branch.as_str()])
            }
            _ => self.remote(root, &["push"]),
        }
    }
}

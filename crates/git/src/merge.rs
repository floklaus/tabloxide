//! A merge that stopped with conflicts: the sides of a file and its resolution.

use crate::error::GitError;
use crate::operations::{check_path, invalid, to_text};
use crate::runner::Git;
use serde::Serialize;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

/// The versions of one file with a conflict. A version is `None` if the file is
/// not in that side, for example because that side deleted it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ConflictSides {
    /// The version in the common ancestor of the two branches.
    pub base: Option<String>,
    /// The version in the current branch.
    pub ours: Option<String>,
    /// The version in the branch that the merge brings in.
    pub theirs: Option<String>,
    /// The file on disk. Git wrote conflict markers into it.
    pub working: Option<String>,
}

/// Returns the absolute path of a file for a write operation. The file must not be a
/// symbolic link, and its folder must be in the repository.
fn writable_target(root: &Path, path: &str) -> Result<PathBuf, GitError> {
    check_path(path)?;
    let target = root.join(path);
    let is_link = std::fs::symlink_metadata(&target).is_ok_and(|meta| meta.is_symlink());
    let folder = target.parent().ok_or_else(|| invalid(path))?;
    let is_inside = folder.canonicalize()?.starts_with(root.canonicalize()?);
    if is_link || !is_inside {
        return Err(invalid(path));
    }
    Ok(target)
}

impl Git {
    /// Reads one stage of a file from the index. Stage 1 is the base, stage 2 is the
    /// current branch, and stage 3 is the other branch.
    fn index_stage(&self, root: &Path, stage: u8, path: &str) -> Result<Option<String>, GitError> {
        let output = self.output(root, ["show", &format!(":{stage}:{path}")])?;
        if !output.is_success {
            return Ok(None);
        }
        to_text(output.stdout, path).map(Some)
    }

    /// Returns the versions of a file that has a conflict.
    ///
    /// # Errors
    ///
    /// Returns an error if the path is not valid, or a version is binary or too large.
    pub fn conflict(&self, root: &Path, path: &str) -> Result<ConflictSides, GitError> {
        check_path(path)?;
        let working = match std::fs::read(root.join(path)) {
            Ok(bytes) => Some(to_text(bytes, path)?),
            Err(error) if error.kind() == ErrorKind::NotFound => None,
            Err(error) => return Err(error.into()),
        };
        Ok(ConflictSides {
            base: self.index_stage(root, 1, path)?,
            ours: self.index_stage(root, 2, path)?,
            theirs: self.index_stage(root, 3, path)?,
            working,
        })
    }

    /// Returns the message that Git prepared for the merge commit. Returns `None` if
    /// no merge is in progress.
    ///
    /// # Errors
    ///
    /// Returns an error if Git fails.
    pub fn merge_message(&self, root: &Path) -> Result<Option<String>, GitError> {
        let head = ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"];
        if !self.output(root, head)?.is_success {
            return Ok(None);
        }
        let location = self.run(root, ["rev-parse", "--git-path", "MERGE_MSG"])?;
        let file = root.join(location.stdout_text().trim_end_matches(['\n', '\r']));
        let text = match std::fs::read_to_string(file) {
            Ok(text) => text,
            Err(error) if error.kind() == ErrorKind::NotFound => String::new(),
            Err(error) => return Err(error.into()),
        };
        let message: Vec<&str> = text.lines().filter(|line| !line.starts_with('#')).collect();
        Ok(Some(message.join("\n").trim().to_owned()))
    }

    /// Resolves the conflict of one file: writes `text` to the file and stages it.
    ///
    /// # Errors
    ///
    /// Returns an error if the path is not valid, the file has no conflict, the file is
    /// not writable, or Git fails.
    pub fn resolve_with_text(&self, root: &Path, path: &str, text: &str) -> Result<(), GitError> {
        let target = writable_target(root, path)?;
        // Only a file with a conflict is a permitted target. Thus this operation cannot
        // write a different file, for example a hook in the `.git` folder.
        let unmerged = self.run(root, ["ls-files", "--unmerged", "--", path])?;
        if unmerged.stdout.is_empty() {
            return Err(invalid(path));
        }
        // Write a temporary file and rename it. A crash cannot leave a partial file.
        let mut temporary = target.clone().into_os_string();
        temporary.push(".tabloxide-tmp");
        std::fs::write(&temporary, text)?;
        if let Err(error) = std::fs::rename(&temporary, &target) {
            // The rename failed. The temporary file is of no more use.
            let _ = std::fs::remove_file(&temporary);
            return Err(error.into());
        }
        self.stage(root, &[path.to_owned()])
    }

    /// Resolves the conflict of one file: deletes the file from the working tree and
    /// from the index.
    ///
    /// # Errors
    ///
    /// Returns an error if the path is not valid or Git fails.
    pub fn resolve_by_delete(&self, root: &Path, path: &str) -> Result<(), GitError> {
        check_path(path)?;
        self.run(root, ["rm", "--quiet", "--", path]).map(|_| ())
    }

    /// Stops the merge and restores the state before the merge.
    ///
    /// # Errors
    ///
    /// Returns an error if no merge is in progress or Git fails.
    pub fn abort_merge(&self, root: &Path) -> Result<(), GitError> {
        self.run(root, ["merge", "--abort"]).map(|_| ())
    }
}

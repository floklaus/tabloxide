//! The commit history and the files of one commit.

use crate::error::GitError;
use crate::operations::{FileDiff, check_path, invalid};
use crate::runner::Git;
use crate::status::{ChangeKind, change_kind};
use serde::Serialize;
use std::path::Path;

/// Separators that cannot be in a commit subject or an author name.
const FIELD_END: char = '\x1f';
const RECORD_END: char = '\x1e';
const LOG_FORMAT: &str = "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CommitInfo {
    /// The full object name of the commit.
    pub id: String,
    pub short_id: String,
    pub author: String,
    /// The author date in the ISO 8601 format.
    pub date: String,
    /// The first line of the commit message.
    pub subject: String,
}

/// One file that a commit changed. The paths are relative to the repository root.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CommitFile {
    pub path: String,
    /// The path before a rename or a copy.
    pub original_path: Option<String>,
    pub kind: ChangeKind,
}

fn parse_log(output: &str) -> Vec<CommitInfo> {
    output
        .split(RECORD_END)
        .filter_map(|record| {
            let mut fields = record.trim_start_matches('\n').split(FIELD_END);
            Some(CommitInfo {
                id: fields.next().filter(|id| !id.is_empty())?.to_owned(),
                short_id: fields.next()?.to_owned(),
                author: fields.next()?.to_owned(),
                date: fields.next()?.to_owned(),
                subject: fields.next()?.to_owned(),
            })
        })
        .collect()
}

/// Parses the output of `--name-status -z`. A rename or a copy has two paths.
fn parse_name_status(output: &str) -> Vec<CommitFile> {
    let mut files = Vec::new();
    let mut tokens = output.split('\0').filter(|token| !token.is_empty());
    while let Some(status) = tokens.next() {
        let Some(kind) = status.chars().next().and_then(change_kind) else {
            continue;
        };
        let has_two_paths = matches!(kind, ChangeKind::Renamed | ChangeKind::Copied);
        let original_path = has_two_paths
            .then(|| tokens.next().map(str::to_owned))
            .flatten();
        let Some(path) = tokens.next() else { break };
        files.push(CommitFile {
            path: path.to_owned(),
            original_path,
            kind,
        });
    }
    files
}

/// A commit identifier from the UI must be a hexadecimal object name. Thus it cannot
/// be an option or a different revision expression.
fn check_commit_id(id: &str) -> Result<(), GitError> {
    let is_object_name = (4..=64).contains(&id.len()) && id.chars().all(|c| c.is_ascii_hexdigit());
    if is_object_name {
        Ok(())
    } else {
        Err(invalid(id))
    }
}

impl Git {
    pub(crate) fn has_revision(&self, root: &Path, revision: &str) -> Result<bool, GitError> {
        let commit = format!("{revision}^{{commit}}");
        let output = self.output(root, ["rev-parse", "--verify", "--quiet", &commit])?;
        Ok(output.is_success)
    }

    /// Lists the commits of the current branch from new to old. `skip` is the number
    /// of commits to ignore at the start, for the next page.
    ///
    /// # Errors
    ///
    /// Returns an error if Git fails.
    pub fn log(&self, root: &Path, limit: u32, skip: u32) -> Result<Vec<CommitInfo>, GitError> {
        if !self.has_revision(root, "HEAD")? {
            return Ok(Vec::new());
        }
        let count = format!("--max-count={limit}");
        let skip = format!("--skip={skip}");
        let output = self.run(root, ["log", &count, &skip, LOG_FORMAT])?;
        Ok(parse_log(&output.stdout_text()))
    }

    /// Lists the files that the commit `id` changed. For a merge commit, the list
    /// shows the changes from the first parent.
    ///
    /// # Errors
    ///
    /// Returns an error if `id` is not an object name or Git fails.
    pub fn commit_files(&self, root: &Path, id: &str) -> Result<Vec<CommitFile>, GitError> {
        check_commit_id(id)?;
        let parent = format!("{id}^1");
        let output = if self.has_revision(root, &parent)? {
            let args = ["diff", "--name-status", "-z", "--find-renames", &parent, id];
            self.run(root, args)?
        } else {
            let args = [
                "diff-tree",
                "--root",
                "--no-commit-id",
                "-r",
                "--name-status",
                "-z",
                id,
            ];
            self.run(root, args)?
        };
        Ok(parse_name_status(&output.stdout_text()))
    }

    /// Returns the two sides of the diff of one file in the commit `id`: the file in
    /// the first parent and the file in the commit.
    ///
    /// # Errors
    ///
    /// Returns an error if an argument is not valid, or the file is binary or too large.
    pub fn commit_diff(
        &self,
        root: &Path,
        id: &str,
        path: &str,
        original_path: Option<&str>,
    ) -> Result<FileDiff, GitError> {
        check_commit_id(id)?;
        check_path(path)?;
        let before = original_path.unwrap_or(path);
        check_path(before)?;
        Ok(FileDiff {
            original: self.show(root, &format!("{id}^1"), before)?,
            modified: self.show(root, id, path)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_log_records_with_special_characters_in_the_subject() {
        let output = "aaaa\x1faa\x1fAda L.\x1f2026-11-14T10:00:00+01:00\x1ffix: a | b, \"c\"\x1e\n\
                      bbbb\x1fbb\x1fBo\x1f2026-11-13T09:00:00Z\x1f\x1e\n";

        let commits = parse_log(output);

        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].subject, "fix: a | b, \"c\"");
        assert_eq!(commits[0].author, "Ada L.");
        assert_eq!(commits[1].id, "bbbb");
        assert_eq!(commits[1].subject, "");
    }

    #[test]
    fn parses_name_status_records() {
        let output = "M\0a.sql\0R087\0old name.sql\0new name.sql\0D\0gone.sql\0";

        let files = parse_name_status(output);

        assert_eq!(files.len(), 3);
        assert_eq!(files[1].kind, ChangeKind::Renamed);
        assert_eq!(files[1].path, "new name.sql");
        assert_eq!(files[1].original_path.as_deref(), Some("old name.sql"));
        assert_eq!(files[2].kind, ChangeKind::Deleted);
        assert_eq!(files[2].original_path, None);
    }
}

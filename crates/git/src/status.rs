//! Parser for `git status --porcelain=v2 --branch -z`.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
}

/// The status of one file. The path is relative to the repository root.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct FileStatus {
    pub path: String,
    /// The path before a rename.
    pub original_path: Option<String>,
    /// The change that is in the index (staged).
    pub staged: Option<ChangeKind>,
    /// The change that is only in the working tree.
    pub unstaged: Option<ChangeKind>,
    pub is_untracked: bool,
    /// `true` if a merge left a conflict in the file.
    pub is_conflicted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct StatusReport {
    /// The current branch. `None` if HEAD is detached.
    pub branch: Option<String>,
    /// `true` if the repository has a minimum of one commit.
    pub has_commits: bool,
    pub upstream: Option<String>,
    /// Commits that are not in the upstream branch.
    pub ahead: u32,
    /// Commits of the upstream branch that are not in the current branch.
    pub behind: u32,
    pub files: Vec<FileStatus>,
}

fn change_kind(code: char) -> Option<ChangeKind> {
    match code {
        'A' => Some(ChangeKind::Added),
        'M' => Some(ChangeKind::Modified),
        'D' => Some(ChangeKind::Deleted),
        'R' => Some(ChangeKind::Renamed),
        'C' => Some(ChangeKind::Copied),
        'T' => Some(ChangeKind::TypeChanged),
        _ => None,
    }
}

fn parse_header(report: &mut StatusReport, header: &str) {
    if let Some(oid) = header.strip_prefix("branch.oid ") {
        report.has_commits = oid != "(initial)";
    } else if let Some(head) = header.strip_prefix("branch.head ") {
        report.branch = (head != "(detached)").then(|| head.to_owned());
    } else if let Some(upstream) = header.strip_prefix("branch.upstream ") {
        report.upstream = Some(upstream.to_owned());
    } else if let Some(counts) = header.strip_prefix("branch.ab ") {
        let mut parts = counts.split(' ');
        let number = |part: Option<&str>| {
            part.and_then(|text| text[1..].parse::<u32>().ok())
                .unwrap_or(0)
        };
        report.ahead = number(parts.next());
        report.behind = number(parts.next());
    }
}

/// Parses a changed entry. `fields_before_path` is the number of fields before the path.
fn parse_changed(entry: &str, fields_before_path: usize) -> Option<FileStatus> {
    let mut fields = entry.splitn(fields_before_path + 1, ' ');
    let mut codes = fields.nth(1)?.chars();
    let staged = change_kind(codes.next()?);
    let unstaged = change_kind(codes.next()?);
    let path = fields.last()?.to_owned();
    Some(FileStatus {
        path,
        original_path: None,
        staged,
        unstaged,
        is_untracked: false,
        is_conflicted: false,
    })
}

/// Parses the output of `git status --porcelain=v2 --branch -z`.
#[must_use]
pub(crate) fn parse_status(output: &str) -> StatusReport {
    let mut report = StatusReport::default();
    let mut entries = output.split('\0').filter(|entry| !entry.is_empty());
    while let Some(entry) = entries.next() {
        let (kind, rest) = entry.split_at(1);
        let file = match kind {
            "#" => {
                parse_header(&mut report, rest.trim_start());
                None
            }
            "1" => parse_changed(entry, 8),
            // A rename has the original path in the next entry.
            "2" => parse_changed(entry, 9).map(|file| FileStatus {
                original_path: entries.next().map(str::to_owned),
                ..file
            }),
            "u" => parse_changed(entry, 10).map(|file| FileStatus {
                staged: None,
                unstaged: None,
                is_conflicted: true,
                ..file
            }),
            "?" => Some(FileStatus {
                path: rest.trim_start().to_owned(),
                original_path: None,
                staged: None,
                unstaged: None,
                is_untracked: true,
                is_conflicted: false,
            }),
            _ => None,
        };
        report.files.extend(file);
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;

    const OID: &str = "1234567890123456789012345678901234567890";

    fn status(entries: &[&str]) -> StatusReport {
        parse_status(&entries.join("\0"))
    }

    #[test]
    fn reads_the_branch_and_the_upstream_counts() {
        let report = status(&[
            &format!("# branch.oid {OID}"),
            "# branch.head main",
            "# branch.upstream origin/main",
            "# branch.ab +2 -5",
        ]);

        assert_eq!(report.branch.as_deref(), Some("main"));
        assert!(report.has_commits);
        assert_eq!(report.upstream.as_deref(), Some("origin/main"));
        assert_eq!((report.ahead, report.behind), (2, 5));
    }

    #[test]
    fn reads_a_new_repository_and_a_detached_head() {
        let new = status(&["# branch.oid (initial)", "# branch.head main"]);
        let detached = status(&[&format!("# branch.oid {OID}"), "# branch.head (detached)"]);

        assert!(!new.has_commits);
        assert_eq!(new.upstream, None);
        assert_eq!(detached.branch, None);
    }

    #[test]
    fn reads_changed_files_and_paths_with_spaces() {
        let report = status(&[
            &format!("1 M. N... 100644 100644 100644 {OID} {OID} staged.sql"),
            &format!("1 .M N... 100644 100644 100644 {OID} {OID} my query.sql"),
            &format!("1 AM N... 000000 100644 100644 {OID} {OID} both.sql"),
            &format!("1 .D N... 100644 100644 000000 {OID} {OID} gone.sql"),
        ]);

        let summary: Vec<_> = report
            .files
            .iter()
            .map(|f| (f.path.as_str(), f.staged, f.unstaged))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("staged.sql", Some(ChangeKind::Modified), None),
                ("my query.sql", None, Some(ChangeKind::Modified)),
                (
                    "both.sql",
                    Some(ChangeKind::Added),
                    Some(ChangeKind::Modified)
                ),
                ("gone.sql", None, Some(ChangeKind::Deleted)),
            ]
        );
    }

    #[test]
    fn reads_a_rename_with_its_original_path() {
        let report = status(&[
            &format!("2 R. N... 100644 100644 100644 {OID} {OID} R100 new name.sql"),
            "old name.sql",
            "? after.sql",
        ]);

        assert_eq!(report.files[0].path, "new name.sql");
        assert_eq!(
            report.files[0].original_path.as_deref(),
            Some("old name.sql")
        );
        assert_eq!(report.files[0].staged, Some(ChangeKind::Renamed));
        assert_eq!(report.files[1].path, "after.sql");
    }

    #[test]
    fn reads_untracked_and_conflicted_files() {
        let report = status(&[
            "? new file.sql",
            &format!("u UU N... 100644 100644 100644 100644 {OID} {OID} {OID} conflict.sql"),
            "! ignored.log",
        ]);

        assert!(report.files[0].is_untracked);
        assert_eq!(report.files[0].path, "new file.sql");
        assert!(report.files[1].is_conflicted);
        assert_eq!(report.files[1].path, "conflict.sql");
        assert_eq!(report.files.len(), 2);
    }
}

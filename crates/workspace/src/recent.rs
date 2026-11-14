//! List of recent workspaces. This is machine-specific state. It is not in the repository.

use crate::error::WorkspaceError;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

pub const MAX_RECENT_WORKSPACES: usize = 10;

const RECENT_FILE_NAME: &str = "recent-workspaces.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct RecentWorkspace {
    pub path: String,
    pub name: String,
}

/// Recent workspaces. The most recent workspace is first.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct RecentWorkspaces {
    #[serde(default)]
    entries: Vec<RecentWorkspace>,
}

fn io_error(path: &Path, source: std::io::Error) -> WorkspaceError {
    WorkspaceError::Io {
        path: path.to_owned(),
        source,
    }
}

fn display_name(path: &Path) -> String {
    path.file_name().map_or_else(
        || path.display().to_string(),
        |name| name.to_string_lossy().into_owned(),
    )
}

impl RecentWorkspaces {
    /// Reads the list from `state_dir`. A missing or damaged file gives an empty list,
    /// because this list is only a convenience.
    #[must_use]
    pub fn load(state_dir: &Path) -> Self {
        std::fs::read_to_string(state_dir.join(RECENT_FILE_NAME))
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    /// Writes the list to `state_dir`. Creates the directory if it does not exist.
    ///
    /// # Errors
    ///
    /// Returns an error if the directory or the file is not writable.
    pub fn save(&self, state_dir: &Path) -> Result<(), WorkspaceError> {
        let path: PathBuf = state_dir.join(RECENT_FILE_NAME);
        std::fs::create_dir_all(state_dir).map_err(|e| io_error(&path, e))?;
        let text = serde_json::to_string_pretty(self).map_err(|e| io_error(&path, e.into()))?;
        let mut file =
            tempfile::NamedTempFile::new_in(state_dir).map_err(|e| io_error(&path, e))?;
        file.write_all(text.as_bytes())
            .map_err(|e| io_error(&path, e))?;
        file.persist(&path).map_err(|e| io_error(&path, e.error))?;
        Ok(())
    }

    #[must_use]
    pub fn entries(&self) -> &[RecentWorkspace] {
        &self.entries
    }

    /// Returns a list that has `path` first. The list has no duplicates and a maximum length.
    #[must_use]
    pub fn with_opened(&self, path: &Path) -> Self {
        let opened = RecentWorkspace {
            path: path.display().to_string(),
            name: display_name(path),
        };
        let others = self
            .entries
            .iter()
            .filter(|entry| entry.path != opened.path)
            .cloned();
        Self {
            entries: std::iter::once(opened.clone())
                .chain(others)
                .take(MAX_RECENT_WORKSPACES)
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(recent: &RecentWorkspaces) -> Vec<&str> {
        recent.entries().iter().map(|e| e.path.as_str()).collect()
    }

    #[test]
    fn with_opened_puts_the_workspace_first_without_duplicates() {
        let recent = RecentWorkspaces::default()
            .with_opened(Path::new("/work/a"))
            .with_opened(Path::new("/work/b"))
            .with_opened(Path::new("/work/a"));

        assert_eq!(paths(&recent), ["/work/a", "/work/b"]);
        assert_eq!(recent.entries()[0].name, "a");
    }

    #[test]
    fn with_opened_keeps_the_maximum_number_of_entries() {
        let recent = (0..MAX_RECENT_WORKSPACES + 3).fold(RecentWorkspaces::default(), |acc, i| {
            acc.with_opened(Path::new(&format!("/work/{i}")))
        });

        assert_eq!(recent.entries().len(), MAX_RECENT_WORKSPACES);
        assert_eq!(recent.entries()[0].path, "/work/12");
    }

    #[test]
    fn save_then_load_returns_the_same_list() {
        let dir = tempfile::tempdir().unwrap();
        let state_dir = dir.path().join("nested").join("state");
        let recent = RecentWorkspaces::default().with_opened(Path::new("/work/a"));

        recent.save(&state_dir).unwrap();

        assert_eq!(RecentWorkspaces::load(&state_dir), recent);
    }

    #[test]
    fn load_returns_an_empty_list_for_a_missing_or_damaged_file() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            RecentWorkspaces::load(dir.path()),
            RecentWorkspaces::default()
        );

        std::fs::write(dir.path().join(RECENT_FILE_NAME), "{not json").unwrap();
        assert_eq!(
            RecentWorkspaces::load(dir.path()),
            RecentWorkspaces::default()
        );
    }
}

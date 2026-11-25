//! List of recent workspaces. This is machine-specific state. It is not in the repository.

use crate::config::WorkspaceConfig;
use crate::error::WorkspaceError;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use tabloxide_core::Engine;

pub const MAX_RECENT_WORKSPACES: usize = 10;

const RECENT_FILE_NAME: &str = "recent-workspaces.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct RecentWorkspace {
    pub path: String,
    pub name: String,
    /// The time of the last open, in seconds since 1970. An entry of an earlier
    /// version has no time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = Option<f64>))]
    pub opened_at: Option<i64>,
}

/// A recent workspace with the data that the start screen shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct RecentWorkspaceInfo {
    pub path: String,
    pub name: String,
    #[cfg_attr(feature = "specta", specta(type = Option<f64>))]
    pub opened_at: Option<i64>,
    /// The engines of the connections of the workspace, each one time.
    pub engines: Vec<Engine>,
    /// `false` if the folder does not exist any more.
    pub exists: bool,
}

impl RecentWorkspaceInfo {
    /// Reads the engines from the `tabloxide.toml` of the workspace. A folder that
    /// does not exist, or a file that is not valid, gives no engines.
    #[must_use]
    pub fn read(entry: &RecentWorkspace) -> Self {
        let root = Path::new(&entry.path);
        let mut engines: Vec<Engine> = Vec::new();
        if let Ok(config) = WorkspaceConfig::load(root) {
            for profile in config.connections() {
                if !engines.contains(&profile.engine) {
                    engines.push(profile.engine);
                }
            }
        }
        Self {
            path: entry.path.clone(),
            name: entry.name.clone(),
            opened_at: entry.opened_at,
            engines,
            exists: root.is_dir(),
        }
    }
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

    /// Returns a list that has `path` first, opened at `opened_at` (seconds since 1970).
    /// The list has no duplicates and a maximum length.
    #[must_use]
    pub fn with_opened(&self, path: &Path, opened_at: i64) -> Self {
        let opened = RecentWorkspace {
            path: path.display().to_string(),
            name: display_name(path),
            opened_at: Some(opened_at),
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

    /// Returns a list without the entry for `path`. The order of the other entries
    /// does not change. An unknown path gives the same list.
    #[must_use]
    pub fn without(&self, path: &str) -> Self {
        Self {
            entries: self
                .entries
                .iter()
                .filter(|entry| entry.path != path)
                .cloned()
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
            .with_opened(Path::new("/work/a"), 1)
            .with_opened(Path::new("/work/b"), 2)
            .with_opened(Path::new("/work/a"), 3);

        assert_eq!(paths(&recent), ["/work/a", "/work/b"]);
        assert_eq!(recent.entries()[0].name, "a");
        assert_eq!(recent.entries()[0].opened_at, Some(3));
        assert_eq!(recent.entries()[1].opened_at, Some(2));
    }

    #[test]
    fn with_opened_keeps_the_maximum_number_of_entries() {
        let recent = (0..MAX_RECENT_WORKSPACES + 3).fold(RecentWorkspaces::default(), |acc, i| {
            acc.with_opened(Path::new(&format!("/work/{i}")), 0)
        });

        assert_eq!(recent.entries().len(), MAX_RECENT_WORKSPACES);
        assert_eq!(recent.entries()[0].path, "/work/12");
    }

    #[test]
    fn without_removes_only_the_entry_and_keeps_the_order() {
        let recent = RecentWorkspaces::default()
            .with_opened(Path::new("/work/a"), 1)
            .with_opened(Path::new("/work/b"), 2)
            .with_opened(Path::new("/work/c"), 3);

        let removed = recent.without("/work/b");

        assert_eq!(paths(&removed), ["/work/c", "/work/a"]);
        assert_eq!(paths(&recent), ["/work/c", "/work/b", "/work/a"]);
        assert_eq!(removed.without("/work/unknown"), removed);
    }

    #[test]
    fn save_then_load_returns_the_same_list() {
        let dir = tempfile::tempdir().unwrap();
        let state_dir = dir.path().join("nested").join("state");
        let recent = RecentWorkspaces::default().with_opened(Path::new("/work/a"), 7);

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

    #[test]
    fn reads_an_entry_of_an_earlier_version_without_a_time() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join(RECENT_FILE_NAME),
            r#"{"entries":[{"path":"/work/a","name":"a"}]}"#,
        )
        .unwrap();

        let recent = RecentWorkspaces::load(dir.path());

        assert_eq!(recent.entries()[0].opened_at, None);
    }

    #[test]
    fn the_info_has_each_engine_one_time_and_tells_if_the_folder_exists() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("tabloxide.toml"),
            r#"
[[connections]]
id = "1"
name = "a"
database = "x"
user = "u"

[[connections]]
id = "2"
name = "b"
engine = "duckdb"
database = "data.duckdb"

[[connections]]
id = "3"
name = "c"
database = "y"
user = "u"
"#,
        )
        .unwrap();
        let entry = RecentWorkspace {
            path: dir.path().display().to_string(),
            name: "w".to_owned(),
            opened_at: Some(5),
        };
        let gone = RecentWorkspace {
            path: dir.path().join("deleted").display().to_string(),
            name: "gone".to_owned(),
            opened_at: None,
        };

        let info = RecentWorkspaceInfo::read(&entry);
        let missing = RecentWorkspaceInfo::read(&gone);

        assert_eq!(info.engines, vec![Engine::Postgres, Engine::Duckdb]);
        assert!(info.exists);
        assert_eq!(info.opened_at, Some(5));
        assert!(missing.engines.is_empty());
        assert!(!missing.exists);
    }
}

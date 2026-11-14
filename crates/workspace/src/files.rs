//! Access to the files in the workspace folder.
//!
//! Each function gets a path relative to the workspace root, with `/` as the separator.
//! A path that goes out of the workspace folder is an error.

use crate::error::WorkspaceError;
use serde::Serialize;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

/// Largest file that the editor opens.
pub const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;

const BYTES_PER_MB: u64 = 1024 * 1024;

/// Directories that the file tree does not show.
const HIDDEN_DIRECTORIES: [&str; 1] = [".git"];

/// One entry of a directory in the workspace.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct FileEntry {
    pub name: String,
    /// Path relative to the workspace root, with `/` as the separator.
    pub path: String,
    pub is_directory: bool,
}

fn io_error(path: &Path, source: std::io::Error) -> WorkspaceError {
    WorkspaceError::Io {
        path: path.to_owned(),
        source,
    }
}

fn outside(relative: &str) -> WorkspaceError {
    WorkspaceError::OutsideWorkspace(relative.to_owned())
}

/// Returns the canonical form of the nearest ancestor of `path` that exists,
/// joined with the remaining components.
fn canonicalize_existing_part(path: &Path) -> std::io::Result<PathBuf> {
    let mut missing: Vec<&std::ffi::OsStr> = Vec::new();
    let mut current = path;
    loop {
        match current.canonicalize() {
            Ok(base) => return Ok(missing.iter().rev().fold(base, |acc, part| acc.join(part))),
            Err(error) => match (current.parent(), current.file_name()) {
                (Some(parent), Some(name)) => {
                    missing.push(name);
                    current = parent;
                }
                _ => return Err(error),
            },
        }
    }
}

/// Converts a relative path to an absolute path in the workspace.
///
/// # Errors
///
/// Returns an error if the path is absolute, contains `..`, or goes out of the
/// workspace through a symbolic link.
pub fn resolve(root: &Path, relative: &str) -> Result<PathBuf, WorkspaceError> {
    let relative_path = Path::new(relative);
    let is_plain = relative_path
        .components()
        .all(|part| matches!(part, Component::Normal(_)));
    if !is_plain || relative.is_empty() {
        return Err(outside(relative));
    }
    let root = root.canonicalize().map_err(|e| io_error(root, e))?;
    let path = root.join(relative_path);
    let real = canonicalize_existing_part(&path).map_err(|e| io_error(&path, e))?;
    if real.starts_with(&root) {
        Ok(path)
    } else {
        Err(outside(relative))
    }
}

/// Converts an absolute path (for example from a file dialog) to a relative path
/// in the workspace.
///
/// # Errors
///
/// Returns an error if the path is not in the workspace folder.
pub fn to_relative(root: &Path, absolute: &Path) -> Result<String, WorkspaceError> {
    let outside = || outside(&absolute.display().to_string());
    let root = root.canonicalize().map_err(|e| io_error(root, e))?;
    let real = canonicalize_existing_part(absolute).map_err(|e| io_error(absolute, e))?;
    let relative = real.strip_prefix(&root).map_err(|_| outside())?;
    let parts: Vec<String> = relative
        .components()
        .map(|part| part.as_os_str().to_string_lossy().into_owned())
        .collect();
    if parts.is_empty() {
        return Err(outside());
    }
    Ok(parts.join("/"))
}

fn join_relative(directory: &str, name: &str) -> String {
    if directory.is_empty() {
        name.to_owned()
    } else {
        format!("{directory}/{name}")
    }
}

/// Lists one directory. `directory` is empty for the workspace root.
/// Directories are first. Each group is in alphabetical sequence.
///
/// # Errors
///
/// Returns an error if the directory is not readable or is not in the workspace.
pub fn list_directory(root: &Path, directory: &str) -> Result<Vec<FileEntry>, WorkspaceError> {
    let path = if directory.is_empty() {
        root.to_owned()
    } else {
        resolve(root, directory)?
    };
    let mut entries: Vec<FileEntry> = Vec::new();
    for entry in std::fs::read_dir(&path).map_err(|e| io_error(&path, e))? {
        let entry = entry.map_err(|e| io_error(&path, e))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        // `metadata` follows a symbolic link. A broken link shows as a file.
        let is_directory = std::fs::metadata(entry.path()).is_ok_and(|m| m.is_dir());
        if is_directory && HIDDEN_DIRECTORIES.contains(&name.as_str()) {
            continue;
        }
        entries.push(FileEntry {
            path: join_relative(directory, &name),
            name,
            is_directory,
        });
    }
    entries.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

/// Reads a text file.
///
/// # Errors
///
/// Returns an error if the file is not readable, is too large, or is not UTF-8 text.
pub fn read_text(root: &Path, relative: &str) -> Result<String, WorkspaceError> {
    let path = resolve(root, relative)?;
    let size = std::fs::metadata(&path)
        .map_err(|e| io_error(&path, e))?
        .len();
    if size > MAX_FILE_BYTES {
        return Err(WorkspaceError::FileTooLarge {
            path,
            limit_mb: MAX_FILE_BYTES / BYTES_PER_MB,
        });
    }
    let bytes = std::fs::read(&path).map_err(|e| io_error(&path, e))?;
    String::from_utf8(bytes).map_err(|_| WorkspaceError::NotText { path })
}

/// Writes a text file. The function writes a temporary file and then renames it.
/// Thus a crash cannot leave a file that is only partly written.
///
/// # Errors
///
/// Returns an error if the path is not in the workspace or the file is not writable.
pub fn write_text(root: &Path, relative: &str, content: &str) -> Result<(), WorkspaceError> {
    let path = resolve(root, relative)?;
    let directory = path.parent().unwrap_or(root);
    std::fs::create_dir_all(directory).map_err(|e| io_error(directory, e))?;
    let mut file = tempfile::NamedTempFile::new_in(directory).map_err(|e| io_error(&path, e))?;
    file.write_all(content.as_bytes())
        .map_err(|e| io_error(&path, e))?;
    // A new temporary file is private. Keep the permissions of the file that it replaces.
    if let Ok(metadata) = std::fs::metadata(&path) {
        let _ = file.as_file().set_permissions(metadata.permissions());
    }
    file.persist(&path).map_err(|e| io_error(&path, e.error))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("queries/reports")).unwrap();
        std::fs::create_dir_all(dir.path().join(".git")).unwrap();
        std::fs::write(dir.path().join("queries/b.sql"), "select 2").unwrap();
        std::fs::write(dir.path().join("queries/A.sql"), "select 1").unwrap();
        std::fs::write(dir.path().join("readme.md"), "text").unwrap();
        dir
    }

    fn names(entries: &[FileEntry]) -> Vec<&str> {
        entries.iter().map(|e| e.path.as_str()).collect()
    }

    #[test]
    fn lists_the_root_with_directories_first_and_without_git() {
        let dir = workspace();

        let entries = list_directory(dir.path(), "").unwrap();

        assert_eq!(names(&entries), vec!["queries", "readme.md"]);
        assert!(entries[0].is_directory);
    }

    #[test]
    fn lists_a_subdirectory_in_alphabetical_sequence() {
        let dir = workspace();

        let entries = list_directory(dir.path(), "queries").unwrap();

        assert_eq!(
            names(&entries),
            vec!["queries/reports", "queries/A.sql", "queries/b.sql"]
        );
    }

    #[test]
    fn reads_and_writes_a_file() {
        let dir = workspace();

        write_text(dir.path(), "queries/new/c.sql", "select 'ü'").unwrap();

        assert_eq!(
            read_text(dir.path(), "queries/new/c.sql").unwrap(),
            "select 'ü'"
        );
    }

    #[test]
    fn a_write_replaces_the_file_and_leaves_no_temporary_file() {
        let dir = workspace();

        write_text(dir.path(), "queries/b.sql", "select 3").unwrap();

        assert_eq!(read_text(dir.path(), "queries/b.sql").unwrap(), "select 3");
        assert_eq!(list_directory(dir.path(), "queries").unwrap().len(), 3);
    }

    #[test]
    fn rejects_paths_that_go_out_of_the_workspace() {
        let dir = workspace();

        for path in ["../x.sql", "queries/../../x.sql", "/etc/passwd", ""] {
            let result = write_text(dir.path(), path, "x");
            assert!(
                matches!(result, Err(WorkspaceError::OutsideWorkspace(_))),
                "{path}: {result:?}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symbolic_link_that_goes_out_of_the_workspace() {
        let dir = workspace();
        let other = tempfile::tempdir().unwrap();
        std::fs::write(other.path().join("secret.txt"), "secret").unwrap();
        std::os::unix::fs::symlink(other.path(), dir.path().join("link")).unwrap();

        let read = read_text(dir.path(), "link/secret.txt");
        let write = write_text(dir.path(), "link/new.txt", "x");

        assert!(matches!(read, Err(WorkspaceError::OutsideWorkspace(_))));
        assert!(matches!(write, Err(WorkspaceError::OutsideWorkspace(_))));
        assert!(!other.path().join("new.txt").exists());
    }

    #[test]
    fn rejects_a_file_that_is_not_text() {
        let dir = workspace();
        std::fs::write(dir.path().join("image.bin"), [0xff, 0xfe, 0x00]).unwrap();

        let result = read_text(dir.path(), "image.bin");

        assert!(matches!(result, Err(WorkspaceError::NotText { .. })));
    }

    #[test]
    fn converts_an_absolute_path_to_a_relative_path() {
        let dir = workspace();
        let inside = dir.path().join("queries").join("new.sql");
        let other = tempfile::tempdir().unwrap();

        assert_eq!(to_relative(dir.path(), &inside).unwrap(), "queries/new.sql");
        assert!(matches!(
            to_relative(dir.path(), &other.path().join("x.sql")),
            Err(WorkspaceError::OutsideWorkspace(_))
        ));
        assert!(matches!(
            to_relative(dir.path(), dir.path()),
            Err(WorkspaceError::OutsideWorkspace(_))
        ));
    }
}

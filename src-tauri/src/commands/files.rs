use crate::error::CommandError;
use crate::state::{AppState, blocking};
use std::path::PathBuf;
use tabloxide_workspace::{FileEntry, files};
use tauri::State;

/// Lists one directory of the workspace. `directory` is empty for the workspace root.
#[tauri::command]
#[specta::specta]
pub async fn file_list(
    state: State<'_, AppState>,
    directory: String,
) -> Result<Vec<FileEntry>, CommandError> {
    let workspace = state.workspace()?;
    blocking(move || Ok(files::list_directory(workspace.root(), &directory)?)).await
}

/// Reads a text file of the workspace. `path` is relative to the workspace root.
#[tauri::command]
#[specta::specta]
pub async fn file_read(state: State<'_, AppState>, path: String) -> Result<String, CommandError> {
    let workspace = state.workspace()?;
    blocking(move || Ok(files::read_text(workspace.root(), &path)?)).await
}

/// Writes a text file of the workspace. `path` is relative to the workspace root.
#[tauri::command]
#[specta::specta]
pub async fn file_write(
    state: State<'_, AppState>,
    path: String,
    content: String,
) -> Result<(), CommandError> {
    let workspace = state.workspace()?;
    blocking(move || Ok(files::write_text(workspace.root(), &path, &content)?)).await
}

/// Converts an absolute path from a file dialog to a path relative to the workspace root.
/// A path that is not in the workspace folder is an error.
#[tauri::command]
#[specta::specta]
pub async fn file_relative_path(
    state: State<'_, AppState>,
    absolute: String,
) -> Result<String, CommandError> {
    let workspace = state.workspace()?;
    blocking(move || {
        Ok(files::to_relative(
            workspace.root(),
            &PathBuf::from(absolute),
        )?)
    })
    .await
}

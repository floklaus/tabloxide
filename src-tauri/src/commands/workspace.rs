use crate::error::CommandError;
use crate::state::{AppState, blocking};
use serde::Serialize;
use specta::Type;
use std::path::PathBuf;
use tabloxide_core::ConnectionProfile;
use tabloxide_workspace::{RecentWorkspace, RecentWorkspaces, Workspace};
use tauri::{AppHandle, Manager, State};

/// The open workspace as the UI sees it.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub path: String,
    pub name: String,
    pub connections: Vec<ConnectionProfile>,
}

impl From<&Workspace> for WorkspaceSnapshot {
    fn from(workspace: &Workspace) -> Self {
        Self {
            path: workspace.root().display().to_string(),
            name: workspace.name(),
            connections: workspace.connections().to_vec(),
        }
    }
}

fn state_dir(app: &AppHandle) -> Result<PathBuf, CommandError> {
    app.path().app_data_dir().map_err(|error| {
        CommandError::internal(format!(
            "Cannot find the application data directory: {error}"
        ))
    })
}

/// Closes all database sessions in the background. The sessions belong to the workspace.
fn close_sessions(state: &AppState) {
    let sessions = state.take_sessions();
    tauri::async_runtime::spawn(async move {
        for session in sessions {
            session.close().await;
        }
    });
}

/// Opens the folder `path` as the workspace and adds it to the recent list.
#[tauri::command]
#[specta::specta]
pub async fn workspace_open(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<WorkspaceSnapshot, CommandError> {
    let state_dir = state_dir(&app)?;
    let workspace = blocking(move || {
        let workspace = Workspace::open(&PathBuf::from(path))?;
        RecentWorkspaces::load(&state_dir)
            .with_opened(workspace.root())
            .save(&state_dir)?;
        Ok(workspace)
    })
    .await?;
    let snapshot = WorkspaceSnapshot::from(&workspace);
    state.set_workspace(Some(workspace));
    close_sessions(&state);
    Ok(snapshot)
}

/// Returns the open workspace, or `null` if no workspace is open.
#[tauri::command]
#[specta::specta]
pub fn workspace_current(state: State<'_, AppState>) -> Option<WorkspaceSnapshot> {
    state.workspace().ok().as_ref().map(WorkspaceSnapshot::from)
}

/// Closes the workspace.
#[tauri::command]
#[specta::specta]
pub fn workspace_close(state: State<'_, AppState>) {
    state.set_workspace(None);
    close_sessions(&state);
}

/// Returns the recent workspaces. The most recent workspace is first.
#[tauri::command]
#[specta::specta]
pub async fn workspace_recent(app: AppHandle) -> Result<Vec<RecentWorkspace>, CommandError> {
    let state_dir = state_dir(&app)?;
    blocking(move || Ok(RecentWorkspaces::load(&state_dir).entries().to_vec())).await
}

use crate::commands::local::now_secs;
use crate::error::CommandError;
use crate::state::{AppState, blocking};
use serde::Serialize;
use specta::Type;
use std::path::PathBuf;
use tabloxide_core::ConnectionProfile;
use tabloxide_workspace::{RecentWorkspaceInfo, RecentWorkspaces, Workspace, WorkspaceWatcher};
use tauri::ipc::Channel;
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

pub fn state_dir(app: &AppHandle) -> Result<PathBuf, CommandError> {
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
            .with_opened(workspace.root(), now_secs())
            .save(&state_dir)?;
        Ok(workspace)
    })
    .await?;
    let snapshot = WorkspaceSnapshot::from(&workspace);
    // The watcher of the last workspace must not report changes for this workspace.
    state.set_watcher(None);
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
    state.set_watcher(None);
    state.set_workspace(None);
    close_sessions(&state);
}

/// Starts to watch the workspace folder. Sends a message on `on_change` after a
/// different program changed files. One message covers all changes of a short time.
/// The watch stops when the workspace closes.
#[tauri::command]
#[specta::specta]
pub async fn workspace_watch(
    state: State<'_, AppState>,
    on_change: Channel<()>,
) -> Result<(), CommandError> {
    let workspace = state.workspace()?;
    let root = workspace.root().to_owned();
    let watcher = blocking(move || {
        WorkspaceWatcher::start(workspace.root(), move || {
            // The UI is gone when the send fails. Then no one needs the message.
            let _ = on_change.send(());
        })
        .map_err(|error| {
            CommandError::internal(format!(
                "The application cannot watch the workspace folder for changes: {error}"
            ))
        })
    })
    .await?;
    // A different workspace can be open now. Then this watcher is not applicable.
    if state
        .workspace()
        .is_ok_and(|current| current.root() == root)
    {
        state.set_watcher(Some(watcher));
    }
    Ok(())
}

fn recent_info(recent: &RecentWorkspaces) -> Vec<RecentWorkspaceInfo> {
    recent
        .entries()
        .iter()
        .map(RecentWorkspaceInfo::read)
        .collect()
}

/// Returns the recent workspaces. The most recent workspace is first.
#[tauri::command]
#[specta::specta]
pub async fn workspace_recent(app: AppHandle) -> Result<Vec<RecentWorkspaceInfo>, CommandError> {
    let state_dir = state_dir(&app)?;
    blocking(move || Ok(recent_info(&RecentWorkspaces::load(&state_dir)))).await
}

/// Removes the workspace `path` from the recent list and returns the new list.
/// The folder does not change.
#[tauri::command]
#[specta::specta]
pub async fn workspace_recent_remove(
    app: AppHandle,
    path: String,
) -> Result<Vec<RecentWorkspaceInfo>, CommandError> {
    let state_dir = state_dir(&app)?;
    blocking(move || {
        let recent = RecentWorkspaces::load(&state_dir).without(&path);
        recent.save(&state_dir)?;
        Ok(recent_info(&recent))
    })
    .await
}

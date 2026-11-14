use crate::commands::workspace::state_dir;
use crate::error::CommandError;
use crate::state::{AppState, blocking};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tabloxide_workspace::{
    HistoryEntry, LocalState, MAX_HISTORY_RESULTS, Preferences, UiState, Workspace,
};
use tauri::{AppHandle, State};

/// The key of a workspace in the local state database.
pub fn workspace_key(workspace: &Workspace) -> String {
    workspace.root().display().to_string()
}

/// The time now, in seconds since 1970-01-01 UTC.
pub fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_secs()).ok())
        .unwrap_or(0)
}

fn local(app: &AppHandle, state: &AppState) -> Result<Arc<LocalState>, CommandError> {
    state.local(&state_dir(app)?)
}

/// Returns the history entries of the workspace that contain `query`. The newest is first.
#[tauri::command]
#[specta::specta]
pub async fn history_search(
    app: AppHandle,
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<HistoryEntry>, CommandError> {
    let workspace = workspace_key(&state.workspace()?);
    let local = local(&app, &state)?;
    blocking(move || Ok(local.search_history(&workspace, &query, MAX_HISTORY_RESULTS)?)).await
}

/// Deletes the query history of the workspace.
#[tauri::command]
#[specta::specta]
pub async fn history_clear(app: AppHandle, state: State<'_, AppState>) -> Result<(), CommandError> {
    let workspace = workspace_key(&state.workspace()?);
    let local = local(&app, &state)?;
    blocking(move || Ok(local.clear_history(&workspace)?)).await
}

/// Returns the preferences. This also deletes the history entries that are older than
/// the retention time.
#[tauri::command]
#[specta::specta]
pub async fn preferences_load(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Preferences, CommandError> {
    let local = local(&app, &state)?;
    blocking(move || {
        let preferences = local.load_preferences()?;
        local.prune_history(preferences.history_retention_days, now_secs())?;
        Ok(preferences)
    })
    .await
}

/// Stores the preferences. Returns the stored values, each in its permitted range.
#[tauri::command]
#[specta::specta]
pub async fn preferences_save(
    app: AppHandle,
    state: State<'_, AppState>,
    preferences: Preferences,
) -> Result<Preferences, CommandError> {
    let local = local(&app, &state)?;
    blocking(move || {
        let stored = local.save_preferences(preferences)?;
        local.prune_history(stored.history_retention_days, now_secs())?;
        Ok(stored)
    })
    .await
}

/// Returns the open tabs of the workspace from the last session.
#[tauri::command]
#[specta::specta]
pub async fn ui_state_load(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<UiState, CommandError> {
    let workspace = workspace_key(&state.workspace()?);
    let local = local(&app, &state)?;
    blocking(move || Ok(local.load_ui_state(&workspace)?)).await
}

/// Stores the open tabs of the workspace.
#[tauri::command]
#[specta::specta]
pub async fn ui_state_save(
    app: AppHandle,
    state: State<'_, AppState>,
    ui_state: UiState,
) -> Result<(), CommandError> {
    let workspace = workspace_key(&state.workspace()?);
    let local = local(&app, &state)?;
    blocking(move || Ok(local.save_ui_state(&workspace, &ui_state)?)).await
}

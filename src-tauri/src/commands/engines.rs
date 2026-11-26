//! The database engines and their connectors.

use crate::error::CommandError;
use crate::state::AppState;
use tabloxide_connector_host::EngineEntry;
use tabloxide_core::Engine;
use tauri::State;

/// Returns the engines that the application can use now: the built-in engines and the
/// installed connectors.
#[tauri::command]
#[specta::specta]
pub async fn engine_list(state: State<'_, AppState>) -> Result<Vec<EngineEntry>, CommandError> {
    let engines = state.engines();
    crate::state::blocking(move || Ok(engines.list())).await
}

/// Removes the installed connector of an engine. Sessions that are open keep their
/// connector process until they close.
#[tauri::command]
#[specta::specta]
pub async fn connector_remove(
    state: State<'_, AppState>,
    engine: Engine,
) -> Result<(), CommandError> {
    state.engines().remove(&engine).await.map_err(|error| {
        CommandError::internal(format!("The connector cannot be removed: {error}"))
    })
}

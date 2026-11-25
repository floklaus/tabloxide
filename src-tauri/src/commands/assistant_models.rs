//! The command that gives the models of the AI service. The cache rules are in
//! `tabloxide_assistant::load_models`.

use crate::commands::assistant::KEY_ENTRY;
use crate::commands::workspace::state_dir;
use crate::error::CommandError;
use crate::state::{AppState, blocking};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tabloxide_assistant::{ModelList, ModelsResult, load_models};
use tauri::{AppHandle, State};

/// The cache entry for the model list of the Anthropic API key.
const MODEL_CACHE_KEY: &str = "assistant-models:anthropic";

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |time| i64::try_from(time.as_secs()).unwrap_or(i64::MAX))
}

/// Returns the models that the stored API key can use.
///
/// The application keeps the last list for one day. `refresh` gets the list from
/// the service before that time. If the service does not give the list, the result
/// has the error and the last stored list.
#[tauri::command]
#[specta::specta]
pub async fn assistant_models(
    app: AppHandle,
    state: State<'_, AppState>,
    refresh: bool,
) -> Result<ModelsResult, CommandError> {
    let secrets = state.secrets();
    let api_key = blocking(move || Ok(secrets.get_entry(KEY_ENTRY)?)).await?;
    let local = state.local(&state_dir(&app)?)?;
    let reader = Arc::clone(&local);
    let cached = blocking(move || Ok(reader.load_cache(MODEL_CACHE_KEY)?))
        .await?
        .and_then(|text| ModelList::from_cache_text(&text));
    let lister = state.model_lister();
    let update = load_models(
        lister.as_ref(),
        api_key.as_ref(),
        cached,
        refresh,
        now_secs(),
    )
    .await;
    if let Some(list) = update.store {
        let text = list.to_cache_text();
        blocking(move || Ok(local.save_cache(MODEL_CACHE_KEY, &text)?)).await?;
    }
    Ok(update.result)
}

/// Removes the stored model list. A different API key can have different models.
pub(crate) async fn clear_model_cache(
    app: &AppHandle,
    state: &AppState,
) -> Result<(), CommandError> {
    let local = state.local(&state_dir(app)?)?;
    blocking(move || Ok(local.delete_cache(MODEL_CACHE_KEY)?)).await
}

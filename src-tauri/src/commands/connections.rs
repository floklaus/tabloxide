use crate::commands::workspace::WorkspaceSnapshot;
use crate::error::CommandError;
use crate::state::{AppState, blocking};
use serde::Serialize;
use specta::Type;
use tabloxide_core::{
    ConnectError, ConnectErrorKind, ConnectionId, ConnectionProfile, Secret, ServerInfo,
    validate_profile,
};
use tabloxide_workspace::{Workspace, resolve_secret};
use tauri::State;

/// Result of a connection test. A failed test is a normal result, not a command error.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum ConnectionTestResult {
    Connected { server: ServerInfo },
    Failed { error: ConnectError },
}

fn to_secret(password: Option<String>) -> Option<Secret> {
    password.filter(|value| !value.is_empty()).map(Secret::new)
}

/// Returns the password for a connection. `password` has priority. Without it, the password
/// comes from the source that the profile specifies. A password that is not available is a
/// connection failure for the user, not a command error.
pub async fn resolve_password(
    state: &AppState,
    profile: &ConnectionProfile,
    password: Option<String>,
) -> Result<Result<Option<Secret>, ConnectError>, CommandError> {
    if let Some(secret) = to_secret(password) {
        return Ok(Ok(Some(secret)));
    }
    let secrets = state.secrets();
    let lookup_profile = profile.clone();
    let resolved = tauri::async_runtime::spawn_blocking(move || {
        resolve_secret(&lookup_profile, secrets.as_ref(), &|name| {
            std::env::var(name).ok()
        })
    })
    .await
    .map_err(|e| CommandError::internal(format!("A background task failed: {e}")))?;
    Ok(resolved
        .map_err(|error| ConnectError::new(ConnectErrorKind::MissingSecret, error.to_string())))
}

/// Runs an operation that changes the workspace, then stores the new workspace in the state.
async fn update_workspace<F>(
    state: &AppState,
    operation: F,
) -> Result<WorkspaceSnapshot, CommandError>
where
    F: FnOnce(&Workspace) -> Result<Workspace, CommandError> + Send + 'static,
{
    let current = state.workspace()?;
    let updated = blocking(move || operation(&current)).await?;
    let snapshot = WorkspaceSnapshot::from(&updated);
    state.set_workspace(Some(updated));
    Ok(snapshot)
}

/// Returns an empty connection profile that has a new identifier and the default settings.
#[tauri::command]
#[specta::specta]
pub fn connection_template() -> ConnectionProfile {
    ConnectionProfile::template()
}

/// Adds or replaces a connection. `password` goes to the credential store of the operating
/// system when the password source is the keychain. `null` keeps the stored password.
#[tauri::command]
#[specta::specta]
pub async fn connection_save(
    state: State<'_, AppState>,
    profile: ConnectionProfile,
    password: Option<String>,
) -> Result<WorkspaceSnapshot, CommandError> {
    let secrets = state.secrets();
    let password = to_secret(password);
    update_workspace(&state, move |workspace| {
        Ok(workspace.save_connection(profile, password.as_ref(), secrets.as_ref())?)
    })
    .await
}

/// Removes a connection and its stored password.
#[tauri::command]
#[specta::specta]
pub async fn connection_delete(
    state: State<'_, AppState>,
    id: ConnectionId,
) -> Result<WorkspaceSnapshot, CommandError> {
    let secrets = state.secrets();
    update_workspace(&state, move |workspace| {
        Ok(workspace.delete_connection(&id, secrets.as_ref())?)
    })
    .await
}

/// Adds a copy of a connection, with a copy of its stored password.
#[tauri::command]
#[specta::specta]
pub async fn connection_duplicate(
    state: State<'_, AppState>,
    id: ConnectionId,
) -> Result<WorkspaceSnapshot, CommandError> {
    let secrets = state.secrets();
    update_workspace(&state, move |workspace| {
        Ok(workspace.duplicate_connection(&id, secrets.as_ref())?)
    })
    .await
}

/// Tests a connection. The profile does not have to be saved.
/// If `password` is `null`, the password comes from the source that the profile specifies.
#[tauri::command]
#[specta::specta]
pub async fn connection_test(
    state: State<'_, AppState>,
    profile: ConnectionProfile,
    password: Option<String>,
) -> Result<ConnectionTestResult, CommandError> {
    let issues = validate_profile(&profile);
    if !issues.is_empty() {
        return Err(CommandError::invalid_profile(issues));
    }

    let secret = match resolve_password(&state, &profile, password).await? {
        Ok(secret) => secret,
        Err(error) => return Ok(ConnectionTestResult::Failed { error }),
    };

    let workspace = state.workspace()?;
    let adapter = state.adapter(profile.engine);
    let tested = adapter
        .test_connection(&profile, secret.as_ref(), workspace.root())
        .await;
    Ok(match tested {
        Ok(server) => ConnectionTestResult::Connected { server },
        Err(error) => ConnectionTestResult::Failed { error },
    })
}

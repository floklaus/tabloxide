use crate::commands::connections::resolve_password;
use crate::error::CommandError;
use crate::state::{AppState, SessionId};
use serde::Serialize;
use specta::Type;
use tabloxide_core::{ConnectError, ConnectionId, QuerySession, ServerInfo};
use tauri::State;

/// An open database session.
#[derive(Debug, Clone, Serialize, Type)]
pub struct SessionInfo {
    pub id: SessionId,
    pub connection_id: ConnectionId,
    pub server: ServerInfo,
}

/// Result of a connect request. A failed connect is a normal result, not a command error.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum SessionOpenResult {
    Connected { session: SessionInfo },
    Failed { error: ConnectError },
}

/// Opens a database session for a saved connection. Each query tab has its own session.
#[tauri::command]
#[specta::specta]
pub async fn session_open(
    state: State<'_, AppState>,
    connection_id: ConnectionId,
) -> Result<SessionOpenResult, CommandError> {
    let workspace = state.workspace()?;
    let profile = workspace
        .connections()
        .iter()
        .find(|profile| profile.id == connection_id)
        .cloned()
        .ok_or_else(|| CommandError::internal("The connection is not in the workspace."))?;
    let secret = match resolve_password(&state, &profile, None).await? {
        Ok(secret) => secret,
        Err(error) => return Ok(SessionOpenResult::Failed { error }),
    };
    let adapter = state.adapter();
    let session = match adapter.connect(&profile, secret.as_ref()).await {
        Ok(session) => QuerySession::new(session),
        Err(error) => return Ok(SessionOpenResult::Failed { error }),
    };
    let server = session.server_info().clone();
    let id = state.add_session(session);
    Ok(SessionOpenResult::Connected {
        session: SessionInfo {
            id,
            connection_id,
            server,
        },
    })
}

/// Closes a database session. This cancels its open result.
#[tauri::command]
#[specta::specta]
pub async fn session_close(
    state: State<'_, AppState>,
    session_id: SessionId,
) -> Result<(), CommandError> {
    if let Some(session) = state.remove_session(session_id) {
        session.close().await;
    }
    Ok(())
}

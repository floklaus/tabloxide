//! Application state that the commands share.

use crate::error::CommandError;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use tabloxide_adapter_postgres::PostgresAdapter;
use tabloxide_core::{DbAdapter, QuerySession};
use tabloxide_workspace::{KeyringStore, SecretStore, Workspace};

/// Identifier of an open database session.
pub type SessionId = u32;

pub struct AppState {
    workspace: Mutex<Option<Workspace>>,
    secrets: Arc<dyn SecretStore>,
    adapter: Arc<dyn DbAdapter>,
    sessions: Mutex<HashMap<SessionId, Arc<QuerySession>>>,
    next_session_id: AtomicU32,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            workspace: Mutex::new(None),
            secrets: Arc::new(KeyringStore),
            adapter: Arc::new(PostgresAdapter),
            sessions: Mutex::new(HashMap::new()),
            next_session_id: AtomicU32::new(1),
        }
    }
}

impl AppState {
    fn lock(&self) -> MutexGuard<'_, Option<Workspace>> {
        self.workspace
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    /// Returns a copy of the open workspace.
    pub fn workspace(&self) -> Result<Workspace, CommandError> {
        self.lock().clone().ok_or_else(CommandError::no_workspace)
    }

    pub fn set_workspace(&self, workspace: Option<Workspace>) {
        *self.lock() = workspace;
    }

    pub fn secrets(&self) -> Arc<dyn SecretStore> {
        Arc::clone(&self.secrets)
    }

    pub fn adapter(&self) -> Arc<dyn DbAdapter> {
        Arc::clone(&self.adapter)
    }

    fn lock_sessions(&self) -> MutexGuard<'_, HashMap<SessionId, Arc<QuerySession>>> {
        self.sessions.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn add_session(&self, session: QuerySession) -> SessionId {
        let id = self.next_session_id.fetch_add(1, Ordering::Relaxed);
        self.lock_sessions().insert(id, Arc::new(session));
        id
    }

    pub fn session(&self, id: SessionId) -> Result<Arc<QuerySession>, CommandError> {
        self.lock_sessions()
            .get(&id)
            .cloned()
            .ok_or_else(CommandError::no_session)
    }

    pub fn remove_session(&self, id: SessionId) -> Option<Arc<QuerySession>> {
        self.lock_sessions().remove(&id)
    }

    /// Removes all sessions and returns them, so that the caller can close them.
    pub fn take_sessions(&self) -> Vec<Arc<QuerySession>> {
        self.lock_sessions()
            .drain()
            .map(|(_, session)| session)
            .collect()
    }
}

/// Runs file and credential store operations on a thread that can block.
pub async fn blocking<T, F>(operation: F) -> Result<T, CommandError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, CommandError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| CommandError::internal(format!("A background task failed: {error}")))?
}

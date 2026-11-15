//! Application state that the commands share.

use crate::credentials::CredentialRequests;
use crate::error::CommandError;
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use tabloxide_adapter_postgres::PostgresAdapter;
use tabloxide_core::{ConnectionId, DbAdapter, QuerySession};
use tabloxide_git::AskpassServer;
use tabloxide_workspace::{KeyringStore, LocalState, SecretStore, Workspace, WorkspaceWatcher};

/// Identifier of an open database session.
pub type SessionId = u32;

/// An open database session and the connection that it uses.
#[derive(Clone)]
pub struct SessionEntry {
    pub session: Arc<QuerySession>,
    pub connection_id: ConnectionId,
    pub connection_name: String,
}

pub struct AppState {
    workspace: Mutex<Option<Workspace>>,
    secrets: Arc<dyn SecretStore>,
    adapter: Arc<dyn DbAdapter>,
    sessions: Mutex<HashMap<SessionId, SessionEntry>>,
    next_session_id: AtomicU32,
    local: Mutex<Option<Arc<LocalState>>>,
    /// The watcher of the workspace folder. It stops when the workspace closes.
    watcher: Mutex<Option<WorkspaceWatcher>>,
    /// The server for the credential prompts of Git. The first remote operation starts it.
    askpass: Mutex<Option<Arc<AskpassServer>>>,
    credentials: Arc<CredentialRequests>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            workspace: Mutex::new(None),
            secrets: Arc::new(KeyringStore),
            adapter: Arc::new(PostgresAdapter),
            sessions: Mutex::new(HashMap::new()),
            next_session_id: AtomicU32::new(1),
            local: Mutex::new(None),
            watcher: Mutex::new(None),
            askpass: Mutex::new(None),
            credentials: Arc::default(),
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

    fn lock_sessions(&self) -> MutexGuard<'_, HashMap<SessionId, SessionEntry>> {
        self.sessions.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn add_session(&self, entry: SessionEntry) -> SessionId {
        let id = self.next_session_id.fetch_add(1, Ordering::Relaxed);
        self.lock_sessions().insert(id, entry);
        id
    }

    pub fn session_entry(&self, id: SessionId) -> Result<SessionEntry, CommandError> {
        self.lock_sessions()
            .get(&id)
            .cloned()
            .ok_or_else(CommandError::no_session)
    }

    pub fn session(&self, id: SessionId) -> Result<Arc<QuerySession>, CommandError> {
        self.session_entry(id).map(|entry| entry.session)
    }

    pub fn remove_session(&self, id: SessionId) -> Option<Arc<QuerySession>> {
        self.lock_sessions().remove(&id).map(|entry| entry.session)
    }

    /// Returns the local state database. The first call opens it in `state_dir`.
    pub fn local(&self, state_dir: &Path) -> Result<Arc<LocalState>, CommandError> {
        let mut local = self.local.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(open) = local.as_ref() {
            return Ok(Arc::clone(open));
        }
        let opened = Arc::new(LocalState::open(state_dir)?);
        *local = Some(Arc::clone(&opened));
        Ok(opened)
    }

    /// Replaces the watcher of the workspace folder. `None` stops the watch.
    pub fn set_watcher(&self, watcher: Option<WorkspaceWatcher>) {
        *self.watcher.lock().unwrap_or_else(PoisonError::into_inner) = watcher;
    }

    pub fn credentials(&self) -> Arc<CredentialRequests> {
        Arc::clone(&self.credentials)
    }

    /// Returns the server for the credential prompts of Git. The first call starts it.
    ///
    /// # Errors
    ///
    /// Returns an error if the operating system gives no port.
    pub fn askpass(&self) -> std::io::Result<Arc<AskpassServer>> {
        let mut askpass = self.askpass.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(server) = askpass.as_ref() {
            return Ok(Arc::clone(server));
        }
        let server = Arc::new(AskpassServer::start()?);
        *askpass = Some(Arc::clone(&server));
        Ok(server)
    }

    /// Removes all sessions and returns them, so that the caller can close them.
    pub fn take_sessions(&self) -> Vec<Arc<QuerySession>> {
        self.lock_sessions()
            .drain()
            .map(|(_, entry)| entry.session)
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

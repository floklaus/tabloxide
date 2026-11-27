//! Application state that the commands share.

use crate::credentials::CredentialRequests;
use crate::error::CommandError;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use tabloxide_adapter_duckdb::DuckDbAdapter;
use tabloxide_adapter_postgres::PostgresAdapter;
use tabloxide_assistant::{AnthropicProvider, ChatProvider, ModelLister, SchemaContext};
use tabloxide_connector_host::EngineRegistry;
use tabloxide_core::{ConnectError, ConnectionId, DbAdapter, Engine, EngineInfo, QuerySession};
use tabloxide_git::AskpassServer;
use tabloxide_workspace::{KeyringStore, LocalState, SecretStore, Workspace, WorkspaceWatcher};
use tokio::sync::Notify;

/// Identifier of an open database session.
pub type SessionId = u32;

/// An open database session and the connection that it uses.
#[derive(Clone)]
pub struct SessionEntry {
    pub session: Arc<QuerySession>,
    pub connection_id: ConnectionId,
    pub connection_name: String,
    /// What the engine of the session can do, and its query language.
    pub info: EngineInfo,
}

/// The environment variable that names the folder of the development connectors.
/// Only a development build reads it.
const CONNECTOR_DIR_ENV: &str = "TABLOXIDE_CONNECTOR_DIR";

pub struct AppState {
    workspace: Mutex<Option<Workspace>>,
    secrets: Arc<dyn SecretStore>,
    /// The built-in adapters and the connectors. The DuckDB adapter holds the open
    /// database files. Thus the application has only one registry.
    engines: Arc<EngineRegistry>,
    sessions: Mutex<HashMap<SessionId, SessionEntry>>,
    next_session_id: AtomicU32,
    local: Mutex<Option<Arc<LocalState>>>,
    /// The watcher of the workspace folder. It stops when the workspace closes.
    watcher: Mutex<Option<WorkspaceWatcher>>,
    /// The server for the credential prompts of Git. The first remote operation starts it.
    askpass: Mutex<Option<Arc<AskpassServer>>>,
    credentials: Arc<CredentialRequests>,
    /// The AI service of the assistant.
    assistant: Arc<dyn ChatProvider>,
    /// The same AI service. It gives the list of its models.
    model_lister: Arc<dyn ModelLister>,
    /// The schema that the assistant read for each session.
    assistant_schemas: Mutex<HashMap<SessionId, Arc<SchemaContext>>>,
    /// The requests to the AI service that are in progress. A notification cancels one.
    asks: Mutex<HashMap<u32, Arc<Notify>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self::new(PathBuf::new())
    }
}

impl AppState {
    /// `connectors_dir` is the folder of the installed connectors.
    pub fn new(connectors_dir: PathBuf) -> Self {
        let anthropic = Arc::new(AnthropicProvider::default());
        let development_dir = cfg!(debug_assertions)
            .then(|| std::env::var_os(CONNECTOR_DIR_ENV))
            .flatten()
            .map(PathBuf::from);
        let builtin: Vec<Arc<dyn DbAdapter>> = vec![
            Arc::new(PostgresAdapter),
            Arc::new(DuckDbAdapter::default()),
        ];
        Self {
            workspace: Mutex::new(None),
            secrets: Arc::new(KeyringStore),
            engines: Arc::new(EngineRegistry::new(
                builtin,
                connectors_dir,
                development_dir,
            )),
            sessions: Mutex::new(HashMap::new()),
            next_session_id: AtomicU32::new(1),
            local: Mutex::new(None),
            watcher: Mutex::new(None),
            askpass: Mutex::new(None),
            credentials: Arc::default(),
            assistant: Arc::clone(&anthropic) as Arc<dyn ChatProvider>,
            model_lister: anthropic,
            assistant_schemas: Mutex::new(HashMap::new()),
            asks: Mutex::new(HashMap::new()),
        }
    }

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

    pub fn engines(&self) -> Arc<EngineRegistry> {
        Arc::clone(&self.engines)
    }

    /// Returns the adapter for a database engine. The first call for a connector
    /// starts its process.
    ///
    /// # Errors
    ///
    /// Returns a connection error if no connector is installed for the engine, or if
    /// the connector does not start.
    pub async fn adapter(&self, engine: &Engine) -> Result<Arc<dyn DbAdapter>, ConnectError> {
        self.engines
            .adapter(engine)
            .await
            .map_err(ConnectError::from)
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
        // The session goes first. Then a schema read that ends now does not add an entry.
        let session = self.lock_sessions().remove(&id).map(|entry| entry.session);
        self.lock_schemas().remove(&id);
        session
    }

    pub fn assistant(&self) -> Arc<dyn ChatProvider> {
        Arc::clone(&self.assistant)
    }

    pub fn model_lister(&self) -> Arc<dyn ModelLister> {
        Arc::clone(&self.model_lister)
    }

    fn lock_schemas(&self) -> MutexGuard<'_, HashMap<SessionId, Arc<SchemaContext>>> {
        self.assistant_schemas
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    /// Returns the schema that the assistant read for a session.
    pub fn assistant_schema(&self, id: SessionId) -> Option<Arc<SchemaContext>> {
        self.lock_schemas().get(&id).cloned()
    }

    /// Keeps the schema for the next requests of a session. A session that closed
    /// during the schema read gets no entry, because no code would remove it.
    pub fn set_assistant_schema(&self, id: SessionId, schema: Arc<SchemaContext>) {
        let sessions = self.lock_sessions();
        if sessions.contains_key(&id) {
            self.lock_schemas().insert(id, schema);
        }
    }

    fn lock_asks(&self) -> MutexGuard<'_, HashMap<u32, Arc<Notify>>> {
        self.asks.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Records a request to the AI service. A notification on the result cancels it.
    pub fn start_ask(&self, id: u32) -> Arc<Notify> {
        let cancel = Arc::new(Notify::new());
        self.lock_asks().insert(id, Arc::clone(&cancel));
        cancel
    }

    pub fn end_ask(&self, id: u32) {
        self.lock_asks().remove(&id);
    }

    /// Cancels a request to the AI service, if it is in progress.
    pub fn cancel_ask(&self, id: u32) {
        if let Some(cancel) = self.lock_asks().get(&id) {
            cancel.notify_one();
        }
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
        let sessions = self
            .lock_sessions()
            .drain()
            .map(|(_, entry)| entry.session)
            .collect();
        self.lock_schemas().clear();
        sessions
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

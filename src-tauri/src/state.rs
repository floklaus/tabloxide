//! Application state that the commands share.

use crate::error::CommandError;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use tabloxide_workspace::{KeyringStore, SecretStore, Workspace};

pub struct AppState {
    workspace: Mutex<Option<Workspace>>,
    secrets: Arc<dyn SecretStore>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            workspace: Mutex::new(None),
            secrets: Arc::new(KeyringStore),
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

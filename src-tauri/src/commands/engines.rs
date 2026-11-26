//! The database engines and their connectors: the list, the download, the install
//! from a file, and the removal. Section 5 of `docs/Connector Design.md` gives the rules.

use crate::error::CommandError;
use crate::state::{AppState, blocking};
use serde::Serialize;
use specta::Type;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tabloxide_connector_host::index::{self, INDEX_URL, TARGET};
use tabloxide_connector_host::{EngineEntry, InstallError, PackageInfo};
use tabloxide_core::Engine;
use tauri::State;
use tauri::ipc::Channel;

/// The environment variable that replaces the index address. Only a development
/// build reads it.
const INDEX_URL_ENV: &str = "TABLOXIDE_CONNECTOR_INDEX";

/// The steps of a download, for the progress in the UI.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum DownloadEvent {
    /// Tabloxide loads and checks the list of connectors.
    LoadingIndex,
    /// The download of the package starts.
    Downloading {
        version: String,
        #[specta(type = f64)]
        size: u64,
    },
    Progress {
        #[specta(type = f64)]
        received: u64,
    },
    /// Tabloxide checks and unpacks the package.
    Checking,
}

/// The result of an install. A failure is a normal result, not a command error.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum InstallResult {
    Installed {
        package: PackageInfo,
    },
    /// The package has no signature of the project. The user must confirm the install.
    NeedsConfirmation {
        package: PackageInfo,
    },
    Failed {
        message: String,
    },
}

fn failed(error: &InstallError) -> InstallResult {
    InstallResult::Failed {
        message: error.to_string(),
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

fn index_url() -> String {
    cfg!(debug_assertions)
        .then(|| std::env::var(INDEX_URL_ENV).ok())
        .flatten()
        .unwrap_or_else(|| INDEX_URL.to_owned())
}

/// Returns the built-in engines, the installed connectors, and the official
/// connectors that the user can download. This command makes no network request.
#[tauri::command]
#[specta::specta]
pub async fn engine_list(state: State<'_, AppState>) -> Result<Vec<EngineEntry>, CommandError> {
    let engines = state.engines();
    blocking(move || Ok(engines.list())).await
}

/// Downloads and installs the official connector of an engine. The UI calls it only
/// after the user agreed. This is the first network request for connectors.
#[tauri::command]
#[specta::specta]
pub async fn connector_download(
    state: State<'_, AppState>,
    engine: Engine,
    on_event: Channel<DownloadEvent>,
) -> Result<InstallResult, CommandError> {
    let registry = state.engines();
    let root = registry.installed_root().to_owned();
    let _ = on_event.send(DownloadEvent::LoadingIndex);
    let client = match index::http_client() {
        Ok(client) => client,
        Err(error) => return Ok(failed(&error.into())),
    };
    let found = index::fetch(&client, &index_url(), &root, now_secs())
        .await
        .and_then(|index| index.package_for(engine.as_str(), TARGET));
    let (entry, package) = match found {
        Ok(found) => found,
        Err(error) => return Ok(failed(&error.into())),
    };
    let _ = on_event.send(DownloadEvent::Downloading {
        version: entry.version.clone(),
        size: package.size,
    });
    // A new version starts a new process on the next connection.
    registry.stop(&engine).await;
    let size = package.size;
    let downloaded =
        tabloxide_connector_host::download(&client, &entry, &package, &root, |received| {
            let _ = on_event.send(DownloadEvent::Progress { received });
            if received == size {
                let _ = on_event.send(DownloadEvent::Checking);
            }
        })
        .await;
    Ok(match downloaded {
        Ok(package) => InstallResult::Installed { package },
        Err(error) => failed(&error),
    })
}

/// Reads a connector package file and tells what it is, and if it has the signature
/// of the project. It installs nothing.
#[tauri::command]
#[specta::specta]
pub async fn connector_inspect_file(
    state: State<'_, AppState>,
    path: PathBuf,
) -> Result<InstallResult, CommandError> {
    let root = state.engines().installed_root().to_owned();
    blocking(move || {
        Ok(match tabloxide_connector_host::inspect_file(&path, &root) {
            Ok(package) if package.is_official => InstallResult::Installed { package },
            Ok(package) => InstallResult::NeedsConfirmation { package },
            Err(error) => failed(&error),
        })
    })
    .await
}

/// Installs a connector package file. `sha256` is the checksum that
/// `connector_inspect_file` gave. `confirmed` is `true` after the user confirmed a
/// package without the signature of the project.
#[tauri::command]
#[specta::specta]
pub async fn connector_install_file(
    state: State<'_, AppState>,
    path: PathBuf,
    sha256: String,
    confirmed: bool,
) -> Result<InstallResult, CommandError> {
    let registry = state.engines();
    let root = registry.installed_root().to_owned();
    let result = blocking(move || {
        Ok(tabloxide_connector_host::install_file(
            &path, &sha256, confirmed, &root,
        ))
    })
    .await?;
    Ok(match result {
        Ok(package) => {
            registry.stop(&Engine::new(package.engine.clone())).await;
            InstallResult::Installed { package }
        }
        Err(error) => failed(&error),
    })
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

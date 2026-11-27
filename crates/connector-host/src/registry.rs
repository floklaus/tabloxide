//! The list of database engines: the built-in adapters and the installed connectors.

use crate::manifest::Manifest;
use crate::process::{ConnectorProcess, StartError, supports_protocol};
use crate::remote::RemoteAdapter;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tabloxide_core::{ConnectError, ConnectErrorKind, DbAdapter, Engine, EngineInfo};
use tokio::sync::Mutex;

/// The file that an install writes last. A version folder without it is not complete.
pub const INSTALL_RECORD_FILE: &str = "install.json";

/// How a connector came to this machine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InstallRecord {
    /// `true` if the package has a signature of the Tabloxide project.
    pub is_official: bool,
    pub publisher: Option<String>,
    /// The SHA-256 checksum of the package, in hexadecimal.
    pub sha256: String,
    /// Seconds since 1970-01-01 UTC.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub installed_at: u64,
}

/// Where an engine comes from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum EngineSource {
    /// The engine is part of the application.
    BuiltIn,
    /// An installed connector.
    #[serde(rename_all = "camelCase")]
    Installed {
        version: String,
        is_official: bool,
        publisher: Option<String>,
    },
    /// A connector from the development folder `TABLOXIDE_CONNECTOR_DIR`.
    #[serde(rename_all = "camelCase")]
    Development { version: String, folder: String },
    /// An official connector that is not installed. The user can download it.
    Available,
}

/// The official connectors. The application knows them without a network request, so
/// that the engine list can show them before the user agrees to a download.
fn official_connectors() -> Vec<EngineInfo> {
    vec![EngineInfo {
        engine: Engine::new("mongodb"),
        display_name: "MongoDB".to_owned(),
        language: tabloxide_core::QueryLanguage::MongodbShell,
        default_port: Some(27017),
        capabilities: tabloxide_core::Capabilities {
            cancel: true,
            unix_socket: false,
            file_database: false,
            explain_plan: false,
            measured_plan: false,
        },
    }]
}

/// One engine that the application can use now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct EngineEntry {
    pub info: EngineInfo,
    pub source: EngineSource,
}

/// A failure to get the adapter of an engine.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum HostError {
    #[error("No connector for the engine `{0}` is installed.")]
    NotInstalled(String),
    #[error(
        "The connector for `{engine}` uses protocol version {major}. This version of Tabloxide uses version 1."
    )]
    Protocol { engine: String, major: u32 },
    #[error("The connector for `{engine}` did not start. {error}")]
    Start { engine: String, error: StartError },
}

impl From<HostError> for ConnectError {
    fn from(error: HostError) -> Self {
        let kind = match error {
            HostError::NotInstalled(_) => ConnectErrorKind::ConnectorMissing,
            HostError::Protocol { .. } | HostError::Start { .. } => ConnectErrorKind::Other,
        };
        Self::new(kind, error.to_string())
    }
}

/// A connector folder on the disk.
#[derive(Debug, Clone)]
struct Found {
    folder: PathBuf,
    manifest: Manifest,
    source: EngineSource,
}

fn read_record(folder: &Path) -> Option<InstallRecord> {
    let text = std::fs::read_to_string(folder.join(INSTALL_RECORD_FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

fn sub_folders(folder: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return Vec::new();
    };
    let mut folders: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| entry.path())
        .collect();
    folders.sort();
    folders
}

/// Finds the installed connectors: `<root>/<engine>/<version>/`. For each engine, the
/// highest complete version wins.
fn find_installed(root: &Path) -> BTreeMap<String, Found> {
    let mut found: BTreeMap<String, Found> = BTreeMap::new();
    for engine_folder in sub_folders(root) {
        for folder in sub_folders(&engine_folder) {
            let Some(record) = read_record(&folder) else {
                continue;
            };
            let Ok(manifest) = Manifest::read(&folder) else {
                continue;
            };
            let is_in_its_folder = engine_folder.file_name() == Some(manifest.engine.as_ref())
                && folder.file_name() == Some(manifest.version.as_ref());
            if !is_in_its_folder {
                continue;
            }
            let version = semver::Version::parse(&manifest.version).ok();
            let is_newer = found.get(&manifest.engine).is_none_or(|current| {
                version > semver::Version::parse(&current.manifest.version).ok()
            });
            if is_newer {
                let source = EngineSource::Installed {
                    version: manifest.version.clone(),
                    is_official: record.is_official,
                    publisher: record.publisher.or_else(|| manifest.publisher.clone()),
                };
                found.insert(
                    manifest.engine.clone(),
                    Found {
                        folder,
                        manifest,
                        source,
                    },
                );
            }
        }
    }
    found
}

/// Finds the connectors of the development folder: `<root>/<any name>/connector.toml`.
fn find_development(root: &Path) -> BTreeMap<String, Found> {
    sub_folders(root)
        .into_iter()
        .filter_map(|folder| {
            let manifest = Manifest::read(&folder).ok()?;
            let source = EngineSource::Development {
                version: manifest.version.clone(),
                folder: folder.to_string_lossy().into_owned(),
            };
            Some((
                manifest.engine.clone(),
                Found {
                    folder,
                    manifest,
                    source,
                },
            ))
        })
        .collect()
}

struct Running {
    folder: PathBuf,
    adapter: Arc<RemoteAdapter>,
}

/// The engines of the application.
pub struct EngineRegistry {
    builtin: Vec<Arc<dyn DbAdapter>>,
    installed_root: PathBuf,
    development_root: Option<PathBuf>,
    running: Mutex<HashMap<String, Running>>,
}

impl EngineRegistry {
    /// `installed_root` is the folder of the installed connectors. `development_root`
    /// is the folder of `TABLOXIDE_CONNECTOR_DIR`, only in a development build.
    #[must_use]
    pub fn new(
        builtin: Vec<Arc<dyn DbAdapter>>,
        installed_root: PathBuf,
        development_root: Option<PathBuf>,
    ) -> Self {
        Self {
            builtin,
            installed_root,
            development_root,
            running: Mutex::new(HashMap::new()),
        }
    }

    #[must_use]
    pub fn installed_root(&self) -> &Path {
        &self.installed_root
    }

    fn builtin(&self, engine: &str) -> Option<&Arc<dyn DbAdapter>> {
        self.builtin
            .iter()
            .find(|adapter| adapter.info().engine.as_str() == engine)
    }

    /// The connectors on the disk. A development connector replaces an installed one.
    fn connectors(&self) -> BTreeMap<String, Found> {
        let mut found = find_installed(&self.installed_root);
        if let Some(root) = &self.development_root {
            found.extend(find_development(root));
        }
        found.retain(|engine, _| self.builtin(engine).is_none());
        found
    }

    /// Returns the engines: first the built-in engines, then the installed connectors
    /// in the sequence of their names, then the official connectors to download.
    #[must_use]
    pub fn list(&self) -> Vec<EngineEntry> {
        let builtin = self.builtin.iter().map(|adapter| EngineEntry {
            info: adapter.info(),
            source: EngineSource::BuiltIn,
        });
        let found = self.connectors();
        let available: Vec<EngineEntry> = official_connectors()
            .into_iter()
            .filter(|info| {
                !found.contains_key(info.engine.as_str())
                    && self.builtin(info.engine.as_str()).is_none()
            })
            .map(|info| EngineEntry {
                info,
                source: EngineSource::Available,
            })
            .collect();
        // The manifest does not tell what the connector can do, for example if it
        // gives execution plans. A connector that runs told it with `Describe`.
        // If a different task holds the lock, the list has the data of the manifest.
        let running = self.running.try_lock().ok();
        let connectors = found.into_iter().map(|(engine, found)| {
            let described = running
                .as_ref()
                .and_then(|running| running.get(&engine))
                .filter(|current| current.folder == found.folder)
                .map(|current| current.adapter.info());
            EngineEntry {
                info: described.unwrap_or_else(|| found.manifest.engine_info()),
                source: found.source,
            }
        });
        builtin.chain(connectors).chain(available).collect()
    }

    /// Returns the adapter of `engine`. The first call for a connector starts its
    /// process. A process that stopped starts again.
    ///
    /// # Errors
    ///
    /// Returns an error if no connector is installed for the engine, or if it does not start.
    pub async fn adapter(&self, engine: &Engine) -> Result<Arc<dyn DbAdapter>, HostError> {
        if let Some(adapter) = self.builtin(engine.as_str()) {
            return Ok(Arc::clone(adapter));
        }
        let found = self
            .connectors()
            .remove(engine.as_str())
            .ok_or_else(|| HostError::NotInstalled(engine.to_string()))?;
        if !supports_protocol(found.manifest.protocol) {
            return Err(HostError::Protocol {
                engine: engine.to_string(),
                major: found.manifest.protocol,
            });
        }
        let mut running = self.running.lock().await;
        if let Some(current) = running.get(engine.as_str())
            && current.folder == found.folder
            && current.adapter.is_running()
        {
            return Ok(Arc::clone(&current.adapter) as Arc<dyn DbAdapter>);
        }
        let program = found.manifest.program_path(&found.folder);
        let process = ConnectorProcess::start(&program, &[], &[], engine.as_str())
            .await
            .map_err(|error| HostError::Start {
                engine: engine.to_string(),
                error,
            })?;
        let adapter = Arc::new(RemoteAdapter::new(Arc::new(process)));
        running.insert(
            engine.to_string(),
            Running {
                folder: found.folder,
                adapter: Arc::clone(&adapter),
            },
        );
        Ok(adapter)
    }

    /// Stops the process of `engine`. The sessions that are open keep it until they close.
    pub async fn stop(&self, engine: &Engine) {
        self.running.lock().await.remove(engine.as_str());
    }

    /// Removes all installed versions of the connector for `engine`.
    ///
    /// # Errors
    ///
    /// Returns an error if a file cannot be removed.
    pub async fn remove(&self, engine: &Engine) -> std::io::Result<()> {
        if !Engine::is_valid_name(engine.as_str()) {
            return Ok(());
        }
        self.stop(engine).await;
        let folder = self.installed_root.join(engine.as_str());
        match tokio::fs::remove_dir_all(&folder).await {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            other => other,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tabloxide_core::testing::ScriptedAdapter;

    fn write_connector(folder: &Path, engine: &str, version: &str, record: bool) {
        std::fs::create_dir_all(folder).unwrap();
        std::fs::write(
            folder.join("connector.toml"),
            format!(
                "engine = \"{engine}\"\ndisplay_name = \"X\"\nversion = \"{version}\"\nprotocol = 1\nprogram = \"run\"\nlanguage = \"sql\"\n"
            ),
        )
        .unwrap();
        if record {
            let record = InstallRecord {
                is_official: true,
                publisher: None,
                sha256: "00".to_owned(),
                installed_at: 0,
            };
            std::fs::write(
                folder.join(INSTALL_RECORD_FILE),
                serde_json::to_string(&record).unwrap(),
            )
            .unwrap();
        }
    }

    fn registry(installed: &Path, development: Option<&Path>) -> EngineRegistry {
        EngineRegistry::new(
            vec![Arc::new(ScriptedAdapter::default())],
            installed.to_owned(),
            development.map(Path::to_owned),
        )
    }

    #[test]
    fn lists_the_builtin_engines_and_the_highest_complete_version() {
        let dir = tempfile::tempdir().unwrap();
        write_connector(&dir.path().join("mongodb/0.9.0"), "mongodb", "0.9.0", true);
        write_connector(
            &dir.path().join("mongodb/0.10.0"),
            "mongodb",
            "0.10.0",
            true,
        );
        write_connector(&dir.path().join("mongodb/1.0.0"), "mongodb", "1.0.0", false);
        // A folder that does not agree with its manifest does not count.
        write_connector(&dir.path().join("redis/1.0.0"), "mongodb", "1.0.0", true);

        let list = registry(dir.path(), None).list();

        assert_eq!(
            list.len(),
            2,
            "MongoDB is installed, so it is not in the list to download"
        );
        assert_eq!(list[0].source, EngineSource::BuiltIn);
        assert_eq!(list[1].info.engine.as_str(), "mongodb");
        assert!(matches!(
            &list[1].source,
            EngineSource::Installed { version, .. } if version == "0.10.0"
        ));
    }

    #[test]
    fn a_development_connector_replaces_an_installed_one_but_not_a_builtin_engine() {
        let installed = tempfile::tempdir().unwrap();
        let development = tempfile::tempdir().unwrap();
        write_connector(
            &installed.path().join("mongodb/1.0.0"),
            "mongodb",
            "1.0.0",
            true,
        );
        write_connector(&development.path().join("mongo"), "mongodb", "0.0.1", false);
        write_connector(
            &development.path().join("other"),
            "scripted",
            "0.0.1",
            false,
        );

        let list = registry(installed.path(), Some(development.path())).list();

        assert_eq!(list.len(), 2);
        assert!(
            matches!(&list[1].source, EngineSource::Development { version, .. } if version == "0.0.1")
        );
    }

    #[tokio::test]
    async fn a_missing_connector_is_a_connect_error_that_names_the_engine() {
        let dir = tempfile::tempdir().unwrap();

        let error = match registry(dir.path(), None)
            .adapter(&Engine::new("mongodb"))
            .await
        {
            Err(error) => error,
            Ok(_) => panic!("the engine is not installed"),
        };
        let error = ConnectError::from(error);

        assert_eq!(error.kind, ConnectErrorKind::ConnectorMissing);
        assert!(error.detail.contains("mongodb"));
    }

    #[tokio::test]
    async fn remove_deletes_all_versions_of_one_engine() {
        let dir = tempfile::tempdir().unwrap();
        write_connector(&dir.path().join("mongodb/1.0.0"), "mongodb", "1.0.0", true);
        let registry = registry(dir.path(), None);

        registry.remove(&Engine::new("mongodb")).await.unwrap();

        assert_eq!(registry.list()[1].source, EngineSource::Available);
        assert!(!dir.path().join("mongodb").exists());
    }
}

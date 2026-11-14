//! The `tabloxide.toml` file in the workspace root.

use crate::error::WorkspaceError;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use tabloxide_core::{ConnectionId, ConnectionProfile, validate_profile};

pub const CONFIG_FILE_NAME: &str = "tabloxide.toml";

const CONFIG_VERSION: u32 = 1;

fn default_version() -> u32 {
    CONFIG_VERSION
}

/// Shared project configuration. It contains connection definitions without secrets.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkspaceConfig {
    #[serde(default = "default_version")]
    version: u32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    connections: Vec<ConnectionProfile>,
}

impl Default for WorkspaceConfig {
    fn default() -> Self {
        Self {
            version: CONFIG_VERSION,
            connections: Vec::new(),
        }
    }
}

fn config_path(root: &Path) -> PathBuf {
    root.join(CONFIG_FILE_NAME)
}

fn io_error(path: &Path, source: std::io::Error) -> WorkspaceError {
    WorkspaceError::Io {
        path: path.to_owned(),
        source,
    }
}

impl WorkspaceConfig {
    /// Reads the configuration of the workspace in `root`.
    /// A workspace without a configuration file has the default configuration.
    ///
    /// # Errors
    ///
    /// Returns an error if `root` is not a directory, or if the file is not readable,
    /// not valid TOML, or from a later version of the application.
    pub fn load(root: &Path) -> Result<Self, WorkspaceError> {
        if !root.is_dir() {
            return Err(WorkspaceError::NotADirectory(root.to_owned()));
        }
        let path = config_path(root);
        let text = match std::fs::read_to_string(&path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::default());
            }
            Err(error) => return Err(io_error(&path, error)),
        };
        let config: Self = toml::from_str(&text).map_err(|error| WorkspaceError::Parse {
            path: path.clone(),
            message: error.message().to_owned(),
        })?;
        if config.version > CONFIG_VERSION {
            return Err(WorkspaceError::UnsupportedVersion {
                path,
                found: config.version,
                supported: CONFIG_VERSION,
            });
        }
        Ok(config)
    }

    /// Writes the configuration to the workspace in `root`.
    /// The write goes to a temporary file first. Thus a crash cannot leave a partial file.
    ///
    /// # Errors
    ///
    /// Returns an error if the file is not writable.
    pub fn save(&self, root: &Path) -> Result<(), WorkspaceError> {
        let path = config_path(root);
        let text = toml::to_string_pretty(self).map_err(|error| WorkspaceError::Parse {
            path: path.clone(),
            message: error.to_string(),
        })?;
        let mut file = tempfile::NamedTempFile::new_in(root).map_err(|e| io_error(&path, e))?;
        file.write_all(text.as_bytes())
            .and_then(|()| file.as_file().sync_all())
            .map_err(|e| io_error(&path, e))?;
        file.persist(&path).map_err(|e| io_error(&path, e.error))?;
        Ok(())
    }

    #[must_use]
    pub fn connections(&self) -> &[ConnectionProfile] {
        &self.connections
    }

    #[must_use]
    pub fn connection(&self, id: &ConnectionId) -> Option<&ConnectionProfile> {
        self.connections.iter().find(|profile| &profile.id == id)
    }

    /// Returns a configuration that contains `profile`.
    /// A profile with the same identifier is replaced. A new profile goes to the end.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceError::InvalidProfile`] if the profile is not valid.
    pub fn with_connection(&self, profile: ConnectionProfile) -> Result<Self, WorkspaceError> {
        let issues = validate_profile(&profile);
        if !issues.is_empty() {
            return Err(WorkspaceError::InvalidProfile(issues));
        }
        let is_existing = self.connection(&profile.id).is_some();
        let connections = if is_existing {
            self.connections
                .iter()
                .map(|current| {
                    if current.id == profile.id {
                        profile.clone()
                    } else {
                        current.clone()
                    }
                })
                .collect()
        } else {
            self.connections
                .iter()
                .cloned()
                .chain(std::iter::once(profile))
                .collect()
        };
        Ok(Self {
            version: self.version,
            connections,
        })
    }

    /// Returns a configuration without the connection `id`.
    ///
    /// # Errors
    ///
    /// Returns [`WorkspaceError::ConnectionNotFound`] if the connection does not exist.
    pub fn without_connection(&self, id: &ConnectionId) -> Result<Self, WorkspaceError> {
        if self.connection(id).is_none() {
            return Err(WorkspaceError::ConnectionNotFound(id.clone()));
        }
        Ok(Self {
            version: self.version,
            connections: self
                .connections
                .iter()
                .filter(|profile| &profile.id != id)
                .cloned()
                .collect(),
        })
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use tabloxide_core::{Environment, SecretSource, TlsMode};

    pub(crate) fn profile(id: &str, name: &str) -> ConnectionProfile {
        ConnectionProfile {
            id: ConnectionId::from(id),
            name: name.to_owned(),
            environment: Environment::Production,
            host: "db.example.com".to_owned(),
            port: 5432,
            database: "app".to_owned(),
            user: "app_user".to_owned(),
            tls_mode: TlsMode::VerifyFull,
            socket_path: None,
            connect_timeout_secs: 10,
            query_timeout_secs: Some(30),
            params: BTreeMap::from([("application_name".to_owned(), "tabloxide".to_owned())]),
            secret: SecretSource::EnvVar {
                name: "APP_DB_PASSWORD".to_owned(),
            },
        }
    }

    #[test]
    fn load_returns_the_default_when_the_file_is_missing() {
        let dir = tempfile::tempdir().unwrap();

        let config = WorkspaceConfig::load(dir.path()).unwrap();

        assert_eq!(config, WorkspaceConfig::default());
    }

    #[test]
    fn load_fails_when_the_root_is_not_a_directory() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing");

        let result = WorkspaceConfig::load(&missing);

        assert!(matches!(result, Err(WorkspaceError::NotADirectory(_))));
    }

    #[test]
    fn save_then_load_returns_the_same_configuration() {
        let dir = tempfile::tempdir().unwrap();
        let config = WorkspaceConfig::default()
            .with_connection(profile("a", "Production"))
            .unwrap()
            .with_connection(ConnectionProfile {
                secret: SecretSource::Keychain,
                params: BTreeMap::new(),
                query_timeout_secs: None,
                socket_path: Some("/var/run/postgresql".to_owned()),
                ..profile("b", "Local")
            })
            .unwrap();

        config.save(dir.path()).unwrap();
        let loaded = WorkspaceConfig::load(dir.path()).unwrap();

        assert_eq!(loaded, config);
    }

    #[test]
    fn save_leaves_no_temporary_file() {
        let dir = tempfile::tempdir().unwrap();

        WorkspaceConfig::default().save(dir.path()).unwrap();

        let names: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, [CONFIG_FILE_NAME]);
    }

    #[test]
    fn load_reports_invalid_toml() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(CONFIG_FILE_NAME), "version = [").unwrap();

        let result = WorkspaceConfig::load(dir.path());

        assert!(matches!(result, Err(WorkspaceError::Parse { .. })));
    }

    #[test]
    fn load_rejects_a_later_version() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(CONFIG_FILE_NAME), "version = 99\n").unwrap();

        let result = WorkspaceConfig::load(dir.path());

        assert!(matches!(
            result,
            Err(WorkspaceError::UnsupportedVersion { found: 99, .. })
        ));
    }

    #[test]
    fn with_connection_replaces_a_profile_that_has_the_same_id() {
        let config = WorkspaceConfig::default()
            .with_connection(profile("a", "Old"))
            .unwrap()
            .with_connection(profile("b", "Other"))
            .unwrap();

        let updated = config.with_connection(profile("a", "New")).unwrap();

        let names: Vec<_> = updated
            .connections()
            .iter()
            .map(|p| p.name.as_str())
            .collect();
        assert_eq!(names, ["New", "Other"]);
        assert_eq!(config.connections()[0].name, "Old");
    }

    #[test]
    fn with_connection_rejects_an_invalid_profile() {
        let result = WorkspaceConfig::default().with_connection(profile("a", ""));

        assert!(matches!(result, Err(WorkspaceError::InvalidProfile(issues)) if issues.len() == 1));
    }

    #[test]
    fn without_connection_removes_only_that_connection() {
        let config = WorkspaceConfig::default()
            .with_connection(profile("a", "A"))
            .unwrap()
            .with_connection(profile("b", "B"))
            .unwrap();

        let updated = config.without_connection(&ConnectionId::from("a")).unwrap();

        assert_eq!(updated.connections().len(), 1);
        assert_eq!(updated.connections()[0].name, "B");
    }

    #[test]
    fn without_connection_fails_for_an_unknown_id() {
        let result = WorkspaceConfig::default().without_connection(&ConnectionId::from("x"));

        assert!(matches!(result, Err(WorkspaceError::ConnectionNotFound(_))));
    }

    #[test]
    fn the_saved_file_contains_no_password_field() {
        let dir = tempfile::tempdir().unwrap();
        let config = WorkspaceConfig::default()
            .with_connection(profile("a", "A"))
            .unwrap();

        config.save(dir.path()).unwrap();

        let text = std::fs::read_to_string(dir.path().join(CONFIG_FILE_NAME)).unwrap();
        assert!(!text.to_lowercase().contains("password ="), "{text}");
        assert!(text.contains("[[connections]]"), "{text}");
    }
}

//! An open workspace: a folder, its configuration, and the operations on its connections.

use crate::config::WorkspaceConfig;
use crate::error::WorkspaceError;
use crate::secrets::{SecretError, SecretStore};
use std::path::{Path, PathBuf};
use tabloxide_core::{ConnectionId, ConnectionProfile, Secret, SecretSource};

/// An open workspace. Each operation writes the configuration file and returns a new value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Workspace {
    root: PathBuf,
    config: WorkspaceConfig,
}

/// Removes a stored password. A store that is not available cannot contain a password,
/// so that condition is not an error here.
fn remove_stored_secret(store: &dyn SecretStore, id: &ConnectionId) -> Result<(), SecretError> {
    match store.delete(id) {
        Ok(()) | Err(SecretError::StoreUnavailable(_)) => Ok(()),
        Err(error) => Err(error),
    }
}

fn uses_keychain(profile: &ConnectionProfile) -> bool {
    profile.secret == SecretSource::Keychain
}

impl Workspace {
    /// Opens the workspace in the folder `root`.
    ///
    /// # Errors
    ///
    /// Returns an error if `root` is not a directory or if the configuration file is not valid.
    pub fn open(root: &Path) -> Result<Self, WorkspaceError> {
        Ok(Self {
            root: root.to_owned(),
            config: WorkspaceConfig::load(root)?,
        })
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Name of the workspace folder.
    #[must_use]
    pub fn name(&self) -> String {
        self.root.file_name().map_or_else(
            || self.root.display().to_string(),
            |name| name.to_string_lossy().into_owned(),
        )
    }

    #[must_use]
    pub fn connections(&self) -> &[ConnectionProfile] {
        self.config.connections()
    }

    #[must_use]
    pub fn connection(&self, id: &ConnectionId) -> Option<&ConnectionProfile> {
        self.config.connection(id)
    }

    fn with_config(&self, config: WorkspaceConfig) -> Result<Self, WorkspaceError> {
        config.save(&self.root)?;
        Ok(Self {
            root: self.root.clone(),
            config,
        })
    }

    /// Adds or replaces a connection.
    ///
    /// `new_password` goes to the credential store when the password source is the keychain.
    /// `None` keeps the stored password. When the password source changes from the keychain
    /// to a different source, the stored password is removed.
    ///
    /// # Errors
    ///
    /// Returns an error if the profile is not valid, the credential store fails,
    /// or the configuration file is not writable.
    pub fn save_connection(
        &self,
        profile: ConnectionProfile,
        new_password: Option<&Secret>,
        store: &dyn SecretStore,
    ) -> Result<Self, WorkspaceError> {
        let had_keychain = self.connection(&profile.id).is_some_and(uses_keychain);
        let id = profile.id.clone();
        let has_keychain = uses_keychain(&profile);
        let config = self.config.with_connection(profile)?;

        match (has_keychain, new_password) {
            (true, Some(password)) => store.set(&id, password)?,
            (false, _) if had_keychain => remove_stored_secret(store, &id)?,
            _ => {}
        }
        self.with_config(config)
    }

    /// Removes a connection and its stored password.
    ///
    /// # Errors
    ///
    /// Returns an error if the connection does not exist or the configuration file is not writable.
    pub fn delete_connection(
        &self,
        id: &ConnectionId,
        store: &dyn SecretStore,
    ) -> Result<Self, WorkspaceError> {
        let config = self.config.without_connection(id)?;
        remove_stored_secret(store, id)?;
        self.with_config(config)
    }

    /// Adds a copy of a connection. The copy gets its own copy of the stored password.
    ///
    /// # Errors
    ///
    /// Returns an error if the connection does not exist, the credential store fails,
    /// or the configuration file is not writable.
    pub fn duplicate_connection(
        &self,
        id: &ConnectionId,
        store: &dyn SecretStore,
    ) -> Result<Self, WorkspaceError> {
        let original = self
            .connection(id)
            .ok_or_else(|| WorkspaceError::ConnectionNotFound(id.clone()))?;
        let copy = original.duplicate();
        let password = if uses_keychain(original) {
            store.get(id)?
        } else {
            None
        };
        self.save_connection(copy, password.as_ref(), store)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::CONFIG_FILE_NAME;
    use crate::config::tests::profile;
    use crate::secrets::MemoryStore;

    fn keychain_profile(id: &str, name: &str) -> ConnectionProfile {
        ConnectionProfile {
            secret: SecretSource::Keychain,
            ..profile(id, name)
        }
    }

    fn open_empty() -> (tempfile::TempDir, Workspace) {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::open(dir.path()).unwrap();
        (dir, workspace)
    }

    fn stored(store: &MemoryStore, id: &str) -> Option<String> {
        store
            .get(&ConnectionId::from(id))
            .unwrap()
            .map(|secret| secret.expose().to_owned())
    }

    #[test]
    fn save_connection_writes_the_file_and_stores_the_password() {
        let (dir, workspace) = open_empty();
        let store = MemoryStore::default();

        let saved = workspace
            .save_connection(keychain_profile("a", "A"), Some(&Secret::new("pw")), &store)
            .unwrap();

        assert_eq!(saved.connections().len(), 1);
        assert_eq!(Workspace::open(dir.path()).unwrap(), saved);
        assert_eq!(stored(&store, "a").as_deref(), Some("pw"));
    }

    #[test]
    fn the_password_is_never_in_the_configuration_file() {
        let (dir, workspace) = open_empty();
        let store = MemoryStore::default();

        workspace
            .save_connection(
                keychain_profile("a", "A"),
                Some(&Secret::new("s3cr3t-value")),
                &store,
            )
            .unwrap();

        let text = std::fs::read_to_string(dir.path().join(CONFIG_FILE_NAME)).unwrap();
        assert!(!text.contains("s3cr3t-value"), "{text}");
    }

    #[test]
    fn save_connection_without_a_new_password_keeps_the_stored_password() {
        let (_dir, workspace) = open_empty();
        let store = MemoryStore::default();
        let saved = workspace
            .save_connection(keychain_profile("a", "A"), Some(&Secret::new("pw")), &store)
            .unwrap();

        saved
            .save_connection(keychain_profile("a", "Renamed"), None, &store)
            .unwrap();

        assert_eq!(stored(&store, "a").as_deref(), Some("pw"));
    }

    #[test]
    fn save_connection_removes_the_stored_password_when_the_source_changes() {
        let (_dir, workspace) = open_empty();
        let store = MemoryStore::default();
        let saved = workspace
            .save_connection(keychain_profile("a", "A"), Some(&Secret::new("pw")), &store)
            .unwrap();

        saved
            .save_connection(profile("a", "A"), None, &store)
            .unwrap();

        assert_eq!(stored(&store, "a"), None);
    }

    #[test]
    fn save_connection_does_not_store_a_password_for_an_environment_variable_source() {
        let (_dir, workspace) = open_empty();
        let store = MemoryStore::default();

        workspace
            .save_connection(profile("a", "A"), Some(&Secret::new("pw")), &store)
            .unwrap();

        assert_eq!(stored(&store, "a"), None);
    }

    #[test]
    fn save_connection_stores_nothing_when_the_profile_is_not_valid() {
        let (dir, workspace) = open_empty();
        let store = MemoryStore::default();

        let result =
            workspace.save_connection(keychain_profile("a", ""), Some(&Secret::new("pw")), &store);

        assert!(matches!(result, Err(WorkspaceError::InvalidProfile(_))));
        assert_eq!(stored(&store, "a"), None);
        assert!(!dir.path().join(CONFIG_FILE_NAME).exists());
    }

    #[test]
    fn delete_connection_removes_the_connection_and_the_password() {
        let (dir, workspace) = open_empty();
        let store = MemoryStore::default();
        let saved = workspace
            .save_connection(keychain_profile("a", "A"), Some(&Secret::new("pw")), &store)
            .unwrap();

        let after = saved
            .delete_connection(&ConnectionId::from("a"), &store)
            .unwrap();

        assert!(after.connections().is_empty());
        assert!(
            Workspace::open(dir.path())
                .unwrap()
                .connections()
                .is_empty()
        );
        assert_eq!(stored(&store, "a"), None);
    }

    #[test]
    fn duplicate_connection_copies_the_profile_and_the_password() {
        let (_dir, workspace) = open_empty();
        let store = MemoryStore::default();
        let saved = workspace
            .save_connection(keychain_profile("a", "A"), Some(&Secret::new("pw")), &store)
            .unwrap();

        let after = saved
            .duplicate_connection(&ConnectionId::from("a"), &store)
            .unwrap();

        let copy = &after.connections()[1];
        assert_eq!(copy.name, "A (copy)");
        assert_eq!(stored(&store, copy.id.as_str()).as_deref(), Some("pw"));
    }

    #[test]
    fn duplicate_connection_fails_for_an_unknown_id() {
        let (_dir, workspace) = open_empty();

        let result =
            workspace.duplicate_connection(&ConnectionId::from("x"), &MemoryStore::default());

        assert!(matches!(result, Err(WorkspaceError::ConnectionNotFound(_))));
    }

    #[test]
    fn name_is_the_folder_name() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("sql-project");
        std::fs::create_dir(&root).unwrap();

        assert_eq!(Workspace::open(&root).unwrap().name(), "sql-project");
    }
}

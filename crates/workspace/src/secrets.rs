//! Passwords in the credential store of the operating system.

use std::collections::HashMap;
use std::sync::Mutex;
use tabloxide_core::{ConnectionId, ConnectionProfile, Secret, SecretSource};

const KEYRING_SERVICE: &str = "dev.tabloxide.desktop";

#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error(
        "The credential store of the operating system is not available: {0}. \
         As an alternative, set the password source to an environment variable."
    )]
    StoreUnavailable(String),

    #[error("The environment variable {0} is not set.")]
    EnvVarNotSet(String),

    #[error("The credential store has no password for this connection.")]
    NotInStore,
}

/// Storage for connection passwords. The key is the connection identifier.
pub trait SecretStore: Send + Sync {
    /// # Errors
    /// Returns an error if the store is not available.
    fn get(&self, id: &ConnectionId) -> Result<Option<Secret>, SecretError>;

    /// # Errors
    /// Returns an error if the store is not available.
    fn set(&self, id: &ConnectionId, secret: &Secret) -> Result<(), SecretError>;

    /// Removes the password. It is not an error if the store has no password for `id`.
    ///
    /// # Errors
    /// Returns an error if the store is not available.
    fn delete(&self, id: &ConnectionId) -> Result<(), SecretError>;
}

/// Keychain on macOS, Credential Manager on Windows, Secret Service on Linux.
///
/// On Linux the calls block on a D-Bus request. Do not call them directly from an async task.
#[derive(Debug, Default, Clone, Copy)]
pub struct KeyringStore;

fn unavailable(error: &keyring::Error) -> SecretError {
    SecretError::StoreUnavailable(error.to_string())
}

fn entry(id: &ConnectionId) -> Result<keyring::Entry, SecretError> {
    keyring::Entry::new(KEYRING_SERVICE, &format!("connection:{id}")).map_err(|e| unavailable(&e))
}

impl SecretStore for KeyringStore {
    fn get(&self, id: &ConnectionId) -> Result<Option<Secret>, SecretError> {
        match entry(id)?.get_password() {
            Ok(password) => Ok(Some(Secret::new(password))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(unavailable(&error)),
        }
    }

    fn set(&self, id: &ConnectionId, secret: &Secret) -> Result<(), SecretError> {
        entry(id)?
            .set_password(secret.expose())
            .map_err(|e| unavailable(&e))
    }

    fn delete(&self, id: &ConnectionId) -> Result<(), SecretError> {
        match entry(id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(unavailable(&error)),
        }
    }
}

/// Store that keeps passwords in memory. Use it in tests.
#[derive(Debug, Default)]
pub struct MemoryStore {
    secrets: Mutex<HashMap<ConnectionId, Secret>>,
}

impl MemoryStore {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<ConnectionId, Secret>> {
        self.secrets
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

impl SecretStore for MemoryStore {
    fn get(&self, id: &ConnectionId) -> Result<Option<Secret>, SecretError> {
        Ok(self.lock().get(id).cloned())
    }

    fn set(&self, id: &ConnectionId, secret: &Secret) -> Result<(), SecretError> {
        self.lock().insert(id.clone(), secret.clone());
        Ok(())
    }

    fn delete(&self, id: &ConnectionId) -> Result<(), SecretError> {
        self.lock().remove(id);
        Ok(())
    }
}

/// Gets the password of a connection from the source that the profile specifies.
/// `env` reads an environment variable.
///
/// # Errors
///
/// Returns an error if the source has no password or if the store is not available.
pub fn resolve_secret(
    profile: &ConnectionProfile,
    store: &dyn SecretStore,
    env: &dyn Fn(&str) -> Option<String>,
) -> Result<Option<Secret>, SecretError> {
    match &profile.secret {
        SecretSource::None => Ok(None),
        SecretSource::Keychain => store
            .get(&profile.id)?
            .map(Some)
            .ok_or(SecretError::NotInStore),
        SecretSource::EnvVar { name } => env(name)
            .map(|value| Some(Secret::new(value)))
            .ok_or_else(|| SecretError::EnvVarNotSet(name.clone())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::tests::profile;

    fn no_env(_: &str) -> Option<String> {
        None
    }

    #[test]
    fn memory_store_returns_the_secret_after_a_set() {
        let store = MemoryStore::default();
        let id = ConnectionId::from("a");

        store.set(&id, &Secret::new("pw")).unwrap();

        assert_eq!(store.get(&id).unwrap().unwrap().expose(), "pw");
    }

    #[test]
    fn memory_store_delete_is_not_an_error_for_an_unknown_id() {
        let store = MemoryStore::default();

        assert!(store.delete(&ConnectionId::from("a")).is_ok());
    }

    #[test]
    fn resolve_returns_none_for_a_connection_without_a_password() {
        let profile = ConnectionProfile {
            secret: SecretSource::None,
            ..profile("a", "A")
        };

        let secret = resolve_secret(&profile, &MemoryStore::default(), &no_env).unwrap();

        assert!(secret.is_none());
    }

    #[test]
    fn resolve_reads_the_keychain_source_from_the_store() {
        let profile = ConnectionProfile {
            secret: SecretSource::Keychain,
            ..profile("a", "A")
        };
        let store = MemoryStore::default();
        store.set(&profile.id, &Secret::new("from-store")).unwrap();

        let secret = resolve_secret(&profile, &store, &no_env).unwrap();

        assert_eq!(secret.unwrap().expose(), "from-store");
    }

    #[test]
    fn resolve_fails_when_the_store_has_no_password() {
        let profile = ConnectionProfile {
            secret: SecretSource::Keychain,
            ..profile("a", "A")
        };

        let result = resolve_secret(&profile, &MemoryStore::default(), &no_env);

        assert!(matches!(result, Err(SecretError::NotInStore)));
    }

    #[test]
    fn resolve_reads_the_environment_variable_source() {
        let env = |name: &str| (name == "APP_DB_PASSWORD").then(|| "from-env".to_owned());

        let secret = resolve_secret(&profile("a", "A"), &MemoryStore::default(), &env).unwrap();

        assert_eq!(secret.unwrap().expose(), "from-env");
    }

    #[test]
    fn resolve_fails_when_the_environment_variable_is_not_set() {
        let result = resolve_secret(&profile("a", "A"), &MemoryStore::default(), &no_env);

        assert!(
            matches!(result, Err(SecretError::EnvVarNotSet(name)) if name == "APP_DB_PASSWORD")
        );
    }
}

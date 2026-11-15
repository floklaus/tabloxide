//! The open database files of the application.
//!
//! The application opens each database file one time. Each session is a clone of that
//! connection. A second, independent open of the same file in one process is not safe:
//! the two instances do not see the changes of each other, and the close of one of
//! them removes the file lock of the process.

use crate::error::open_error;
use duckdb::{AccessMode, Config, Connection};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use tabloxide_core::{ConnectError, ConnectErrorKind, ConnectionProfile, MEMORY_DATABASE};

/// Where the database of a profile is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Location {
    /// A database in memory. All sessions of one connection profile share it.
    Memory,
    File(PathBuf),
}

/// What a session needs to open its database.
#[derive(Debug, Clone)]
pub(crate) struct Target {
    /// Identifies the instance. Two targets with the same key use the same database.
    key: String,
    location: Location,
    read_only: bool,
    /// DuckDB reads a relative file name in a statement from this folder.
    search_path: PathBuf,
}

/// Returns the absolute path of the database file. A relative path starts at the
/// workspace folder. The file does not have to exist.
fn absolute_path(database: &str, workspace_root: &Path) -> PathBuf {
    let path = workspace_root.join(database.trim());
    // The same file must give the same key. Thus use the real path of the folder.
    match (path.parent().map(Path::canonicalize), path.file_name()) {
        (Some(Ok(folder)), Some(name)) => folder.join(name),
        _ => path,
    }
}

impl Target {
    pub(crate) fn new(profile: &ConnectionProfile, workspace_root: &Path) -> Self {
        let search_path = workspace_root.to_owned();
        if profile.database.trim() == MEMORY_DATABASE {
            return Self {
                key: format!("{MEMORY_DATABASE}{}", profile.id),
                location: Location::Memory,
                // A database in memory starts empty. Read-only is of no use for it.
                read_only: false,
                search_path,
            };
        }
        let path = absolute_path(&profile.database, workspace_root);
        Self {
            key: path.display().to_string(),
            location: Location::File(path),
            read_only: profile.read_only,
            search_path,
        }
    }

    /// A database in memory for a connection test. No session shares it.
    pub(crate) fn in_memory_for_test() -> Self {
        Self {
            key: format!("{MEMORY_DATABASE}connection-test"),
            location: Location::Memory,
            read_only: false,
            search_path: PathBuf::from("."),
        }
    }

    /// Returns the path of the database file if the file is not there.
    pub(crate) fn missing_file(&self) -> Option<&Path> {
        match &self.location {
            Location::File(path) if !path.exists() => Some(path),
            _ => None,
        }
    }

    pub(crate) fn is_read_only(&self) -> bool {
        self.read_only
    }

    fn open(&self) -> Result<Connection, ConnectError> {
        let mode = if self.read_only {
            AccessMode::ReadOnly
        } else {
            AccessMode::ReadWrite
        };
        let config = Config::default()
            .access_mode(mode)
            // DuckDB must not get program code from the network without a request
            // of the user. `INSTALL` stays available.
            .and_then(|config| config.with("autoinstall_known_extensions", "false"))
            .map_err(|error| open_error(&error.to_string()))?;
        let result = match &self.location {
            Location::Memory => Connection::open_in_memory_with_flags(config),
            Location::File(path) => Connection::open_with_flags(path, config),
        };
        result.map_err(|error| open_error(&error.to_string()))
    }

    /// Prepares the connection of one session.
    fn configure(&self, connection: &Connection) -> duckdb::Result<()> {
        // An error then has its position in a form that a program can read.
        connection.execute_batch("SET errors_as_json = true")?;
        let folder = self.search_path.display().to_string().replace('\'', "''");
        connection.execute_batch(&format!("SET file_search_path = '{folder}'"))
    }
}

struct Instance {
    /// The connection that opened the database. The sessions are clones of it.
    root: Connection,
    read_only: bool,
    sessions: usize,
}

/// The open databases. The key is the path of the file.
#[derive(Default)]
pub(crate) struct Instances {
    open: Mutex<HashMap<String, Instance>>,
}

impl Instances {
    fn lock(&self) -> MutexGuard<'_, HashMap<String, Instance>> {
        self.open.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Returns a connection for one session. Opens the database if it is not open.
    pub(crate) fn connect(
        self: &Arc<Self>,
        target: &Target,
    ) -> Result<(Connection, Lease), ConnectError> {
        // The lock stays until the end. Thus no second thread can open the same file.
        let mut open = self.lock();
        if let Some(instance) = open.get(&target.key) {
            if instance.read_only != target.read_only {
                return Err(ConnectError::new(
                    ConnectErrorKind::InvalidConfiguration,
                    "A different connection of this application has the database file open with a different read-only setting. Close the tabs of that connection first.",
                ));
            }
        } else {
            let instance = Instance {
                root: target.open()?,
                read_only: target.read_only,
                sessions: 0,
            };
            open.insert(target.key.clone(), instance);
        }
        let result = open
            .get(&target.key)
            .ok_or_else(|| ConnectError::new(ConnectErrorKind::Other, "The database is not open."))
            .and_then(|instance| {
                let connection = instance
                    .root
                    .try_clone()
                    .and_then(|connection| target.configure(&connection).map(|()| connection));
                connection.map_err(|error| open_error(&error.to_string()))
            });
        match result {
            Ok(connection) => {
                if let Some(instance) = open.get_mut(&target.key) {
                    instance.sessions += 1;
                }
                let lease = Lease {
                    instances: Arc::clone(self),
                    key: target.key.clone(),
                };
                Ok((connection, lease))
            }
            Err(error) => {
                if open.get(&target.key).is_some_and(|i| i.sessions == 0) {
                    open.remove(&target.key);
                }
                Err(error)
            }
        }
    }

    fn release(&self, key: &str) {
        let mut open = self.lock();
        let Some(instance) = open.get_mut(key) else {
            return;
        };
        instance.sessions = instance.sessions.saturating_sub(1);
        if instance.sessions == 0 {
            // The database closes here, while this thread holds the lock.
            open.remove(key);
        }
    }
}

/// The use of an open database by one session. The database closes when the last
/// session ends. Drop the connection of the session before its lease.
pub(crate) struct Lease {
    instances: Arc<Instances>,
    key: String,
}

impl Drop for Lease {
    fn drop(&mut self) {
        self.instances.release(&self.key);
    }
}

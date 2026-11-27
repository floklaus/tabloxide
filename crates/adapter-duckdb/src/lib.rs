//! DuckDB adapter: the DuckDB implementation of the `DbAdapter` interface.
//!
//! A DuckDB database is a file, or it is in memory. DuckDB runs in the process of the
//! application. Refer to the module `instance` for the rule that keeps a file safe.

mod catalog;
mod error;
mod instance;
mod plan;
mod session;
mod text;
mod worker;

use async_trait::async_trait;
use instance::{Instances, Target};
use session::{DuckCancel, DuckSession};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tabloxide_core::{
    Capabilities, ConnectError, ConnectErrorKind, ConnectionProfile, DbAdapter, Engine, EngineInfo,
    QueryLanguage, Secret, ServerInfo, Session,
};
use tokio::sync::oneshot;

/// The DuckDB database engine. One adapter holds the open database files of the application.
#[derive(Default)]
pub struct DuckDbAdapter {
    instances: Arc<Instances>,
}

fn thread_error(error: &dyn std::fmt::Display) -> ConnectError {
    ConnectError::new(
        ConnectErrorKind::Other,
        format!("The application cannot start the database session: {error}"),
    )
}

/// Checks the database file before DuckDB opens it.
fn check_file(target: &Target) -> Result<(), ConnectError> {
    let Some(path) = target.missing_file() else {
        return Ok(());
    };
    if target.is_read_only() {
        return Err(ConnectError::new(
            ConnectErrorKind::DatabaseNotFound,
            format!(
                "The database file does not exist: {}. A read-only connection does not make a new file.",
                path.display()
            ),
        ));
    }
    if !path.parent().is_some_and(Path::is_dir) {
        return Err(ConnectError::new(
            ConnectErrorKind::InvalidConfiguration,
            format!(
                "The folder of the database file does not exist: {}",
                path.display()
            ),
        ));
    }
    Ok(())
}

impl DuckDbAdapter {
    async fn open(
        &self,
        target: Target,
        query_timeout: Option<Duration>,
    ) -> Result<DuckSession, ConnectError> {
        let (ready, started) = oneshot::channel();
        let (commands, receiver) = std::sync::mpsc::channel();
        let instances = Arc::clone(&self.instances);
        std::thread::Builder::new()
            .name("duckdb-session".to_owned())
            .spawn(move || worker::run(&instances, &target, ready, &receiver))
            .map_err(|error| thread_error(&error))?;
        let started = started.await.map_err(|error| thread_error(&error))??;
        Ok(DuckSession {
            info: ServerInfo {
                version: started.version,
            },
            commands,
            cancel: Arc::new(DuckCancel {
                interrupt: started.interrupt,
            }),
            query_timeout,
        })
    }
}

#[async_trait]
impl DbAdapter for DuckDbAdapter {
    fn info(&self) -> EngineInfo {
        EngineInfo {
            engine: Engine::duckdb(),
            display_name: "DuckDB".to_owned(),
            language: QueryLanguage::Sql,
            default_port: None,
            capabilities: Capabilities {
                cancel: true,
                unix_socket: false,
                file_database: true,
                explain_plan: true,
                measured_plan: true,
            },
        }
    }

    /// Opens the database and reads the DuckDB version. If the file does not exist
    /// and the connection is not read-only, the test does not make the file.
    async fn test_connection(
        &self,
        profile: &ConnectionProfile,
        _password: Option<&Secret>,
        workspace_root: &Path,
    ) -> Result<ServerInfo, ConnectError> {
        let target = Target::new(profile, workspace_root);
        check_file(&target)?;
        let target = if target.missing_file().is_some() {
            Target::in_memory_for_test()
        } else {
            target
        };
        let session = self.open(target, None).await?;
        Ok(session.info.clone())
    }

    async fn connect(
        &self,
        profile: &ConnectionProfile,
        _password: Option<&Secret>,
        workspace_root: &Path,
    ) -> Result<Box<dyn Session>, ConnectError> {
        let target = Target::new(profile, workspace_root);
        check_file(&target)?;
        let query_timeout = profile
            .query_timeout_secs
            .map(|secs| Duration::from_secs(u64::from(secs)));
        Ok(Box::new(self.open(target, query_timeout).await?))
    }
}

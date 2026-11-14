//! PostgreSQL adapter: the PostgreSQL implementation of the `DbAdapter` interface.

mod columns;
mod config;
mod connect;
mod error;
mod introspect;
mod session;
mod stream;
mod tls;

use async_trait::async_trait;
use std::time::Duration;
use tabloxide_core::{
    Capabilities, ConnectError, ConnectionProfile, DbAdapter, Secret, ServerInfo, Session,
};

/// The PostgreSQL database engine.
#[derive(Debug, Clone, Copy, Default)]
pub struct PostgresAdapter;

#[async_trait]
impl DbAdapter for PostgresAdapter {
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            cancel: true,
            unix_socket: cfg!(unix),
        }
    }

    async fn test_connection(
        &self,
        profile: &ConnectionProfile,
        password: Option<&Secret>,
    ) -> Result<ServerInfo, ConnectError> {
        let connected = connect::open(profile, password).await?;
        let version = connect::server_version(&connected.client).await;
        drop(connected.client);
        // The task ends when the client drops. A join error here does not change the result.
        let _ = connected.task.await;
        Ok(ServerInfo { version: version? })
    }

    async fn connect(
        &self,
        profile: &ConnectionProfile,
        password: Option<&Secret>,
    ) -> Result<Box<dyn Session>, ConnectError> {
        let connected = connect::open(profile, password).await?;
        let info = ServerInfo {
            version: connect::server_version(&connected.client).await?,
        };
        if profile.read_only {
            connect::set_read_only(&connected.client).await?;
        }
        let query_timeout = profile
            .query_timeout_secs
            .map(|secs| Duration::from_secs(u64::from(secs)));
        Ok(Box::new(session::PgSession::new(
            connected.client,
            info,
            profile.tls_mode,
            query_timeout,
        )))
    }
}

/// Opens a connection, reads the server version, and closes the connection.
///
/// # Errors
///
/// Returns a [`ConnectError`] that tells the user what to correct.
pub async fn test_connection(
    profile: &ConnectionProfile,
    password: Option<&Secret>,
) -> Result<ServerInfo, ConnectError> {
    PostgresAdapter.test_connection(profile, password).await
}

//! PostgreSQL adapter.
//!
//! Milestone M1 contains the connection test. Milestone M2 adds query execution
//! behind the `DbAdapter` trait.

mod config;
mod error;
mod tls;

use std::time::Duration;
use tabloxide_core::{
    ConnectError, ConnectErrorKind, ConnectionProfile, Secret, ServerInfo, TlsMode,
};
use tokio_postgres::tls::{MakeTlsConnect, TlsConnect};
use tokio_postgres::{Config, NoTls, Socket};

/// Extra time for the TLS handshake and the authentication after the TCP connection opens.
const HANDSHAKE_GRACE: Duration = Duration::from_secs(5);

async fn probe<T>(config: &Config, tls: T) -> Result<ServerInfo, tokio_postgres::Error>
where
    T: MakeTlsConnect<Socket>,
    T::Stream: Send + 'static,
    T::TlsConnect: Send,
    <T::TlsConnect as TlsConnect<Socket>>::Future: Send,
{
    let (client, connection) = config.connect(tls).await?;
    let connection_task = tokio::spawn(connection);
    let result = client.query_one("SHOW server_version", &[]).await;
    drop(client);
    // The task ends when the client drops. A join error here does not change the result.
    let _ = connection_task.await;
    Ok(ServerInfo {
        version: result?.try_get(0)?,
    })
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
    let config = config::build_config(profile, password)?;
    let limit = Duration::from_secs(u64::from(profile.connect_timeout_secs)) + HANDSHAKE_GRACE;

    let attempt = async {
        match profile.tls_mode {
            TlsMode::Disable => probe(&config, NoTls).await,
            mode => probe(&config, tls::connector(mode)?).await,
        }
        .map_err(|e| error::map_error(&e))
    };

    tokio::time::timeout(limit, attempt)
        .await
        .unwrap_or_else(|_| {
            Err(ConnectError::new(
                ConnectErrorKind::Timeout,
                format!("The server did not answer in {} seconds.", limit.as_secs()),
            ))
        })
}

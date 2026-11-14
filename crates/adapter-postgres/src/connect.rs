//! Opens a connection to the server.

use crate::{config, error, tls};
use std::time::Duration;
use tabloxide_core::{ConnectError, ConnectErrorKind, ConnectionProfile, Secret, TlsMode};
use tokio::task::JoinHandle;
use tokio_postgres::tls::{MakeTlsConnect, TlsConnect};
use tokio_postgres::{Client, Config, NoTls, Socket};

/// Extra time for the TLS handshake and the authentication after the TCP connection opens.
const HANDSHAKE_GRACE: Duration = Duration::from_secs(5);

/// An open connection. The task moves the data between the client and the socket.
/// The task ends when the client drops.
pub(crate) struct Connected {
    pub client: Client,
    pub task: JoinHandle<()>,
}

async fn connect_with<T>(config: &Config, tls: T) -> Result<Connected, tokio_postgres::Error>
where
    T: MakeTlsConnect<Socket>,
    T::Stream: Send + 'static,
    T::TlsConnect: Send,
    <T::TlsConnect as TlsConnect<Socket>>::Future: Send,
{
    let (client, connection) = config.connect(tls).await?;
    let task = tokio::spawn(async move {
        // The client gets the error of a broken connection with its next request.
        let _ = connection.await;
    });
    Ok(Connected { client, task })
}

/// Opens a connection with the settings of `profile`.
pub(crate) async fn open(
    profile: &ConnectionProfile,
    password: Option<&Secret>,
) -> Result<Connected, ConnectError> {
    let config = config::build_config(profile, password)?;
    let limit = Duration::from_secs(u64::from(profile.connect_timeout_secs)) + HANDSHAKE_GRACE;

    let attempt = async {
        match profile.tls_mode {
            TlsMode::Disable => connect_with(&config, NoTls).await,
            mode => connect_with(&config, tls::connector(mode)?).await,
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

/// Reads the server version.
pub(crate) async fn server_version(client: &Client) -> Result<String, ConnectError> {
    let row = client
        .query_one("SHOW server_version", &[])
        .await
        .map_err(|e| error::map_error(&e))?;
    row.try_get(0).map_err(|e| error::map_error(&e))
}

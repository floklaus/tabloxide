//! Opens a connection to the server.

use crate::{config, error, tls};
use std::future::poll_fn;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tabloxide_core::{
    ConnectError, ConnectErrorKind, ConnectionProfile, MAX_STATEMENT_MESSAGES, Secret, TlsMode,
};
use tokio::task::JoinHandle;
use tokio_postgres::error::DbError;
use tokio_postgres::tls::{MakeTlsConnect, TlsConnect};
use tokio_postgres::{AsyncMessage, Client, Config, NoTls, Socket};

/// Extra time for the TLS handshake and the authentication after the TCP connection opens.
const HANDSHAKE_GRACE: Duration = Duration::from_secs(5);

/// An open connection. The task moves the data between the client and the socket.
/// The task ends when the client drops.
pub(crate) struct Connected {
    pub client: Client,
    pub task: JoinHandle<()>,
    pub notices: Notices,
}

/// The notices and the warnings that the server sent since the last `take`, for
/// example the text of `RAISE NOTICE`. The connection task adds them. The session
/// takes them at the end of each statement.
#[derive(Clone, Default)]
pub(crate) struct Notices(Arc<Mutex<Vec<String>>>);

impl Notices {
    /// Adds one message. After the limit, one last message says that more came.
    fn add(&self, text: String) {
        let mut messages = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        match messages.len() {
            count if count < MAX_STATEMENT_MESSAGES => messages.push(text),
            MAX_STATEMENT_MESSAGES => messages.push(format!(
                "The server sent more messages. Only the first {MAX_STATEMENT_MESSAGES} are here."
            )),
            _ => {}
        }
    }

    /// Returns the messages and removes them.
    pub(crate) fn take(&self) -> Vec<String> {
        std::mem::take(
            &mut *self
                .0
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()),
        )
    }
}

/// The text of a notice as `psql` shows it, for example `NOTICE: the text`.
fn notice_text(notice: &DbError) -> String {
    let mut text = format!("{}: {}", notice.severity(), notice.message());
    if let Some(detail) = notice.detail() {
        text.push_str(&format!(" Detail: {detail}"));
    }
    if let Some(hint) = notice.hint() {
        text.push_str(&format!(" Hint: {hint}"));
    }
    text
}

async fn connect_with<T>(config: &Config, tls: T) -> Result<Connected, tokio_postgres::Error>
where
    T: MakeTlsConnect<Socket>,
    T::Stream: Send + Unpin + 'static,
    T::TlsConnect: Send,
    <T::TlsConnect as TlsConnect<Socket>>::Future: Send,
{
    let (client, mut connection) = config.connect(tls).await?;
    let notices = Notices::default();
    let collected = notices.clone();
    let task = tokio::spawn(async move {
        // `poll_message` drives the connection and gives the messages that are not
        // the answer to a request. The client gets the error of a broken connection
        // with its next request.
        while let Some(Ok(message)) = poll_fn(|context| connection.poll_message(context)).await {
            if let AsyncMessage::Notice(notice) = message {
                collected.add(notice_text(&notice));
            }
        }
    });
    Ok(Connected {
        client,
        task,
        notices,
    })
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

/// Makes each transaction of the session read-only. The server then refuses a statement
/// that changes data or the schema. This is a protection against mistakes, not a
/// security control: a statement can set the session back to read-write.
pub(crate) async fn set_read_only(client: &Client) -> Result<(), ConnectError> {
    client
        .batch_execute("SET default_transaction_read_only = on")
        .await
        .map_err(|e| error::map_error(&e))
}

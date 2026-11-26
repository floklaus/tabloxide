//! Makes a Tabloxide database connector from a [`DbAdapter`].
//!
//! A connector in Rust needs only a `main` function:
//!
//! ```no_run
//! # use std::sync::Arc;
//! # fn adapter() -> Arc<dyn tabloxide_core::DbAdapter> { unimplemented!() }
//! #[tokio::main]
//! async fn main() -> Result<(), tabloxide_connector_sdk::ServeError> {
//!     tabloxide_connector_sdk::serve(adapter(), env!("CARGO_PKG_VERSION")).await
//! }
//! ```
//!
//! `serve` follows the start and stop rules of section 4 of `docs/Connector Design.md`:
//! it listens on `127.0.0.1` with a port that the operating system selects, writes the
//! port line to standard output, refuses each request without the token, and stops
//! when its standard input closes.

mod service;

use service::ConnectorService;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;
use tabloxide_connector_protocol::v1::connector_server::ConnectorServer;
use tabloxide_connector_protocol::{TOKEN_ENV, TOKEN_HEADER, port_line};
use tabloxide_core::DbAdapter;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio_stream::wrappers::TcpListenerStream;
use tonic::{Request, Status};

/// A failure that stops the connector.
#[derive(Debug, thiserror::Error)]
pub enum ServeError {
    #[error(
        "The environment variable {TOKEN_ENV} is not set. Tabloxide starts a connector with a token."
    )]
    MissingToken,
    #[error("The connector cannot listen: {0}")]
    Listen(#[source] std::io::Error),
    #[error("The connector cannot write its port: {0}")]
    WritePort(#[source] std::io::Error),
    #[error("The gRPC server stopped: {0}")]
    Server(#[from] tonic::transport::Error),
}

/// Compares two byte strings in a time that does not depend on the position of the
/// first difference.
fn same_bytes(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0_u8, |diff, (x, y)| diff | (x ^ y)) == 0
}

/// Returns a check that refuses each request without the header `authorization: Bearer <token>`.
fn token_check(token: String) -> impl Fn(Request<()>) -> Result<Request<()>, Status> + Clone {
    let expected = format!("Bearer {token}");
    move |request: Request<()>| {
        let given = request
            .metadata()
            .get(TOKEN_HEADER)
            .map(tonic::metadata::MetadataValue::as_bytes);
        match given {
            Some(given) if same_bytes(given, expected.as_bytes()) => Ok(request),
            _ => Err(Status::unauthenticated("The token is not correct.")),
        }
    }
}

/// Serves `adapter` on `listener` until `shutdown` completes.
///
/// # Errors
///
/// Returns an error if the gRPC server stops with a failure.
pub async fn serve_on(
    listener: TcpListener,
    token: String,
    adapter: Arc<dyn DbAdapter>,
    connector_version: &str,
    shutdown: impl Future<Output = ()> + Send,
) -> Result<(), ServeError> {
    let service = ConnectorService::new(adapter, connector_version);
    let server = ConnectorServer::with_interceptor(service, token_check(token));
    tonic::transport::Server::builder()
        .add_service(server)
        .serve_with_incoming_shutdown(TcpListenerStream::new(listener), shutdown)
        .await?;
    Ok(())
}

/// Completes when the standard input closes. Tabloxide holds the input of the
/// connector open while it runs.
async fn input_closed() {
    let mut input = tokio::io::stdin();
    let mut buffer = [0_u8; 64];
    while matches!(input.read(&mut buffer).await, Ok(count) if count > 0) {}
}

/// Serves `adapter` as a connector, with the start and stop rules of Tabloxide.
///
/// # Errors
///
/// Returns an error if the token is missing, if the connector cannot listen, or if the
/// gRPC server stops with a failure.
pub async fn serve(adapter: Arc<dyn DbAdapter>, connector_version: &str) -> Result<(), ServeError> {
    let token = std::env::var(TOKEN_ENV)
        .ok()
        .filter(|token| !token.is_empty())
        .ok_or(ServeError::MissingToken)?;
    let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
        .await
        .map_err(ServeError::Listen)?;
    let port = listener.local_addr().map_err(ServeError::Listen)?.port();
    let mut out = tokio::io::stdout();
    out.write_all(format!("{}\n", port_line(port)).as_bytes())
        .await
        .map_err(ServeError::WritePort)?;
    out.flush().await.map_err(ServeError::WritePort)?;
    serve_on(listener, token, adapter, connector_version, input_closed()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_bytes_needs_the_same_length_and_content() {
        assert!(same_bytes(b"abc", b"abc"));
        assert!(!same_bytes(b"abc", b"abd"));
        assert!(!same_bytes(b"abc", b"ab"));
    }

    #[test]
    fn the_check_needs_the_bearer_token() {
        let check = token_check("t0k".to_owned());
        let with = |value: &str| {
            let mut request = Request::new(());
            request
                .metadata_mut()
                .insert(TOKEN_HEADER, value.parse().unwrap());
            request
        };

        assert!(check(with("Bearer t0k")).is_ok());
        assert!(check(with("Bearer other")).is_err());
        assert!(check(with("t0k")).is_err());
        assert!(check(Request::new(())).is_err());
    }
}

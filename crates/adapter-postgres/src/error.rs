//! Conversion of driver errors to errors that tell the user what to correct.

use std::error::Error;
use tabloxide_core::{ConnectError, ConnectErrorKind, QueryError, QueryErrorKind};
use tokio_postgres::error::ErrorPosition;
use tokio_postgres::error::SqlState;

fn sources<'a>(
    error: &'a (dyn Error + 'static),
) -> impl Iterator<Item = &'a (dyn Error + 'static)> {
    std::iter::successors(Some(error), |e| (*e).source())
}

/// Joins the messages of the error and its causes. Driver messages do not contain the password.
fn detail(error: &tokio_postgres::Error) -> String {
    let mut parts: Vec<String> = Vec::new();
    for message in sources(error).map(ToString::to_string) {
        if !parts.iter().any(|part| part.contains(&message)) {
            parts.push(message);
        }
    }
    parts.join(": ")
}

fn kind_of_sql_state(state: &SqlState) -> ConnectErrorKind {
    if *state == SqlState::INVALID_PASSWORD
        || *state == SqlState::INVALID_AUTHORIZATION_SPECIFICATION
    {
        ConnectErrorKind::Authentication
    } else if *state == SqlState::INVALID_CATALOG_NAME {
        ConnectErrorKind::DatabaseNotFound
    } else {
        ConnectErrorKind::Other
    }
}

/// The TLS library reports a handshake failure as an I/O error that contains a TLS error.
fn is_tls_failure(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::InvalidData
        || error
            .get_ref()
            .is_some_and(|inner| inner.is::<rustls::Error>())
}

fn kind_of_io_error(error: &std::io::Error) -> ConnectErrorKind {
    if is_tls_failure(error) {
        return ConnectErrorKind::Tls;
    }
    match error.kind() {
        std::io::ErrorKind::TimedOut => ConnectErrorKind::Timeout,
        _ => ConnectErrorKind::Unreachable,
    }
}

fn kind_of(error: &tokio_postgres::Error) -> ConnectErrorKind {
    if let Some(state) = error.code() {
        return kind_of_sql_state(state);
    }
    let causes = || sources(error).skip(1);
    if causes().any(|e| e.is::<rustls::Error>()) {
        return ConnectErrorKind::Tls;
    }
    if let Some(io) = causes().find_map(|e| e.downcast_ref::<std::io::Error>()) {
        return kind_of_io_error(io);
    }
    let text = detail(error).to_lowercase();
    if text.contains("tls") {
        ConnectErrorKind::Tls
    } else if text.contains("password missing") {
        ConnectErrorKind::MissingSecret
    } else if text.contains("timed out") || text.contains("timeout") {
        ConnectErrorKind::Timeout
    } else if text.contains("authentication") {
        ConnectErrorKind::Authentication
    } else {
        ConnectErrorKind::Other
    }
}

pub(crate) fn map_error(error: &tokio_postgres::Error) -> ConnectError {
    let message = error
        .as_db_error()
        .map_or_else(|| detail(error), |db| db.message().to_owned());
    ConnectError::new(kind_of(error), message)
}

/// SQLSTATE class 08 is a connection exception. The codes 57P01 to 57P03 are a shutdown
/// of the server or of the session by an administrator.
fn is_connection_loss(code: &str) -> bool {
    code.starts_with("08") || matches!(code, "57P01" | "57P02" | "57P03")
}

/// Converts a driver error of a statement to a query error.
pub(crate) fn map_query_error(error: &tokio_postgres::Error) -> QueryError {
    let Some(db) = error.as_db_error() else {
        return if error.is_closed() {
            QueryError::new(
                QueryErrorKind::ConnectionLost,
                "The connection to the server closed.",
            )
        } else {
            QueryError::new(QueryErrorKind::Other, detail(error))
        };
    };
    let code = db.code().code();
    let kind = if *db.code() == SqlState::QUERY_CANCELED {
        QueryErrorKind::Cancelled
    } else if is_connection_loss(code) {
        QueryErrorKind::ConnectionLost
    } else {
        QueryErrorKind::Database
    };
    let position = match db.position() {
        Some(ErrorPosition::Original(position)) => Some(*position),
        _ => None,
    };
    QueryError {
        kind,
        message: db.message().to_owned(),
        detail: db.detail().map(str::to_owned),
        hint: db.hint().map(str::to_owned),
        code: Some(db.code().code().to_owned()),
        position,
    }
}

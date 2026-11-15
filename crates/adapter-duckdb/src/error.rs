//! Conversion of DuckDB errors.

use serde_json::Value;
use tabloxide_core::{ConnectError, ConnectErrorKind, QueryError, QueryErrorKind};

/// DuckDB writes it in capital letters. The comparison ignores the case.
const INTERRUPT_TYPE: &str = "interrupt";

/// Converts an error message of DuckDB to a query error.
///
/// With the setting `errors_as_json`, the message is a JSON object, with or without
/// the error type before it. `offset` is the number of characters that the adapter
/// put before the statement of the user. The function subtracts it from the position.
pub(crate) fn query_error(message: &str, offset: usize) -> QueryError {
    let Some(json) = message
        .find('{')
        .and_then(|start| serde_json::from_str::<Value>(&message[start..]).ok())
    else {
        return plain_error(message);
    };
    let field = |name: &str| json.get(name).and_then(Value::as_str);
    let Some(text) = field("exception_message") else {
        return plain_error(message);
    };
    let exception_type = field("exception_type").unwrap_or("Unknown");
    let kind = if exception_type.eq_ignore_ascii_case(INTERRUPT_TYPE) {
        QueryErrorKind::Cancelled
    } else {
        QueryErrorKind::Database
    };
    // DuckDB counts from 0. The position of a query error counts from 1.
    let position = field("position")
        .and_then(|position| position.parse::<usize>().ok())
        .and_then(|position| position.checked_sub(offset))
        .and_then(|position| u32::try_from(position + 1).ok());
    // The first line is the problem. The other lines are advice, for example "Did you mean".
    let (first, rest) = text.split_once('\n').unwrap_or((text, ""));
    QueryError {
        kind,
        message: format!("{exception_type} Error: {first}"),
        detail: None,
        hint: Some(rest.trim().to_owned()).filter(|hint| !hint.is_empty()),
        code: None,
        position,
    }
}

fn plain_error(message: &str) -> QueryError {
    let kind = if message.contains("INTERRUPT Error") {
        QueryErrorKind::Cancelled
    } else {
        QueryErrorKind::Database
    };
    QueryError::new(kind, message.trim())
}

/// The session thread stopped. This occurs only after a defect in the adapter.
pub(crate) fn session_closed() -> QueryError {
    QueryError::new(
        QueryErrorKind::ConnectionLost,
        "The database session closed. Run the statement again to open a new session.",
    )
}

/// Converts an error of DuckDB at the open of a database file.
pub(crate) fn open_error(message: &str) -> ConnectError {
    let text = query_error(message, 0).message;
    if text.contains("Could not set lock") || text.contains("Conflicting lock") {
        return ConnectError::new(
            ConnectErrorKind::Other,
            format!(
                "A different program has the database file open. Close that program, or make this connection and the other program read-only. {text}"
            ),
        );
    }
    ConnectError::new(ConnectErrorKind::Other, text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_type_the_message_the_hint_and_the_position() {
        let message = r#"Catalog Error: {"exception_type":"Catalog","exception_message":"Table with name nope does not exist!\nDid you mean \"pg_enum\"?","position":"14"}"#;

        let error = query_error(message, 0);

        assert_eq!(error.kind, QueryErrorKind::Database);
        assert_eq!(
            error.message,
            "Catalog Error: Table with name nope does not exist!"
        );
        assert_eq!(error.hint.as_deref(), Some("Did you mean \"pg_enum\"?"));
        assert_eq!(error.position, Some(15));
    }

    #[test]
    fn subtracts_the_text_that_the_adapter_put_before_the_statement() {
        let message = r#"{"exception_type":"Conversion","exception_message":"Could not convert","position":"59"}"#;

        assert_eq!(query_error(message, 42).position, Some(18));
        // A position in the text of the adapter is not a position in the statement.
        assert_eq!(query_error(message, 60).position, None);
    }

    #[test]
    fn an_interrupt_is_a_cancel() {
        let json = r#"{"exception_type":"INTERRUPT","exception_message":"Interrupted!"}"#;

        assert_eq!(query_error(json, 0).kind, QueryErrorKind::Cancelled);
        assert_eq!(
            query_error("INTERRUPT Error: Interrupted!", 0).kind,
            QueryErrorKind::Cancelled
        );
    }

    #[test]
    fn keeps_a_message_that_is_not_json() {
        let error = query_error("IO Error: disk full {not json", 0);

        assert_eq!(error.message, "IO Error: disk full {not json");
        assert_eq!(error.position, None);
    }

    #[test]
    fn explains_a_file_that_a_different_program_has_open() {
        let error = open_error(
            "IO Error: Could not set lock on file \"a.duckdb\": Conflicting lock is held",
        );

        assert!(
            error.detail.starts_with("A different program has"),
            "{}",
            error.detail
        );
        assert!(error.detail.contains("a.duckdb"));
    }
}

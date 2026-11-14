//! Query history entries.

use serde::{Deserialize, Serialize};
use tabloxide_core::sql::{can_contain_password, utf16_to_byte};
use tabloxide_core::{ConnectionId, Outcome, QueryErrorKind, RunReport};

/// Text that replaces a statement that the history does not record.
pub const NOT_RECORDED: &str = "-- Not recorded: the statement can contain a password.";

/// Longest statement text that the history keeps, in bytes.
const MAX_SQL_BYTES: usize = 100_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
pub enum HistoryStatus {
    Ok,
    Failed,
    Cancelled,
}

impl HistoryStatus {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    pub(crate) fn parse(text: &str) -> Self {
        match text {
            "ok" => Self::Ok,
            "cancelled" => Self::Cancelled,
            _ => Self::Failed,
        }
    }
}

/// A statement that ran, before the history stores it.
/// The entry has the name of the connection, but no host, no user, and no password.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewHistoryEntry {
    pub connection_id: ConnectionId,
    pub connection_name: String,
    pub sql: String,
    pub elapsed_ms: u64,
    pub status: HistoryStatus,
    pub rows: Option<u64>,
    pub error: Option<String>,
}

/// A statement in the history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct HistoryEntry {
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub id: i64,
    pub connection_id: ConnectionId,
    pub connection_name: String,
    pub sql: String,
    /// Time of the run, in seconds since 1970-01-01 UTC.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub executed_at_secs: i64,
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub elapsed_ms: u64,
    pub status: HistoryStatus,
    #[cfg_attr(feature = "specta", specta(type = Option<u32>))]
    pub rows: Option<u64>,
    pub error: Option<String>,
}

fn truncate(text: &str) -> &str {
    if text.len() <= MAX_SQL_BYTES {
        return text;
    }
    let mut end = MAX_SQL_BYTES;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

/// Makes one history entry for each statement of a run.
///
/// The text of a statement that can contain a password is not recorded,
/// and the error message of that statement is not recorded.
#[must_use]
pub fn entries_from_report(
    sql: &str,
    report: &RunReport,
    connection_id: &ConnectionId,
    connection_name: &str,
) -> Vec<NewHistoryEntry> {
    report
        .statements
        .iter()
        .map(|statement| {
            let from = utf16_to_byte(sql, statement.range.from);
            let to = utf16_to_byte(sql, statement.range.to);
            let text = &sql[from..to];
            let is_secret = can_contain_password(text);
            let (status, rows, error) = match &statement.outcome {
                Outcome::Rows { total_rows, .. } => (HistoryStatus::Ok, *total_rows, None),
                Outcome::Command { affected_rows } => {
                    (HistoryStatus::Ok, Some(*affected_rows), None)
                }
                Outcome::Failed { error, .. } if error.kind == QueryErrorKind::Cancelled => {
                    (HistoryStatus::Cancelled, None, None)
                }
                Outcome::Failed { error, .. } => {
                    (HistoryStatus::Failed, None, Some(error.message.clone()))
                }
            };
            NewHistoryEntry {
                connection_id: connection_id.clone(),
                connection_name: connection_name.to_owned(),
                sql: if is_secret {
                    NOT_RECORDED.to_owned()
                } else {
                    truncate(text).to_owned()
                },
                elapsed_ms: statement.elapsed_ms,
                status,
                rows,
                error: error.filter(|_| !is_secret),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tabloxide_core::{QueryError, StatementReport, TextRange};

    fn statement(from: u32, to: u32, outcome: Outcome) -> StatementReport {
        StatementReport {
            range: TextRange { from, to },
            elapsed_ms: 5,
            outcome,
        }
    }

    fn failed(kind: QueryErrorKind, message: &str) -> Outcome {
        Outcome::Failed {
            error: QueryError::new(kind, message),
            location: None,
        }
    }

    fn entries(sql: &str, statements: Vec<StatementReport>) -> Vec<NewHistoryEntry> {
        let report = RunReport {
            statements,
            open_result: None,
        };
        entries_from_report(sql, &report, &ConnectionId::from("c1"), "Local")
    }

    #[test]
    fn makes_one_entry_for_each_statement() {
        let sql = "select 'ü'; update t set a = 1; select x";
        let result = entries(
            sql,
            vec![
                statement(
                    0,
                    10,
                    Outcome::Rows {
                        columns: vec![],
                        rows: vec![],
                        is_complete: true,
                        total_rows: Some(1),
                    },
                ),
                statement(12, 30, Outcome::Command { affected_rows: 7 }),
                statement(32, 40, failed(QueryErrorKind::Database, "no column x")),
            ],
        );

        assert_eq!(result[0].sql, "select 'ü'");
        assert_eq!(
            (result[0].status, result[0].rows),
            (HistoryStatus::Ok, Some(1))
        );
        assert_eq!(result[1].sql, "update t set a = 1");
        assert_eq!(result[1].rows, Some(7));
        assert_eq!(result[2].status, HistoryStatus::Failed);
        assert_eq!(result[2].error.as_deref(), Some("no column x"));
        assert_eq!(result[2].connection_name, "Local");
    }

    #[test]
    fn a_cancelled_statement_has_the_cancelled_status() {
        let result = entries(
            "select 1",
            vec![statement(
                0,
                8,
                failed(QueryErrorKind::Cancelled, "cancelled"),
            )],
        );

        assert_eq!(result[0].status, HistoryStatus::Cancelled);
        assert_eq!(result[0].error, None);
    }

    #[test]
    fn does_not_record_a_statement_that_can_contain_a_password() {
        let sql = "alter role app password 's3cr3t'";
        let result = entries(
            sql,
            vec![statement(0, 32, failed(QueryErrorKind::Database, "s3cr3t"))],
        );

        assert_eq!(result[0].sql, NOT_RECORDED);
        assert_eq!(result[0].error, None);
        assert!(!format!("{result:?}").contains("s3cr3t"));
    }

    #[test]
    fn truncates_a_very_long_statement_at_a_character_border() {
        let sql = format!("select '{}'", "ü".repeat(MAX_SQL_BYTES));
        let length = u32::try_from(sql.encode_utf16().count()).unwrap();

        let result = entries(
            &sql,
            vec![statement(0, length, Outcome::Command { affected_rows: 0 })],
        );

        assert!(result[0].sql.len() <= MAX_SQL_BYTES);
        assert!(result[0].sql.starts_with("select 'ü"));
    }
}

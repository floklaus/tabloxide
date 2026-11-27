//! The thread of one session.
//!
//! The DuckDB API blocks, and a result stream borrows its statement and its
//! connection. Thus one thread owns the three and gets its work through a channel.

use crate::error::query_error;
use crate::instance::{Instances, Target};
use crate::{catalog, text};
use duckdb::arrow::array::Array;
use duckdb::arrow::datatypes::{DataType, Schema};
use duckdb::arrow::record_batch::RecordBatch;
use duckdb::{ArrowStream, Connection, InterruptHandle};
use std::sync::Arc;
use std::sync::mpsc::Receiver;
use tabloxide_core::sql::is_pageable;
use tabloxide_core::{
    Column, Completion, ConnectError, Page, QueryError, QueryErrorKind, RelationDetail,
    RelationInfo, Row, SchemaInfo,
};
use tokio::sync::oneshot;

/// The adapter puts a read statement between these two texts. DuckDB then converts
/// each value to text, in the same form as its command line program.
/// The line feeds keep a comment at the end of the statement away from the parenthesis.
const TEXT_PREFIX: &str = "SELECT CAST(COLUMNS(*) AS VARCHAR) FROM (\n";
const TEXT_SUFFIX: &str = "\n)";
const DESCRIBE_PREFIX: &str = "DESCRIBE ";

type Reply<T> = oneshot::Sender<Result<T, QueryError>>;

/// One unit of work for the session thread.
pub(crate) enum Command {
    /// Starts a statement. The answer has the columns, or `None` for a statement
    /// that returns no rows.
    Execute {
        sql: String,
        reply: Reply<Option<Vec<Column>>>,
    },
    /// Reads rows of the open result.
    NextPage {
        max_rows: usize,
        reply: Reply<Page>,
    },
    CloseResult,
    Schemas {
        reply: Reply<Vec<SchemaInfo>>,
    },
    Relations {
        schema: String,
        reply: Reply<Vec<RelationInfo>>,
    },
    RelationDetail {
        schema: String,
        relation: String,
        reply: Reply<RelationDetail>,
    },
}

/// What the session thread tells its session after the database is open.
pub(crate) struct Started {
    pub version: String,
    pub interrupt: Arc<InterruptHandle>,
}

fn database_error(error: &duckdb::Error) -> QueryError {
    query_error(&error.to_string(), 0)
}

/// Sends an answer. The receiver is gone only when its session stopped to wait.
fn send<T>(reply: oneshot::Sender<T>, value: T) {
    let _ = reply.send(value);
}

/// Runs the session thread until its session drops the command channel.
pub(crate) fn run(
    instances: &Arc<Instances>,
    target: &Target,
    ready: oneshot::Sender<Result<Started, ConnectError>>,
    commands: &Receiver<Command>,
) {
    let (connection, lease) = match instances.connect(target) {
        Ok(connected) => connected,
        Err(error) => return send(ready, Err(error)),
    };
    // Rust drops local values in the opposite sequence of their declaration.
    // The connection must close before the lease ends, so it comes last.
    let _lease = lease;
    let connection = connection;
    let version = connection
        .query_row("SELECT version()", [], |row| row.get::<_, String>(0))
        .unwrap_or_default();
    send(
        ready,
        Ok(Started {
            version: format!("DuckDB {version}"),
            interrupt: connection.interrupt_handle(),
        }),
    );

    let mut next = commands.recv().ok();
    while let Some(command) = next {
        next = match command {
            Command::Execute { sql, reply } => serve_statement(&connection, &sql, reply, commands),
            other => {
                serve_idle(&connection, other);
                commands.recv().ok()
            }
        };
    }
}

/// Does a command that is not a statement.
fn serve_idle(connection: &Connection, command: Command) {
    match command {
        Command::Schemas { reply } => send(
            reply,
            catalog::schemas(connection).map_err(|e| database_error(&e)),
        ),
        Command::Relations { schema, reply } => send(
            reply,
            catalog::relations(connection, &schema).map_err(|e| database_error(&e)),
        ),
        Command::RelationDetail {
            schema,
            relation,
            reply,
        } => send(
            reply,
            catalog::relation_detail(connection, &schema, &relation)
                .map_err(|e| database_error(&e)),
        ),
        Command::NextPage { reply, .. } => send(
            reply,
            Err(QueryError::new(
                QueryErrorKind::Other,
                "The result is not open any more.",
            )),
        ),
        // `run` does each statement. A close without an open result needs no work.
        Command::Execute { .. } | Command::CloseResult => {}
    }
}

/// Reads the column names and types of a read statement. DuckDB does not run the statement.
fn describe(connection: &Connection, sql: &str) -> duckdb::Result<Vec<Column>> {
    let mut statement = connection.prepare(&format!("{DESCRIBE_PREFIX}{sql}"))?;
    let rows = statement.query_map([], |row| {
        let type_name: String = row.get(1)?;
        Ok(Column {
            name: row.get(0)?,
            kind: text::kind_of_type_name(&type_name),
            type_name: Some(type_name),
        })
    })?;
    rows.collect()
}

/// Runs one statement and serves its result. Returns the next command for the thread,
/// or `None` if the session ended.
fn serve_statement(
    connection: &Connection,
    sql: &str,
    reply: Reply<Option<Vec<Column>>>,
    commands: &Receiver<Command>,
) -> Option<Command> {
    let is_read = is_pageable(sql);
    if is_read {
        // If DuckDB cannot describe the statement, the statement runs without the
        // text conversion. Then its own error, with the correct position, goes to the user.
        if let Ok(columns) = describe(connection, sql) {
            let request = Request {
                sql: &format!("{TEXT_PREFIX}{sql}{TEXT_SUFFIX}"),
                added_chars: TEXT_PREFIX.chars().count(),
                columns: Some(columns),
                is_read,
            };
            return serve_result(connection, &request, reply, commands);
        }
    }
    let request = Request {
        sql,
        added_chars: 0,
        columns: None,
        is_read,
    };
    serve_result(connection, &request, reply, commands)
}

struct Request<'a> {
    sql: &'a str,
    /// Number of characters that the adapter put before the statement of the user.
    added_chars: usize,
    /// The columns, if `describe` gave them.
    columns: Option<Vec<Column>>,
    is_read: bool,
}

/// DuckDB answers a statement that returns no rows with one column: `Count` with the
/// number of changed rows, or `Success`.
fn is_command_result(schema: &Schema) -> bool {
    let [field] = schema.fields().as_ref() else {
        return schema.fields().is_empty();
    };
    matches!(
        (field.name().as_str(), field.data_type()),
        ("Count", DataType::Int64) | ("Success", DataType::Boolean)
    )
}

fn serve_result(
    connection: &Connection,
    request: &Request<'_>,
    reply: Reply<Option<Vec<Column>>>,
    commands: &Receiver<Command>,
) -> Option<Command> {
    let to_error = |error: duckdb::Error| query_error(&error.to_string(), request.added_chars);
    let mut statement = match connection.prepare(request.sql) {
        Ok(statement) => statement,
        Err(error) => {
            send(reply, Err(to_error(error)));
            return commands.recv().ok();
        }
    };
    let stream = match statement.stream_arrow([]) {
        Ok(stream) => stream,
        Err(error) => {
            send(reply, Err(to_error(error)));
            return commands.recv().ok();
        }
    };
    let schema = stream.get_schema();
    let is_command = !request.is_read && is_command_result(&schema);
    let columns = (!is_command).then(|| {
        request
            .columns
            .clone()
            .unwrap_or_else(|| text::columns_of_batch_schema(&schema))
    });
    let mut cursor = Cursor {
        stream,
        batch: None,
        row: 0,
        total: 0,
        is_command,
        is_at_end: false,
        added_chars: request.added_chars,
    };
    // DuckDB starts a streamed statement immediately and does the work at the first
    // read. Read the first rows now. Then the query timeout and an error of the
    // statement apply to the start of the statement, as for a database server.
    if !is_command {
        match cursor.next_batch() {
            Ok(Some(batch)) => cursor.batch = Some(batch),
            Ok(None) => cursor.is_at_end = true,
            Err(error) => {
                send(reply, Err(error));
                return commands.recv().ok();
            }
        }
    }
    send(reply, Ok(columns));
    loop {
        match commands.recv() {
            Ok(Command::NextPage { max_rows, reply }) => {
                let page = cursor.next_page(max_rows);
                let is_done = page.as_ref().map_or(true, |page| page.end.is_some());
                send(reply, page);
                if is_done {
                    return commands.recv().ok();
                }
            }
            Ok(Command::CloseResult) => return commands.recv().ok(),
            // A different command closes the result. DuckDB needs no cancel for that.
            Ok(other) => return Some(other),
            Err(_) => return None,
        }
    }
}

/// The read position in an open result.
struct Cursor<'a> {
    stream: ArrowStream<'a>,
    /// The batch that is not fully read.
    batch: Option<RecordBatch>,
    /// The next row of `batch`.
    row: usize,
    total: u64,
    is_command: bool,
    /// `true` after the stream gave its last batch.
    is_at_end: bool,
    added_chars: usize,
}

impl Cursor<'_> {
    fn next_batch(&mut self) -> Result<Option<RecordBatch>, QueryError> {
        if self.is_at_end {
            return Ok(None);
        }
        let batch = self
            .stream
            .next()
            .transpose()
            .map_err(|error| query_error(&error.to_string(), self.added_chars))?;
        self.is_at_end = batch.is_none();
        Ok(batch)
    }

    fn next_page(&mut self, max_rows: usize) -> Result<Page, QueryError> {
        if self.is_command {
            return self.complete_command();
        }
        let max_rows = max_rows.max(1);
        let mut rows: Vec<Row> = Vec::new();
        while rows.len() < max_rows {
            let batch = match self.batch.take() {
                Some(batch) => batch,
                None => match self.next_batch()? {
                    Some(batch) => batch,
                    None => {
                        let end = Some(Completion::new(self.total));
                        return Ok(Page { rows, end });
                    }
                },
            };
            let end = batch.num_rows().min(self.row + max_rows - rows.len());
            rows.extend(text::rows_of_batch(&batch, self.row, end));
            self.total += (end - self.row) as u64;
            self.row = end;
            if end < batch.num_rows() {
                self.batch = Some(batch);
            } else {
                self.row = 0;
            }
        }
        Ok(Page { rows, end: None })
    }

    /// Reads the number of changed rows of a statement that returns no rows.
    fn complete_command(&mut self) -> Result<Page, QueryError> {
        let mut affected_rows = 0;
        while let Some(batch) = self.next_batch()? {
            let count = batch
                .column(0)
                .as_any()
                .downcast_ref::<duckdb::arrow::array::Int64Array>()
                .filter(|counts| !counts.is_empty() && !counts.is_null(0))
                .map_or(0, |counts| counts.value(0));
            affected_rows += u64::try_from(count).unwrap_or(0);
        }
        Ok(Page {
            rows: Vec::new(),
            end: Some(Completion::new(affected_rows)),
        })
    }
}

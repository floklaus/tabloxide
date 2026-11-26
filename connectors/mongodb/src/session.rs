//! One MongoDB session: it runs statements and reads the catalog.

use crate::catalog;
use crate::connect::query_error;
use crate::plan::{Limits, Output, Plan, is_read, plan};
use crate::rows::Shape;
use async_trait::async_trait;
use futures_util::TryStreamExt;
use mongodb::bson::{Bson, Document, doc};
use mongodb::{Client, Cursor};
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Duration;
use tabloxide_core::mongo::parse_statement;
use tabloxide_core::{
    CancelHandle, Column, Completion, Page, QueryError, QueryErrorKind, RelationDetail,
    RelationInfo, ResultStream, SchemaInfo, ServerInfo, Session,
};
use tokio::sync::watch;

/// Number of documents that the session reads before it sends the columns.
pub const FIRST_PAGE: usize = 500;

/// Extra time after the query timeout before the session stops waiting. The server
/// stops a read with `maxTimeMS` first, with a better message.
const TIMEOUT_GRACE: Duration = Duration::from_secs(2);

fn cancelled() -> QueryError {
    QueryError::new(QueryErrorKind::Cancelled, "The statement was cancelled.")
}

/// Completes when a cancel comes. A cancel that came before `subscribe` does not count.
async fn cancel_signal(mut signal: watch::Receiver<u64>) {
    if signal.changed().await.is_err() {
        std::future::pending::<()>().await;
    }
}

/// Cancels the active statement of a session.
struct MongoCancel(Arc<watch::Sender<u64>>);

#[async_trait]
impl CancelHandle for MongoCancel {
    async fn cancel(&self) -> Result<(), QueryError> {
        self.0
            .send_modify(|generation| *generation = generation.wrapping_add(1));
        Ok(())
    }
}

pub struct MongoSession {
    client: Client,
    database: String,
    info: ServerInfo,
    read_only: bool,
    query_timeout: Option<Duration>,
    cancel: Arc<watch::Sender<u64>>,
}

impl MongoSession {
    pub fn new(
        client: Client,
        database: String,
        info: ServerInfo,
        read_only: bool,
        query_timeout_secs: Option<u32>,
    ) -> Self {
        Self {
            client,
            database,
            info,
            read_only,
            query_timeout: query_timeout_secs.map(|secs| Duration::from_secs(u64::from(secs))),
            cancel: Arc::new(watch::channel(0).0),
        }
    }

    fn limits(&self) -> Limits {
        Limits {
            max_time_ms: self
                .query_timeout
                .map(|timeout| i64::try_from(timeout.as_millis()).unwrap_or(i64::MAX)),
        }
    }

    /// Runs `operation` until it completes, a cancel comes, or the timeout ends.
    async fn guard<T>(
        &self,
        operation: impl IntoFuture<Output = Result<T, mongodb::error::Error>>,
    ) -> Result<T, QueryError> {
        let operation = operation.into_future();
        let signal = cancel_signal(self.cancel.subscribe());
        let limit = async {
            match self.query_timeout {
                Some(timeout) => tokio::time::sleep(timeout + TIMEOUT_GRACE).await,
                None => std::future::pending().await,
            }
        };
        tokio::select! {
            result = operation => result.map_err(|error| query_error(&error)),
            () = signal => Err(cancelled()),
            () = limit => Err(QueryError::new(QueryErrorKind::Timeout, "The statement did not end in the query timeout of the connection.")),
        }
    }

    async fn run_plan(&mut self, plan: Plan) -> Result<Box<dyn ResultStream>, QueryError> {
        match plan {
            Plan::Use(database) => {
                if !is_valid_database_name(&database) {
                    return Err(QueryError::new(
                        QueryErrorKind::Database,
                        format!("`{database}` is not a valid database name."),
                    ));
                }
                self.database = database;
                Ok(Box::new(ChangeStream(0)))
            }
            Plan::ShowDatabases => {
                let databases = self.guard(self.client.list_databases()).await?;
                let documents = databases
                    .into_iter()
                    .map(|database| doc! { "name": database.name, "sizeOnDisk": Bson::Int64(i64::try_from(database.size_on_disk).unwrap_or(i64::MAX)), "empty": database.empty })
                    .collect();
                Ok(DocumentStream::from_documents(
                    documents,
                    self.cancel.subscribe(),
                ))
            }
            Plan::Constant(document) => Ok(DocumentStream::from_documents(
                vec![document],
                self.cancel.subscribe(),
            )),
            Plan::Command {
                database,
                command,
                output,
            } => self.run_command(&database, command, output).await,
        }
    }

    async fn run_command(
        &self,
        database: &str,
        command: Document,
        output: Output,
    ) -> Result<Box<dyn ResultStream>, QueryError> {
        let database = self.client.database(database);
        if output == Output::Cursor {
            let cursor = self.guard(database.run_cursor_command(command)).await?;
            return DocumentStream::from_cursor(cursor, self.cancel.subscribe()).await;
        }
        let answer = self.guard(database.run_command(command)).await?;
        check_write_errors(&answer)?;
        let documents = match output {
            Output::Cursor => unreachable!("handled above"),
            Output::Document => vec![without_cluster_fields(answer)],
            Output::Field { field, column } => {
                vec![doc! { column: answer.get(field).cloned().unwrap_or(Bson::Null) }]
            }
            Output::Array { field, column } => array_rows(&answer, field, column.as_deref()),
            Output::Change { count } => {
                return Ok(Box::new(ChangeStream(changed_count(&answer, count))));
            }
        };
        Ok(DocumentStream::from_documents(
            documents,
            self.cancel.subscribe(),
        ))
    }
}

/// A database name of MongoDB cannot be empty and cannot have these characters.
fn is_valid_database_name(name: &str) -> bool {
    !name.is_empty() && name.len() < 64 && !name.chars().any(|c| "/\\. \"$".contains(c))
}

/// Removes the fields of the cluster that are not part of the answer.
fn without_cluster_fields(answer: Document) -> Document {
    answer
        .into_iter()
        .filter(|(key, _)| !key.starts_with('$') && key != "operationTime")
        .collect()
}

fn array_rows(answer: &Document, field: &str, column: Option<&str>) -> Vec<Document> {
    let items = match answer.get(field) {
        Some(Bson::Array(items)) => items.clone(),
        Some(Bson::Null) | None => Vec::new(),
        Some(other) => vec![other.clone()],
    };
    items
        .into_iter()
        .map(|item| match item {
            Bson::Document(document) => document,
            other => doc! { column.unwrap_or("value"): other },
        })
        .collect()
}

/// A write command has `ok: 1` also when a write failed. The failures are in `writeErrors`.
fn check_write_errors(answer: &Document) -> Result<(), QueryError> {
    let Ok(errors) = answer.get_array("writeErrors") else {
        return Ok(());
    };
    let Some(Bson::Document(first)) = errors.first() else {
        return Ok(());
    };
    Err(QueryError {
        code: first.get_i32("code").ok().map(|code| code.to_string()),
        detail: (errors.len() > 1).then(|| format!("{} writes failed.", errors.len())),
        ..QueryError::new(
            QueryErrorKind::Database,
            first
                .get_str("errmsg")
                .unwrap_or("A write failed.")
                .to_owned(),
        )
    })
}

fn changed_count(answer: &Document, fields: &[&str]) -> u64 {
    fields
        .iter()
        .map(|field| match answer.get(*field) {
            Some(Bson::Int32(n)) => u64::try_from(*n).unwrap_or(0),
            Some(Bson::Int64(n)) => u64::try_from(*n).unwrap_or(0),
            Some(Bson::Array(items)) => items.len() as u64,
            _ => 0,
        })
        .sum()
}

#[async_trait]
impl Session for MongoSession {
    fn server_info(&self) -> &ServerInfo {
        &self.info
    }

    fn cancel_handle(&self) -> Arc<dyn CancelHandle> {
        Arc::new(MongoCancel(Arc::clone(&self.cancel)))
    }

    async fn execute(&mut self, statement: &str) -> Result<Box<dyn ResultStream>, QueryError> {
        let parsed = parse_statement(statement).map_err(|error| QueryError {
            position: Some(error.position),
            ..QueryError::new(QueryErrorKind::Database, error.message)
        })?;
        if self.read_only && !is_read(&parsed) {
            return Err(QueryError::new(
                QueryErrorKind::Database,
                "The connection is read-only. It runs only statements that read data.",
            ));
        }
        let plan = plan(&parsed, &self.database, self.limits())
            .map_err(|error| QueryError::new(QueryErrorKind::Database, error.0))?;
        self.run_plan(plan).await
    }

    async fn schemas(&mut self) -> Result<Vec<SchemaInfo>, QueryError> {
        catalog::schemas(&self.client, &self.database).await
    }

    async fn relations(&mut self, schema: &str) -> Result<Vec<RelationInfo>, QueryError> {
        catalog::relations(&self.client.database(schema)).await
    }

    async fn relation_detail(
        &mut self,
        schema: &str,
        relation: &str,
    ) -> Result<RelationDetail, QueryError> {
        catalog::relation_detail(&self.client.database(schema), relation).await
    }

    async fn sample_statement(&self, schema: &str, relation: &str, limit: u32) -> String {
        catalog::sample_statement(&self.database, schema, relation, limit)
    }
}

/// The result of a statement that changes data.
struct ChangeStream(u64);

#[async_trait]
impl ResultStream for ChangeStream {
    fn columns(&self) -> Option<&[Column]> {
        None
    }

    async fn next_page(&mut self, _max_rows: usize) -> Result<Page, QueryError> {
        Ok(Page {
            rows: Vec::new(),
            end: Some(Completion {
                affected_rows: self.0,
            }),
        })
    }

    async fn close(self: Box<Self>) {}
}

/// Documents as rows. The stream reads from the cursor only on request.
struct DocumentStream {
    shape: Shape,
    buffer: VecDeque<Document>,
    cursor: Option<Cursor<Document>>,
    count: u64,
    signal: watch::Receiver<u64>,
}

impl DocumentStream {
    fn from_documents(
        documents: Vec<Document>,
        signal: watch::Receiver<u64>,
    ) -> Box<dyn ResultStream> {
        Box::new(Self {
            shape: Shape::of(&documents, false),
            buffer: documents.into(),
            cursor: None,
            count: 0,
            signal,
        })
    }

    /// Reads the first page, so that the columns come from its documents.
    async fn from_cursor(
        cursor: Cursor<Document>,
        signal: watch::Receiver<u64>,
    ) -> Result<Box<dyn ResultStream>, QueryError> {
        let mut stream = Self {
            shape: Shape::of(&[], false),
            buffer: VecDeque::new(),
            cursor: Some(cursor),
            count: 0,
            signal,
        };
        stream.fill(FIRST_PAGE).await?;
        let first: Vec<Document> = stream.buffer.iter().cloned().collect();
        stream.shape = Shape::of(&first, stream.cursor.is_some());
        Ok(Box::new(stream))
    }

    /// Reads from the cursor until the buffer has `size` documents or the cursor ends.
    async fn fill(&mut self, size: usize) -> Result<(), QueryError> {
        while self.buffer.len() < size {
            let Some(cursor) = self.cursor.as_mut() else {
                return Ok(());
            };
            let next = tokio::select! {
                next = cursor.try_next() => next.map_err(|error| query_error(&error)),
                () = cancel_signal(self.signal.clone()) => Err(cancelled()),
            };
            match next {
                Ok(Some(document)) => self.buffer.push_back(document),
                Ok(None) => self.cursor = None,
                Err(error) => {
                    self.cursor = None;
                    return Err(error);
                }
            }
        }
        Ok(())
    }
}

#[async_trait]
impl ResultStream for DocumentStream {
    fn columns(&self) -> Option<&[Column]> {
        Some(&self.shape.columns)
    }

    async fn next_page(&mut self, max_rows: usize) -> Result<Page, QueryError> {
        self.fill(max_rows).await?;
        let count = max_rows.min(self.buffer.len());
        let rows = self
            .buffer
            .drain(..count)
            .map(|document| self.shape.row(&document))
            .collect();
        self.count += count as u64;
        let is_end = self.buffer.is_empty() && self.cursor.is_none();
        Ok(Page {
            rows,
            end: is_end.then_some(Completion {
                affected_rows: self.count,
            }),
        })
    }

    async fn close(self: Box<Self>) {
        // The drop of the cursor tells the server to close it.
        drop(self);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_errors_become_a_query_error() {
        let answer = doc! { "ok": 1, "n": 0, "writeErrors": [{ "index": 0, "code": 11000, "errmsg": "E11000 duplicate key" }] };

        let error = check_write_errors(&answer).unwrap_err();

        assert_eq!(error.message, "E11000 duplicate key");
        assert_eq!(error.code.as_deref(), Some("11000"));
    }

    #[test]
    fn the_changed_count_adds_the_modified_and_the_upserted_documents() {
        let answer = doc! { "n": 3, "nModified": 2, "upserted": [{ "index": 0, "_id": 1 }] };

        assert_eq!(changed_count(&answer, &["nModified", "upserted"]), 3);
    }

    #[test]
    fn database_names_follow_the_rules_of_mongodb() {
        assert!(is_valid_database_name("sales_2024"));
        assert!(!is_valid_database_name("a.b"));
        assert!(!is_valid_database_name(""));
    }
}

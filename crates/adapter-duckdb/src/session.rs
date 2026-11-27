//! The session, its result stream, and its cancel handle. They send work to the
//! session thread and wait for the answer.

use crate::error::session_closed;
use crate::worker::Command;
use async_trait::async_trait;
use duckdb::InterruptHandle;
use std::sync::Arc;
use std::sync::mpsc::Sender;
use std::time::Duration;
use tabloxide_core::{
    CancelHandle, Column, Page, PlanText, QueryError, QueryErrorKind, RelationDetail, RelationInfo,
    ResultStream, SchemaInfo, ServerInfo, Session, read_explain_json,
};
use tokio::sync::oneshot;

/// Interrupts the active statement of one session. It does not affect the other
/// sessions of the same database.
pub(crate) struct DuckCancel {
    pub interrupt: Arc<InterruptHandle>,
}

#[async_trait]
impl CancelHandle for DuckCancel {
    async fn cancel(&self) -> Result<(), QueryError> {
        self.interrupt.interrupt();
        Ok(())
    }
}

/// Sends a command to the session thread and waits for the answer.
async fn request<T>(
    commands: &Sender<Command>,
    make: impl FnOnce(oneshot::Sender<Result<T, QueryError>>) -> Command,
) -> Result<T, QueryError> {
    let (reply, answer) = oneshot::channel();
    commands.send(make(reply)).map_err(|_| session_closed())?;
    answer.await.map_err(|_| session_closed())?
}

pub(crate) struct DuckSession {
    pub info: ServerInfo,
    pub commands: Sender<Command>,
    pub cancel: Arc<DuckCancel>,
    pub query_timeout: Option<Duration>,
}

fn timeout_error(timeout: Duration) -> QueryError {
    QueryError::new(
        QueryErrorKind::Timeout,
        format!(
            "The statement did not answer in {} seconds. The query timeout of the connection stopped it.",
            timeout.as_secs()
        ),
    )
}

#[async_trait]
impl Session for DuckSession {
    fn server_info(&self) -> &ServerInfo {
        &self.info
    }

    fn cancel_handle(&self) -> Arc<dyn CancelHandle> {
        Arc::clone(&self.cancel) as Arc<dyn CancelHandle>
    }

    async fn execute(&mut self, statement: &str) -> Result<Box<dyn ResultStream>, QueryError> {
        let (reply, mut answer) = oneshot::channel();
        let command = Command::Execute {
            sql: statement.to_owned(),
            reply,
        };
        self.commands.send(command).map_err(|_| session_closed())?;
        let columns = match self.query_timeout {
            None => answer.await,
            Some(timeout) => match tokio::time::timeout(timeout, &mut answer).await {
                Ok(columns) => columns,
                Err(_) => {
                    self.cancel.interrupt.interrupt();
                    // Wait until the session thread stopped the statement.
                    let _ = answer.await;
                    return Err(timeout_error(timeout));
                }
            },
        };
        let columns = columns.map_err(|_| session_closed())??;
        Ok(Box::new(DuckStream {
            columns,
            commands: self.commands.clone(),
        }))
    }

    async fn schemas(&mut self) -> Result<Vec<SchemaInfo>, QueryError> {
        request(&self.commands, |reply| Command::Schemas { reply }).await
    }

    async fn relations(&mut self, schema: &str) -> Result<Vec<RelationInfo>, QueryError> {
        let schema = schema.to_owned();
        request(&self.commands, |reply| Command::Relations { schema, reply }).await
    }

    async fn relation_detail(
        &mut self,
        schema: &str,
        relation: &str,
    ) -> Result<RelationDetail, QueryError> {
        let (schema, relation) = (schema.to_owned(), relation.to_owned());
        request(&self.commands, |reply| Command::RelationDetail {
            schema,
            relation,
            reply,
        })
        .await
    }

    async fn sample_statement(&self, schema: &str, relation: &str, limit: u32) -> String {
        crate::catalog::sample_statement(schema, relation, limit)
    }

    async fn read_plan(&mut self, statement: &str, run: bool) -> Result<PlanText, QueryError> {
        let explain = explain_statement(statement, run);
        let text = read_explain_json(self, &explain).await?;
        Ok(PlanText {
            text,
            statement: explain,
            plan: None,
        })
    }
}

/// The `EXPLAIN` statement that gives the plan of `statement` as JSON. With `run`,
/// the database runs the statement and measures it.
fn explain_statement(statement: &str, run: bool) -> String {
    let options = if run {
        "EXPLAIN (ANALYZE, FORMAT JSON) "
    } else {
        "EXPLAIN (FORMAT JSON) "
    };
    format!("{options}{statement}")
}

/// The result of one statement. The session thread holds the data.
struct DuckStream {
    columns: Option<Vec<Column>>,
    commands: Sender<Command>,
}

#[async_trait]
impl ResultStream for DuckStream {
    fn columns(&self) -> Option<&[Column]> {
        self.columns.as_deref()
    }

    async fn next_page(&mut self, max_rows: usize) -> Result<Page, QueryError> {
        request(&self.commands, |reply| Command::NextPage {
            max_rows,
            reply,
        })
        .await
    }

    async fn close(self: Box<Self>) {
        // If the thread is gone, the result is closed already.
        let _ = self.commands.send(Command::CloseResult);
    }
}

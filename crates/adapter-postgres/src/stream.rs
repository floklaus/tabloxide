//! The result stream of one statement.
//!
//! The driver reads from the socket only when the stream asks for the next message.
//! Thus a stream that waits does not use more memory, and the server stops the send.

use crate::{columns, error};
use async_trait::async_trait;
use futures_util::StreamExt;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;
use tabloxide_core::{
    CancelHandle, Column, Completion, Page, QueryError, QueryErrorKind, ResultStream, Row,
};
use tokio_postgres::types::Type;
use tokio_postgres::{SimpleQueryMessage, SimpleQueryRow, SimpleQueryStream};

pub(crate) struct PgStream {
    messages: Pin<Box<SimpleQueryStream>>,
    columns: Option<Vec<Column>>,
    /// Has a value when the statement is complete.
    end: Option<Completion>,
    /// `true` when the server has no more messages for this statement.
    is_drained: bool,
    cancel: Arc<dyn CancelHandle>,
}

fn to_row(row: &SimpleQueryRow) -> Result<Row, QueryError> {
    (0..row.len())
        .map(|index| {
            row.try_get(index)
                .map(|value| value.map(str::to_owned))
                .map_err(|e| error::map_query_error(&e))
        })
        .collect()
}

fn timeout_error(limit: Duration) -> QueryError {
    QueryError::new(
        QueryErrorKind::Timeout,
        format!(
            "The statement did not answer in {} seconds. The query timeout of the connection stopped it.",
            limit.as_secs()
        ),
    )
}

impl PgStream {
    /// Waits for the first message of the result. The first message shows if the statement
    /// returns rows, or it is the error of the statement.
    pub(crate) async fn start(
        messages: SimpleQueryStream,
        types: Option<Vec<Type>>,
        cancel: Arc<dyn CancelHandle>,
        timeout: Option<Duration>,
    ) -> Result<Self, QueryError> {
        let mut stream = Self {
            messages: Box::pin(messages),
            columns: None,
            end: None,
            is_drained: false,
            cancel,
        };
        let first = match timeout {
            None => stream.messages.next().await,
            Some(limit) => match tokio::time::timeout(limit, stream.messages.next()).await {
                Ok(message) => message,
                Err(_) => {
                    stream.stop().await;
                    return Err(timeout_error(limit));
                }
            },
        };
        match first {
            Some(Ok(SimpleQueryMessage::RowDescription(names))) => {
                stream.columns = Some(columns::describe(&names, types.as_deref()));
            }
            Some(Ok(SimpleQueryMessage::CommandComplete(count))) => {
                stream.complete(count).await?;
            }
            Some(Ok(_)) => {}
            Some(Err(e)) => {
                stream.drain().await;
                return Err(error::map_query_error(&e));
            }
            None => stream.finish(0),
        }
        Ok(stream)
    }

    fn finish(&mut self, count: u64) {
        self.end.get_or_insert(Completion {
            affected_rows: count,
        });
        self.is_drained = true;
    }

    /// Reads and discards the remaining messages. Returns the first error.
    async fn drain(&mut self) -> Option<tokio_postgres::Error> {
        let mut first_error = None;
        while !self.is_drained {
            match self.messages.next().await {
                Some(Ok(_)) => {}
                Some(Err(e)) => {
                    first_error.get_or_insert(e);
                }
                None => self.is_drained = true,
            }
        }
        first_error
    }

    /// Records the end of the statement and reads the messages that follow it.
    async fn complete(&mut self, count: u64) -> Result<(), QueryError> {
        let end = Completion {
            affected_rows: count,
        };
        match self.drain().await {
            Some(e) => Err(error::map_query_error(&e)),
            None => {
                self.end.get_or_insert(end);
                Ok(())
            }
        }
    }

    /// Cancels the statement and reads the remaining messages.
    async fn stop(&mut self) {
        if self.is_drained {
            return;
        }
        // If the cancel request fails, the drain reads all remaining rows. That is slow but correct.
        let _ = self.cancel.cancel().await;
        self.drain().await;
    }
}

#[async_trait]
impl ResultStream for PgStream {
    fn columns(&self) -> Option<&[Column]> {
        self.columns.as_deref()
    }

    async fn next_page(&mut self, max_rows: usize) -> Result<Page, QueryError> {
        let mut rows: Vec<Row> = Vec::new();
        while self.end.is_none() && rows.len() < max_rows {
            match self.messages.next().await {
                Some(Ok(SimpleQueryMessage::Row(row))) => rows.push(to_row(&row)?),
                Some(Ok(SimpleQueryMessage::CommandComplete(count))) => {
                    self.complete(count).await?;
                }
                Some(Ok(_)) => {}
                Some(Err(e)) => {
                    self.drain().await;
                    return Err(error::map_query_error(&e));
                }
                None => self.finish(0),
            }
        }
        Ok(Page {
            rows,
            end: self.end,
        })
    }

    async fn close(mut self: Box<Self>) {
        self.stop().await;
    }
}

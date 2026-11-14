//! A session without a database, for tests of the code that uses the adapter interface.

use crate::{
    CancelHandle, Column, ColumnKind, Completion, Page, QueryError, QueryErrorKind, ResultStream,
    Row, ServerInfo, Session,
};
use async_trait::async_trait;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

/// What a [`ScriptedSession`] answers to one statement.
#[derive(Debug, Clone)]
pub enum Scripted {
    /// A result with one column `n` and the rows `1..=count`.
    Rows(u64),
    /// A statement without rows that changes `count` rows.
    Command(u64),
    /// A failure with the error position `position`.
    Error {
        message: String,
        position: Option<u32>,
    },
}

/// Counters that a test can read after the session moved into the code under test.
#[derive(Debug, Default)]
pub struct Probe {
    pub executed: Mutex<Vec<String>>,
    pub closed_early: AtomicUsize,
    pub cancelled: AtomicBool,
}

/// A session that returns prepared answers in sequence.
pub struct ScriptedSession {
    answers: VecDeque<Scripted>,
    probe: Arc<Probe>,
    info: ServerInfo,
}

impl ScriptedSession {
    #[must_use]
    pub fn new(answers: impl IntoIterator<Item = Scripted>) -> (Self, Arc<Probe>) {
        let probe = Arc::new(Probe::default());
        let session = Self {
            answers: answers.into_iter().collect(),
            probe: Arc::clone(&probe),
            info: ServerInfo {
                version: "test".to_owned(),
            },
        };
        (session, probe)
    }
}

struct ScriptedStream {
    columns: Option<Vec<Column>>,
    next: u64,
    count: u64,
    is_done: bool,
    probe: Arc<Probe>,
}

#[async_trait]
impl ResultStream for ScriptedStream {
    fn columns(&self) -> Option<&[Column]> {
        self.columns.as_deref()
    }

    async fn next_page(&mut self, max_rows: usize) -> Result<Page, QueryError> {
        if self.probe.cancelled.load(Ordering::SeqCst) {
            self.is_done = true;
            return Err(QueryError::new(QueryErrorKind::Cancelled, "cancelled"));
        }
        let has_rows = self.columns.is_some();
        let mut rows: Vec<Row> = Vec::new();
        while has_rows && self.next <= self.count && rows.len() < max_rows {
            rows.push(vec![Some(self.next.to_string())]);
            self.next += 1;
        }
        self.is_done = !has_rows || self.next > self.count;
        let end = self.is_done.then_some(Completion {
            affected_rows: self.count,
        });
        Ok(Page { rows, end })
    }

    async fn close(self: Box<Self>) {
        if !self.is_done {
            self.probe.closed_early.fetch_add(1, Ordering::SeqCst);
        }
    }
}

struct ScriptedCancel(Arc<Probe>);

#[async_trait]
impl CancelHandle for ScriptedCancel {
    async fn cancel(&self) -> Result<(), QueryError> {
        self.0.cancelled.store(true, Ordering::SeqCst);
        Ok(())
    }
}

#[async_trait]
impl Session for ScriptedSession {
    fn server_info(&self) -> &ServerInfo {
        &self.info
    }

    fn cancel_handle(&self) -> Arc<dyn CancelHandle> {
        Arc::new(ScriptedCancel(Arc::clone(&self.probe)))
    }

    async fn execute(&mut self, statement: &str) -> Result<Box<dyn ResultStream>, QueryError> {
        self.probe
            .executed
            .lock()
            .expect("the probe lock is not poisoned")
            .push(statement.to_owned());
        let answer = self.answers.pop_front().unwrap_or(Scripted::Command(0));
        let (columns, count) = match answer {
            Scripted::Rows(count) => {
                let column = Column {
                    name: "n".to_owned(),
                    type_name: Some("int4".to_owned()),
                    kind: ColumnKind::Number,
                };
                (Some(vec![column]), count)
            }
            Scripted::Command(count) => (None, count),
            Scripted::Error { message, position } => {
                return Err(QueryError {
                    position,
                    ..QueryError::new(QueryErrorKind::Database, message)
                });
            }
        };
        Ok(Box::new(ScriptedStream {
            columns,
            next: 1,
            count,
            is_done: false,
            probe: Arc::clone(&self.probe),
        }))
    }
}

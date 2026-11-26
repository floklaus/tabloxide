//! A session for one query tab. It holds the open result between page requests.

use crate::csv::export_csv;
use crate::{
    CancelHandle, PlanText, QueryError, QueryErrorKind, QueryLanguage, RelationDetail,
    RelationInfo, ResultStream, Row, RunLimits, RunTarget, SchemaInfo, ServerInfo, Session,
    StatementReport, run_script,
};
use serde::Serialize;
use std::sync::Arc;
use tokio::io::AsyncWrite;
use tokio::sync::Mutex;

/// Identifier of an open result in one session.
pub type ResultId = u32;

/// The report of one run. `open_result` identifies the result of the last statement,
/// if it has more rows to fetch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct RunReport {
    pub statements: Vec<StatementReport>,
    pub open_result: Option<ResultId>,
}

/// More rows of an open result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct FetchedPage {
    pub rows: Vec<Row>,
    /// `true` if the result has no more rows. The result is then closed.
    pub is_complete: bool,
    /// Number of rows of the complete result.
    #[cfg_attr(feature = "specta", specta(type = Option<u32>))]
    pub total_rows: Option<u64>,
    /// The failure that stopped the fetch. The result is then closed.
    pub error: Option<QueryError>,
}

struct OpenResult {
    id: ResultId,
    stream: Box<dyn ResultStream>,
}

struct Inner {
    session: Box<dyn Session>,
    open: Option<OpenResult>,
    next_result_id: ResultId,
}

impl Inner {
    async fn close_open_result(&mut self) {
        if let Some(open) = self.open.take() {
            open.stream.close().await;
        }
    }
}

/// A database session with a maximum of one open result.
///
/// The session runs one operation at a time. `cancel` does not wait for the active operation.
pub struct QuerySession {
    info: ServerInfo,
    language: QueryLanguage,
    cancel: Arc<dyn CancelHandle>,
    inner: Mutex<Inner>,
}

impl QuerySession {
    #[must_use]
    pub fn new(session: Box<dyn Session>, language: QueryLanguage) -> Self {
        Self {
            info: session.server_info().clone(),
            language,
            cancel: session.cancel_handle(),
            inner: Mutex::new(Inner {
                session,
                open: None,
                next_result_id: 1,
            }),
        }
    }

    #[must_use]
    pub fn server_info(&self) -> &ServerInfo {
        &self.info
    }

    /// The query language of the engine of the session.
    #[must_use]
    pub fn language(&self) -> QueryLanguage {
        self.language
    }

    /// Closes the open result, then runs the statements that `target` selects.
    pub async fn run(&self, sql: &str, target: RunTarget, limits: RunLimits) -> RunReport {
        let mut inner = self.inner.lock().await;
        inner.close_open_result().await;
        let output = run_script(inner.session.as_mut(), self.language, sql, target, limits).await;
        let open_result = output.open.map(|stream| {
            let id = inner.next_result_id;
            inner.next_result_id = id.wrapping_add(1);
            inner.open = Some(OpenResult { id, stream });
            id
        });
        RunReport {
            statements: output.statements,
            open_result,
        }
    }

    /// Reads the next rows of the open result. Returns `None` if `result_id` is not open.
    pub async fn fetch(&self, result_id: ResultId, max_rows: usize) -> Option<FetchedPage> {
        let mut inner = self.inner.lock().await;
        let open = inner.open.as_mut().filter(|open| open.id == result_id)?;
        let page = match open.stream.next_page(max_rows).await {
            Ok(page) => FetchedPage {
                rows: page.rows,
                is_complete: page.end.is_some(),
                total_rows: page.end.map(|end| end.affected_rows),
                error: None,
            },
            Err(error) => FetchedPage {
                rows: Vec::new(),
                is_complete: false,
                total_rows: None,
                error: Some(error),
            },
        };
        if page.is_complete || page.error.is_some() {
            inner.close_open_result().await;
        }
        Some(page)
    }

    /// Closes the result `result_id`, if it is open. This cancels its statement.
    pub async fn close_result(&self, result_id: ResultId) {
        let mut inner = self.inner.lock().await;
        if inner.open.as_ref().is_some_and(|open| open.id == result_id) {
            inner.close_open_result().await;
        }
    }

    /// Cancels the active statement. The statement can be in a run, in a fetch, or in an
    /// open result that waits.
    ///
    /// # Errors
    ///
    /// Returns an error if the cancel request does not get to the server.
    pub async fn cancel(&self) -> Result<(), QueryError> {
        self.cancel.cancel().await
    }

    /// Closes the open result, runs `statement` again, and writes its complete result
    /// to `out` as CSV. Returns the number of rows.
    ///
    /// # Errors
    ///
    /// Returns an error if the statement does not only read data, if it fails,
    /// or if the write fails.
    pub async fn export_csv<W>(
        &self,
        statement: &str,
        out: &mut W,
        page_rows: usize,
    ) -> Result<u64, QueryError>
    where
        W: AsyncWrite + Unpin + Send,
    {
        if !self.language.is_pageable(statement) {
            return Err(QueryError::new(
                QueryErrorKind::Other,
                "The export runs the statement again. Thus it is available only for a statement that reads data.",
            ));
        }
        let mut inner = self.inner.lock().await;
        inner.close_open_result().await;
        let mut stream = inner.session.execute(statement).await?;
        let result = export_csv(stream.as_mut(), out, page_rows).await;
        stream.close().await;
        result
    }

    /// Lists the schemas of the database. This closes the open result.
    ///
    /// # Errors
    ///
    /// Returns the error of the database.
    pub async fn schemas(&self) -> Result<Vec<SchemaInfo>, QueryError> {
        let mut inner = self.inner.lock().await;
        inner.close_open_result().await;
        inner.session.schemas().await
    }

    /// Lists the tables and the views of one schema. This closes the open result.
    ///
    /// # Errors
    ///
    /// Returns the error of the database.
    pub async fn relations(&self, schema: &str) -> Result<Vec<RelationInfo>, QueryError> {
        let mut inner = self.inner.lock().await;
        inner.close_open_result().await;
        inner.session.relations(schema).await
    }

    /// Reads the execution plan of one statement. With `run`, the engine runs it.
    /// This closes the open result.
    ///
    /// # Errors
    ///
    /// Returns the error of the database, or an error if the engine gives no plan.
    pub async fn read_plan(&self, statement: &str, run: bool) -> Result<PlanText, QueryError> {
        let mut inner = self.inner.lock().await;
        inner.close_open_result().await;
        inner.session.read_plan(statement, run).await
    }

    /// Reads the structure of one table or view. This closes the open result.
    ///
    /// # Errors
    ///
    /// Returns the error of the database.
    pub async fn relation_detail(
        &self,
        schema: &str,
        relation: &str,
    ) -> Result<RelationDetail, QueryError> {
        let mut inner = self.inner.lock().await;
        inner.close_open_result().await;
        inner.session.relation_detail(schema, relation).await
    }

    /// Reads a maximum of `limit` rows of a table or view. The result does not stay open.
    pub async fn sample(
        &self,
        schema: &str,
        relation: &str,
        limit: u32,
    ) -> Option<StatementReport> {
        let mut inner = self.inner.lock().await;
        inner.close_open_result().await;
        let statement = inner
            .session
            .sample_statement(schema, relation, limit)
            .await;
        let row_limit = usize::try_from(limit).unwrap_or(usize::MAX);
        let limits = RunLimits {
            page_rows: row_limit.saturating_add(1),
            buffered_rows: row_limit,
        };
        let output = run_script(
            inner.session.as_mut(),
            self.language,
            &statement,
            RunTarget::All,
            limits,
        )
        .await;
        if let Some(stream) = output.open {
            stream.close().await;
        }
        output.statements.into_iter().next()
    }

    /// Closes the open result, runs `statement`, and returns a maximum of `max_rows` rows.
    /// The result does not stay open, and the query history does not record the statement.
    ///
    /// # Errors
    ///
    /// Returns the error of the database.
    pub async fn read_rows(
        &self,
        statement: &str,
        max_rows: usize,
    ) -> Result<Vec<Row>, QueryError> {
        let mut inner = self.inner.lock().await;
        inner.close_open_result().await;
        let mut stream = inner.session.execute(statement).await?;
        let mut rows: Vec<Row> = Vec::new();
        let result = loop {
            match stream.next_page(max_rows.saturating_sub(rows.len())).await {
                Ok(page) => {
                    rows.extend(page.rows);
                    if page.end.is_some() || rows.len() >= max_rows {
                        break Ok(());
                    }
                }
                Err(error) => break Err(error),
            }
        };
        stream.close().await;
        result.map(|()| rows)
    }

    /// Closes the open result. The connection closes when the session drops.
    pub async fn close(&self) {
        self.inner.lock().await.close_open_result().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Outcome;
    use crate::testing::{Probe, Scripted, ScriptedSession};
    use std::sync::atomic::Ordering;

    const LIMITS: RunLimits = RunLimits {
        page_rows: 10,
        buffered_rows: 25,
    };

    fn session(answers: Vec<Scripted>) -> (QuerySession, Arc<Probe>) {
        let (session, probe) = ScriptedSession::new(answers);
        (
            QuerySession::new(Box::new(session), QueryLanguage::Sql),
            probe,
        )
    }

    async fn run(session: &QuerySession, sql: &str) -> RunReport {
        session.run(sql, RunTarget::All, LIMITS).await
    }

    #[tokio::test]
    async fn fetches_the_remaining_rows_of_an_open_result() {
        let (session, _) = session(vec![Scripted::Rows(25)]);

        let report = run(&session, "select 1").await;
        let id = report.open_result.expect("the result must be open");
        let second = session.fetch(id, 10).await.unwrap();
        let third = session.fetch(id, 10).await.unwrap();

        assert_eq!(second.rows.len(), 10);
        assert!(!second.is_complete);
        assert_eq!(third.rows.len(), 5);
        assert!(third.is_complete);
        assert_eq!(third.total_rows, Some(25));
        // A complete result is closed.
        assert_eq!(session.fetch(id, 10).await, None);
    }

    #[tokio::test]
    async fn a_complete_first_page_leaves_no_open_result() {
        let (session, _) = session(vec![Scripted::Rows(3)]);

        let report = run(&session, "select 1").await;

        assert_eq!(report.open_result, None);
        assert!(matches!(
            report.statements[0].outcome,
            Outcome::Rows {
                is_complete: true,
                ..
            }
        ));
    }

    #[tokio::test]
    async fn the_next_run_closes_the_open_result() {
        let (session, probe) = session(vec![Scripted::Rows(100), Scripted::Rows(100)]);

        let first = run(&session, "select 1").await.open_result.unwrap();
        let second = run(&session, "select 2").await.open_result.unwrap();

        assert_ne!(first, second);
        assert_eq!(probe.closed_early.load(Ordering::SeqCst), 1);
        assert_eq!(session.fetch(first, 10).await, None);
        assert!(session.fetch(second, 10).await.is_some());
    }

    #[tokio::test]
    async fn close_result_closes_only_the_result_with_that_identifier() {
        let (session, probe) = session(vec![Scripted::Rows(100)]);
        let id = run(&session, "select 1").await.open_result.unwrap();

        session.close_result(id + 1).await;
        assert_eq!(probe.closed_early.load(Ordering::SeqCst), 0);

        session.close_result(id).await;
        assert_eq!(probe.closed_early.load(Ordering::SeqCst), 1);
        assert_eq!(session.fetch(id, 10).await, None);
    }

    #[tokio::test]
    async fn a_cancel_stops_the_fetch_and_closes_the_result() {
        let (session, _) = session(vec![Scripted::Rows(100)]);
        let id = run(&session, "select 1").await.open_result.unwrap();

        session.cancel().await.unwrap();
        let page = session.fetch(id, 10).await.unwrap();

        assert_eq!(page.error.unwrap().kind, QueryErrorKind::Cancelled);
        assert_eq!(session.fetch(id, 10).await, None);
    }

    #[tokio::test]
    async fn the_export_runs_the_statement_again() {
        let (session, probe) = session(vec![Scripted::Rows(100), Scripted::Rows(3)]);
        run(&session, "select 1").await;
        let mut out: Vec<u8> = Vec::new();

        let count = session.export_csv("select 1", &mut out, 10).await.unwrap();

        assert_eq!(count, 3);
        assert_eq!(String::from_utf8(out).unwrap(), "n\n1\n2\n3\n");
        assert_eq!(probe.executed.lock().unwrap().len(), 2);
        assert_eq!(probe.closed_early.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn introspection_closes_the_open_result() {
        let (session, probe) = session(vec![Scripted::Rows(100)]);
        run(&session, "select 1").await;

        let schemas = session.schemas().await.unwrap();
        let relations = session.relations("public").await.unwrap();
        let detail = session.relation_detail("public", "item").await.unwrap();

        assert_eq!(schemas[0].name, "public");
        assert_eq!(relations[0].name, "public_table");
        assert_eq!(detail.columns[0].name, "item_id");
        assert_eq!(probe.closed_early.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn the_sample_runs_the_statement_of_the_adapter() {
        let (session, probe) = session(vec![Scripted::Rows(3)]);

        let report = session.sample("public", "item", 100).await.unwrap();

        assert_eq!(
            *probe.executed.lock().unwrap(),
            vec!["select * from public.item limit 100"]
        );
        assert!(matches!(
            report.outcome,
            Outcome::Rows {
                is_complete: true,
                total_rows: Some(3),
                ..
            }
        ));
    }

    #[tokio::test]
    async fn read_rows_returns_the_rows_and_leaves_no_open_result() {
        let (session, probe) = session(vec![Scripted::Rows(100), Scripted::Rows(40)]);
        let open = run(&session, "select 1").await.open_result.unwrap();

        let rows = session.read_rows("explain select 2", 25).await.unwrap();

        assert_eq!(rows.len(), 25);
        assert_eq!(rows[0], vec![Some("1".to_owned())]);
        assert_eq!(session.fetch(open, 10).await, None);
        assert_eq!(
            probe.executed.lock().unwrap().last().unwrap(),
            "explain select 2"
        );
    }

    #[tokio::test]
    async fn read_rows_returns_the_error_of_the_statement() {
        let (session, _) = session(vec![Scripted::Error {
            message: "syntax error".to_owned(),
            position: None,
        }]);

        let error = session.read_rows("explain selec", 25).await.unwrap_err();

        assert_eq!(error.message, "syntax error");
    }

    #[tokio::test]
    async fn the_export_rejects_a_statement_that_changes_data() {
        let (session, probe) = session(vec![]);
        let mut out: Vec<u8> = Vec::new();

        let error = session
            .export_csv("delete from t returning *", &mut out, 10)
            .await
            .unwrap_err();

        assert_eq!(error.kind, QueryErrorKind::Other);
        assert!(probe.executed.lock().unwrap().is_empty());
    }
}

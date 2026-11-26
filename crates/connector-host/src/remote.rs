//! A connector as a `DbAdapter`. For the other parts of the core, a connector is the
//! same as a built-in adapter.

use crate::process::{Client, ConnectorProcess};
use async_trait::async_trait;
use std::collections::VecDeque;
use std::path::Path;
use std::sync::Arc;
use tabloxide_connector_protocol::convert;
use tabloxide_connector_protocol::v1::{
    self, DescribeRelationRequest, ExecuteRequest, ListRelationsRequest, OpenSessionRequest,
    ReadPlanRequest, SampleStatementRequest, SessionRequest, TestConnectionRequest,
    connect_response, execute_event,
};
use tabloxide_core::{
    CancelHandle, Column, Completion, ConnectError, ConnectErrorKind, ConnectionProfile, DbAdapter,
    EngineInfo, Page, PlanText, QueryError, QueryErrorKind, RelationDetail, RelationInfo,
    ResultStream, Row, SchemaInfo, Secret, ServerInfo, Session,
};
use tonic::{Code, Status, Streaming};

/// Number of rows in one page from the connector.
const PAGE_ROWS: u32 = 500;

fn lost(status: &Status) -> QueryError {
    let kind = match status.code() {
        Code::Unavailable | Code::Cancelled | Code::Unknown => QueryErrorKind::ConnectionLost,
        _ => QueryErrorKind::Other,
    };
    QueryError {
        detail: Some(status.message().to_owned()),
        ..QueryError::new(kind, "The connector did not answer.")
    }
}

fn connect_failed(status: &Status) -> ConnectError {
    ConnectError::new(
        ConnectErrorKind::Other,
        format!("The connector did not answer: {}", status.message()),
    )
}

/// A connector that runs, as a `DbAdapter`.
pub struct RemoteAdapter {
    info: EngineInfo,
    client: Client,
    /// Keeps the process. `None` when the test gave a client without a process.
    process: Option<Arc<ConnectorProcess>>,
}

impl RemoteAdapter {
    #[must_use]
    pub fn new(process: Arc<ConnectorProcess>) -> Self {
        Self {
            info: process.info.clone(),
            client: process.client.clone(),
            process: Some(process),
        }
    }

    /// Makes an adapter for a connector that some other code started.
    #[must_use]
    pub fn from_client(info: EngineInfo, client: Client) -> Self {
        Self {
            info,
            client,
            process: None,
        }
    }

    /// Returns `true` while the connector can take requests.
    #[must_use]
    pub fn is_running(&self) -> bool {
        self.process
            .as_ref()
            .is_none_or(|process| process.is_running())
    }

    fn profile(profile: &ConnectionProfile) -> Option<v1::ConnectionProfile> {
        Some(convert::profile_to_wire(profile))
    }
}

/// Reads the answer of `TestConnection` or `OpenSession`.
fn read_connect(
    response: Result<tonic::Response<v1::ConnectResponse>, Status>,
) -> Result<(ServerInfo, Option<u64>), ConnectError> {
    let response = response
        .map_err(|status| connect_failed(&status))?
        .into_inner();
    match response.result {
        Some(connect_response::Result::Connected(connected)) => Ok((
            convert::server_info_from_wire(connected.server.as_ref()),
            connected.session_id,
        )),
        Some(connect_response::Result::Error(error)) => {
            Err(convert::connect_error_from_wire(&error))
        }
        None => Err(ConnectError::new(
            ConnectErrorKind::Other,
            "The connector gave an empty answer.",
        )),
    }
}

#[async_trait]
impl DbAdapter for RemoteAdapter {
    fn info(&self) -> EngineInfo {
        self.info.clone()
    }

    async fn test_connection(
        &self,
        profile: &ConnectionProfile,
        password: Option<&Secret>,
        workspace_root: &Path,
    ) -> Result<ServerInfo, ConnectError> {
        let request = TestConnectionRequest {
            profile: Self::profile(profile),
            password: password.map(|secret| secret.expose().to_owned()),
            workspace_root: workspace_root.to_string_lossy().into_owned(),
        };
        let response = self.client.clone().test_connection(request).await;
        read_connect(response).map(|(info, _)| info)
    }

    async fn connect(
        &self,
        profile: &ConnectionProfile,
        password: Option<&Secret>,
        workspace_root: &Path,
    ) -> Result<Box<dyn Session>, ConnectError> {
        let request = OpenSessionRequest {
            profile: Self::profile(profile),
            password: password.map(|secret| secret.expose().to_owned()),
            workspace_root: workspace_root.to_string_lossy().into_owned(),
        };
        let response = self.client.clone().open_session(request).await;
        let (info, id) = read_connect(response)?;
        let id = id.ok_or_else(|| {
            ConnectError::new(ConnectErrorKind::Other, "The connector gave no session.")
        })?;
        Ok(Box::new(RemoteSession {
            client: self.client.clone(),
            id,
            info,
            _process: self.process.clone(),
        }))
    }
}

struct RemoteSession {
    client: Client,
    id: u64,
    info: ServerInfo,
    _process: Option<Arc<ConnectorProcess>>,
}

impl RemoteSession {
    fn request(&self) -> SessionRequest {
        SessionRequest {
            session_id: self.id,
        }
    }
}

impl Drop for RemoteSession {
    fn drop(&mut self) {
        let mut client = self.client.clone();
        let request = self.request();
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                let _ = client.close_session(request).await;
            });
        }
    }
}

struct RemoteCancel {
    client: Client,
    id: u64,
}

#[async_trait]
impl CancelHandle for RemoteCancel {
    async fn cancel(&self) -> Result<(), QueryError> {
        let response = self
            .client
            .clone()
            .cancel(SessionRequest {
                session_id: self.id,
            })
            .await
            .map_err(|status| lost(&status))?
            .into_inner();
        match response.error {
            Some(error) => Err(convert::query_error_from_wire(&error)),
            None => Ok(()),
        }
    }
}

fn response_error(error: Option<&v1::QueryError>) -> Result<(), QueryError> {
    error.map_or(Ok(()), |error| Err(convert::query_error_from_wire(error)))
}

#[async_trait]
impl Session for RemoteSession {
    fn server_info(&self) -> &ServerInfo {
        &self.info
    }

    fn cancel_handle(&self) -> Arc<dyn CancelHandle> {
        Arc::new(RemoteCancel {
            client: self.client.clone(),
            id: self.id,
        })
    }

    async fn execute(&mut self, statement: &str) -> Result<Box<dyn ResultStream>, QueryError> {
        let request = ExecuteRequest {
            session_id: self.id,
            statement: statement.to_owned(),
            page_rows: PAGE_ROWS,
        };
        let mut events = self
            .client
            .execute(request)
            .await
            .map_err(|status| lost(&status))?
            .into_inner();
        let first = events.message().await.map_err(|status| lost(&status))?;
        match first.and_then(|event| event.event) {
            Some(execute_event::Event::Start(start)) => Ok(Box::new(RemoteStream {
                columns: start.has_rows.then(|| {
                    start
                        .columns
                        .iter()
                        .map(convert::column_from_wire)
                        .collect()
                }),
                events: Some(events),
                buffer: VecDeque::new(),
                end: None,
            })),
            Some(execute_event::Event::Error(error)) => Err(convert::query_error_from_wire(&error)),
            Some(execute_event::Event::Page(_)) | None => Err(QueryError::new(
                QueryErrorKind::Other,
                "The connector did not start the result correctly.",
            )),
        }
    }

    async fn schemas(&mut self) -> Result<Vec<SchemaInfo>, QueryError> {
        let response = self
            .client
            .list_schemas(self.request())
            .await
            .map_err(|status| lost(&status))?
            .into_inner();
        response_error(response.error.as_ref())?;
        Ok(response
            .schemas
            .iter()
            .map(convert::schema_from_wire)
            .collect())
    }

    async fn relations(&mut self, schema: &str) -> Result<Vec<RelationInfo>, QueryError> {
        let request = ListRelationsRequest {
            session_id: self.id,
            schema: schema.to_owned(),
        };
        let response = self
            .client
            .list_relations(request)
            .await
            .map_err(|status| lost(&status))?
            .into_inner();
        response_error(response.error.as_ref())?;
        Ok(response
            .relations
            .iter()
            .map(convert::relation_from_wire)
            .collect())
    }

    async fn relation_detail(
        &mut self,
        schema: &str,
        relation: &str,
    ) -> Result<RelationDetail, QueryError> {
        let request = DescribeRelationRequest {
            session_id: self.id,
            schema: schema.to_owned(),
            relation: relation.to_owned(),
        };
        let response = self
            .client
            .describe_relation(request)
            .await
            .map_err(|status| lost(&status))?
            .into_inner();
        response_error(response.error.as_ref())?;
        Ok(response
            .detail
            .as_ref()
            .map(convert::detail_from_wire)
            .unwrap_or_default())
    }

    async fn sample_statement(&self, schema: &str, relation: &str, limit: u32) -> String {
        let request = SampleStatementRequest {
            session_id: self.id,
            schema: schema.to_owned(),
            relation: relation.to_owned(),
            limit,
        };
        self.client
            .clone()
            .sample_statement(request)
            .await
            .map(|response| response.into_inner().statement)
            .unwrap_or_default()
    }

    async fn read_plan(&mut self, statement: &str, run: bool) -> Result<PlanText, QueryError> {
        let request = ReadPlanRequest {
            session_id: self.id,
            statement: statement.to_owned(),
            run,
        };
        let response = match self.client.read_plan(request).await {
            Ok(response) => response.into_inner(),
            // A connector of minor version 1 has no plans.
            Err(status) if status.code() == Code::Unimplemented => {
                return Err(QueryError::new(
                    QueryErrorKind::Other,
                    "The connector of this engine gives no execution plan.",
                ));
            }
            Err(status) => return Err(lost(&status)),
        };
        response_error(response.error.as_ref())?;
        Ok(PlanText {
            text: response.text,
            statement: response.statement,
        })
    }
}

/// The result of one statement. It reads pages from the connector only on request.
struct RemoteStream {
    columns: Option<Vec<Column>>,
    /// `None` after the end or after `close`.
    events: Option<Streaming<v1::ExecuteEvent>>,
    buffer: VecDeque<Row>,
    end: Option<Completion>,
}

impl RemoteStream {
    async fn read_event(&mut self) -> Result<(), QueryError> {
        let Some(events) = self.events.as_mut() else {
            return Ok(());
        };
        let event = events.message().await.map_err(|status| lost(&status))?;
        match event.and_then(|event| event.event) {
            Some(execute_event::Event::Page(page)) => {
                let (rows, end) = convert::page_from_wire(page);
                self.buffer.extend(rows);
                if end.is_some() {
                    self.end = end;
                    self.events = None;
                }
                Ok(())
            }
            Some(execute_event::Event::Error(error)) => {
                self.events = None;
                Err(convert::query_error_from_wire(&error))
            }
            Some(execute_event::Event::Start(_)) | None => {
                self.events = None;
                Err(QueryError::new(
                    QueryErrorKind::ConnectionLost,
                    "The connector stopped the result before its end.",
                ))
            }
        }
    }
}

#[async_trait]
impl ResultStream for RemoteStream {
    fn columns(&self) -> Option<&[Column]> {
        self.columns.as_deref()
    }

    async fn next_page(&mut self, max_rows: usize) -> Result<Page, QueryError> {
        while self.buffer.len() < max_rows.max(1) && self.events.is_some() {
            self.read_event().await?;
        }
        let count = max_rows.min(self.buffer.len());
        let rows: Vec<Row> = self.buffer.drain(..count).collect();
        let end = if self.buffer.is_empty() {
            self.end
        } else {
            None
        };
        Ok(Page { rows, end })
    }

    async fn close(self: Box<Self>) {
        // The drop of the stream tells the connector to stop the statement.
        drop(self);
    }
}

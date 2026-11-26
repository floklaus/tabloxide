//! The gRPC service that gives the operations of a `DbAdapter` and its sessions.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use tabloxide_connector_protocol::convert;
use tabloxide_connector_protocol::v1::connector_server::Connector;
use tabloxide_connector_protocol::v1::{
    self, ConnectResponse, Connected, DescribeRelationRequest, DescribeRelationResponse,
    DescribeRequest, DescribeResponse, Empty, ExecuteEvent, ExecuteRequest, ListRelationsRequest,
    ListRelationsResponse, ListSchemasResponse, OpenSessionRequest, ReadPlanRequest,
    ReadPlanResponse, ResultStart, SampleStatementRequest, SampleStatementResponse, SessionRequest,
    StatusResponse, TestConnectionRequest, connect_response, execute_event,
};
use tabloxide_core::{CancelHandle, DbAdapter, QueryError, ResultStream, Secret, Session};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::{Request, Response, Status};

/// Number of rows in one page when the request gives no value.
const DEFAULT_PAGE_ROWS: usize = 500;

/// An open session. The lock serializes the operations of the session. The cancel
/// handle works without the lock, while a statement runs.
#[derive(Clone)]
struct Slot {
    session: Arc<tokio::sync::Mutex<Box<dyn Session>>>,
    cancel: Arc<dyn CancelHandle>,
}

pub(crate) struct ConnectorService {
    adapter: Arc<dyn DbAdapter>,
    version: String,
    sessions: Mutex<HashMap<u64, Slot>>,
    next_id: AtomicU64,
}

impl ConnectorService {
    pub(crate) fn new(adapter: Arc<dyn DbAdapter>, version: &str) -> Self {
        Self {
            adapter,
            version: version.to_owned(),
            sessions: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
        }
    }

    fn slot(&self, id: u64) -> Result<Slot, Status> {
        self.sessions
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&id)
            .cloned()
            .ok_or_else(|| Status::not_found("The session is not open."))
    }

    fn connection_args(
        &self,
        profile: Option<&v1::ConnectionProfile>,
        password: Option<String>,
        workspace_root: String,
    ) -> Result<(tabloxide_core::ConnectionProfile, Option<Secret>, PathBuf), Status> {
        let profile = profile.ok_or_else(|| Status::invalid_argument("The profile is missing."))?;
        let engine = self.adapter.info().engine;
        Ok((
            convert::profile_from_wire(&engine, profile),
            password.map(Secret::new),
            PathBuf::from(workspace_root),
        ))
    }
}

fn event(event: execute_event::Event) -> Result<ExecuteEvent, Status> {
    Ok(ExecuteEvent { event: Some(event) })
}

fn error_event(error: &QueryError) -> Result<ExecuteEvent, Status> {
    event(execute_event::Event::Error(convert::query_error_to_wire(
        error,
    )))
}

type EventSender = mpsc::Sender<Result<ExecuteEvent, Status>>;

/// Sends the pages of `stream`. The next page is read only when the client has
/// read the page before it. When the client goes away, the statement is cancelled.
async fn send_pages(
    mut stream: Box<dyn ResultStream>,
    tx: &EventSender,
    cancel: &dyn CancelHandle,
    page_rows: usize,
) {
    loop {
        let Ok(permit) = tx.reserve().await else {
            break;
        };
        let page = tokio::select! {
            page = stream.next_page(page_rows) => page,
            () = tx.closed() => {
                let _ = cancel.cancel().await;
                break;
            }
        };
        match page {
            Ok(page) => {
                let is_end = page.end.is_some();
                permit.send(event(execute_event::Event::Page(convert::page_to_wire(
                    page,
                ))));
                if is_end {
                    break;
                }
            }
            Err(error) => {
                permit.send(error_event(&error));
                break;
            }
        }
    }
    stream.close().await;
}

async fn run_statement(slot: Slot, statement: String, page_rows: usize, tx: EventSender) {
    let mut session = slot.session.lock_owned().await;
    let stream = match session.execute(&statement).await {
        Ok(stream) => stream,
        Err(error) => {
            let _ = tx.send(error_event(&error)).await;
            return;
        }
    };
    let columns = stream.columns().map(<[_]>::to_vec);
    let start = ResultStart {
        has_rows: columns.is_some(),
        columns: columns
            .iter()
            .flatten()
            .map(convert::column_to_wire)
            .collect(),
    };
    if tx
        .send(event(execute_event::Event::Start(start)))
        .await
        .is_err()
    {
        stream.close().await;
        return;
    }
    send_pages(stream, &tx, slot.cancel.as_ref(), page_rows).await;
}

fn connect_error(error: &tabloxide_core::ConnectError) -> Response<ConnectResponse> {
    Response::new(ConnectResponse {
        result: Some(connect_response::Result::Error(
            convert::connect_error_to_wire(error),
        )),
    })
}

fn connected(version: &str, session_id: Option<u64>) -> Response<ConnectResponse> {
    Response::new(ConnectResponse {
        result: Some(connect_response::Result::Connected(Connected {
            server: Some(v1::ServerInfo {
                version: version.to_owned(),
            }),
            session_id,
        })),
    })
}

#[tonic::async_trait]
impl Connector for ConnectorService {
    async fn describe(
        &self,
        _request: Request<DescribeRequest>,
    ) -> Result<Response<DescribeResponse>, Status> {
        Ok(Response::new(convert::describe_response(
            &self.adapter.info(),
            &self.version,
        )))
    }

    async fn test_connection(
        &self,
        request: Request<TestConnectionRequest>,
    ) -> Result<Response<ConnectResponse>, Status> {
        let request = request.into_inner();
        let (profile, password, root) = self.connection_args(
            request.profile.as_ref(),
            request.password,
            request.workspace_root,
        )?;
        Ok(
            match self
                .adapter
                .test_connection(&profile, password.as_ref(), &root)
                .await
            {
                Ok(info) => connected(&info.version, None),
                Err(error) => connect_error(&error),
            },
        )
    }

    async fn open_session(
        &self,
        request: Request<OpenSessionRequest>,
    ) -> Result<Response<ConnectResponse>, Status> {
        let request = request.into_inner();
        let (profile, password, root) = self.connection_args(
            request.profile.as_ref(),
            request.password,
            request.workspace_root,
        )?;
        let session = match self
            .adapter
            .connect(&profile, password.as_ref(), &root)
            .await
        {
            Ok(session) => session,
            Err(error) => return Ok(connect_error(&error)),
        };
        let version = session.server_info().version.clone();
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let slot = Slot {
            cancel: session.cancel_handle(),
            session: Arc::new(tokio::sync::Mutex::new(session)),
        };
        self.sessions
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(id, slot);
        Ok(connected(&version, Some(id)))
    }

    async fn close_session(
        &self,
        request: Request<SessionRequest>,
    ) -> Result<Response<Empty>, Status> {
        let id = request.into_inner().session_id;
        let slot = self
            .sessions
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&id);
        if let Some(slot) = slot {
            // A statement that runs holds the session. The cancel ends it, and the
            // session closes when its last holder drops it.
            let _ = slot.cancel.cancel().await;
        }
        Ok(Response::new(Empty {}))
    }

    type ExecuteStream = ReceiverStream<Result<ExecuteEvent, Status>>;

    async fn execute(
        &self,
        request: Request<ExecuteRequest>,
    ) -> Result<Response<Self::ExecuteStream>, Status> {
        let request = request.into_inner();
        let slot = self.slot(request.session_id)?;
        let page_rows = match usize::try_from(request.page_rows) {
            Ok(0) | Err(_) => DEFAULT_PAGE_ROWS,
            Ok(rows) => rows,
        };
        let (tx, rx) = mpsc::channel(1);
        tokio::spawn(run_statement(slot, request.statement, page_rows, tx));
        Ok(Response::new(ReceiverStream::new(rx)))
    }

    async fn cancel(
        &self,
        request: Request<SessionRequest>,
    ) -> Result<Response<StatusResponse>, Status> {
        let slot = self.slot(request.into_inner().session_id)?;
        let error = slot
            .cancel
            .cancel()
            .await
            .err()
            .map(|error| convert::query_error_to_wire(&error));
        Ok(Response::new(StatusResponse { error }))
    }

    async fn list_schemas(
        &self,
        request: Request<SessionRequest>,
    ) -> Result<Response<ListSchemasResponse>, Status> {
        let slot = self.slot(request.into_inner().session_id)?;
        let result = slot.session.lock().await.schemas().await;
        Ok(Response::new(match result {
            Ok(schemas) => ListSchemasResponse {
                schemas: schemas.iter().map(convert::schema_to_wire).collect(),
                error: None,
            },
            Err(error) => ListSchemasResponse {
                schemas: Vec::new(),
                error: Some(convert::query_error_to_wire(&error)),
            },
        }))
    }

    async fn list_relations(
        &self,
        request: Request<ListRelationsRequest>,
    ) -> Result<Response<ListRelationsResponse>, Status> {
        let request = request.into_inner();
        let slot = self.slot(request.session_id)?;
        let result = slot.session.lock().await.relations(&request.schema).await;
        Ok(Response::new(match result {
            Ok(relations) => ListRelationsResponse {
                relations: relations.iter().map(convert::relation_to_wire).collect(),
                error: None,
            },
            Err(error) => ListRelationsResponse {
                relations: Vec::new(),
                error: Some(convert::query_error_to_wire(&error)),
            },
        }))
    }

    async fn describe_relation(
        &self,
        request: Request<DescribeRelationRequest>,
    ) -> Result<Response<DescribeRelationResponse>, Status> {
        let request = request.into_inner();
        let slot = self.slot(request.session_id)?;
        let result = slot
            .session
            .lock()
            .await
            .relation_detail(&request.schema, &request.relation)
            .await;
        Ok(Response::new(match result {
            Ok(detail) => DescribeRelationResponse {
                detail: Some(convert::detail_to_wire(&detail)),
                error: None,
            },
            Err(error) => DescribeRelationResponse {
                detail: None,
                error: Some(convert::query_error_to_wire(&error)),
            },
        }))
    }

    async fn sample_statement(
        &self,
        request: Request<SampleStatementRequest>,
    ) -> Result<Response<SampleStatementResponse>, Status> {
        let request = request.into_inner();
        let slot = self.slot(request.session_id)?;
        let statement = slot
            .session
            .lock()
            .await
            .sample_statement(&request.schema, &request.relation, request.limit)
            .await;
        Ok(Response::new(SampleStatementResponse { statement }))
    }

    async fn read_plan(
        &self,
        request: Request<ReadPlanRequest>,
    ) -> Result<Response<ReadPlanResponse>, Status> {
        let request = request.into_inner();
        let slot = self.slot(request.session_id)?;
        let result = slot
            .session
            .lock()
            .await
            .read_plan(&request.statement, request.run)
            .await;
        Ok(Response::new(match result {
            Ok(plan) => ReadPlanResponse {
                text: plan.text,
                statement: plan.statement,
                error: None,
            },
            Err(error) => ReadPlanResponse {
                text: String::new(),
                statement: String::new(),
                error: Some(convert::query_error_to_wire(&error)),
            },
        }))
    }
}

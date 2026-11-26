//! Checks that the generated client and server talk to each other, with the token
//! rule of the design: a request without the correct token gets no answer.

use std::pin::Pin;
use tabloxide_connector_protocol::v1::connector_client::ConnectorClient;
use tabloxide_connector_protocol::v1::connector_server::{Connector, ConnectorServer};
use tabloxide_connector_protocol::v1::{
    Capabilities, Cell, Column, ColumnKind, Completion, ConnectResponse, DescribeRelationRequest,
    DescribeRelationResponse, DescribeRequest, DescribeResponse, Empty, ExecuteEvent,
    ExecuteRequest, ListRelationsRequest, ListRelationsResponse, ListSchemasResponse,
    OpenSessionRequest, Page, ReadPlanRequest, ReadPlanResponse, ResultStart, Row,
    SampleStatementRequest, SampleStatementResponse, SessionRequest, StatusResponse,
    TestConnectionRequest, cell, execute_event,
};
use tabloxide_connector_protocol::{PROTOCOL_MINOR, TOKEN_HEADER};
use tokio::net::TcpListener;
use tokio_stream::Stream;
use tokio_stream::wrappers::TcpListenerStream;
use tonic::metadata::MetadataValue;
use tonic::transport::{Channel, Server};
use tonic::{Code, Request, Response, Status};

const TOKEN: &str = "test-token";

fn not_in_this_test<T>() -> Result<Response<T>, Status> {
    Err(Status::unimplemented("not in this test"))
}

fn text(value: &str) -> Cell {
    Cell {
        value: Some(cell::Value::Text(value.to_owned())),
    }
}

fn event(event: execute_event::Event) -> Result<ExecuteEvent, Status> {
    Ok(ExecuteEvent { event: Some(event) })
}

struct FakeConnector;

#[tonic::async_trait]
impl Connector for FakeConnector {
    type ExecuteStream = Pin<Box<dyn Stream<Item = Result<ExecuteEvent, Status>> + Send>>;

    async fn describe(
        &self,
        _request: Request<DescribeRequest>,
    ) -> Result<Response<DescribeResponse>, Status> {
        Ok(Response::new(DescribeResponse {
            engine: "fake".to_owned(),
            display_name: "Fake".to_owned(),
            connector_version: "1.2.3".to_owned(),
            protocol_minor: PROTOCOL_MINOR,
            capabilities: Some(Capabilities {
                cancel: true,
                unix_socket: false,
                file_database: true,
                explain_plan: false,
            }),
            query_language: "sql".to_owned(),
            default_port: None,
        }))
    }

    async fn execute(
        &self,
        request: Request<ExecuteRequest>,
    ) -> Result<Response<Self::ExecuteStream>, Status> {
        let statement = request.into_inner().statement;
        let column = Column {
            name: "statement".to_owned(),
            type_name: Some("text".to_owned()),
            kind: ColumnKind::Text.into(),
        };
        let events = vec![
            event(execute_event::Event::Start(ResultStart {
                has_rows: true,
                columns: vec![column],
            })),
            event(execute_event::Event::Page(Page {
                rows: vec![Row {
                    cells: vec![text(&statement), Cell { value: None }],
                }],
                end: Some(Completion { affected_rows: 1 }),
            })),
        ];
        Ok(Response::new(Box::pin(tokio_stream::iter(events))))
    }

    async fn test_connection(
        &self,
        _request: Request<TestConnectionRequest>,
    ) -> Result<Response<ConnectResponse>, Status> {
        not_in_this_test()
    }

    async fn open_session(
        &self,
        _request: Request<OpenSessionRequest>,
    ) -> Result<Response<ConnectResponse>, Status> {
        not_in_this_test()
    }

    async fn close_session(
        &self,
        _request: Request<SessionRequest>,
    ) -> Result<Response<Empty>, Status> {
        not_in_this_test()
    }

    async fn cancel(
        &self,
        _request: Request<SessionRequest>,
    ) -> Result<Response<StatusResponse>, Status> {
        not_in_this_test()
    }

    async fn list_schemas(
        &self,
        _request: Request<SessionRequest>,
    ) -> Result<Response<ListSchemasResponse>, Status> {
        not_in_this_test()
    }

    async fn list_relations(
        &self,
        _request: Request<ListRelationsRequest>,
    ) -> Result<Response<ListRelationsResponse>, Status> {
        not_in_this_test()
    }

    async fn describe_relation(
        &self,
        _request: Request<DescribeRelationRequest>,
    ) -> Result<Response<DescribeRelationResponse>, Status> {
        not_in_this_test()
    }

    async fn sample_statement(
        &self,
        _request: Request<SampleStatementRequest>,
    ) -> Result<Response<SampleStatementResponse>, Status> {
        not_in_this_test()
    }

    async fn read_plan(
        &self,
        _request: Request<ReadPlanRequest>,
    ) -> Result<Response<ReadPlanResponse>, Status> {
        not_in_this_test()
    }
}

fn check_token(request: Request<()>) -> Result<Request<()>, Status> {
    match request.metadata().get(TOKEN_HEADER) {
        Some(value) if value.as_bytes() == TOKEN.as_bytes() => Ok(request),
        _ => Err(Status::unauthenticated("the token is not correct")),
    }
}

/// Starts the fake connector on the loopback address and returns a channel to it.
async fn start() -> Channel {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(
        Server::builder()
            .add_service(ConnectorServer::with_interceptor(
                FakeConnector,
                check_token,
            ))
            .serve_with_incoming(TcpListenerStream::new(listener)),
    );
    Channel::from_shared(format!("http://{address}"))
        .unwrap()
        .connect()
        .await
        .unwrap()
}

fn with_token(token: &'static str) -> impl FnMut(Request<()>) -> Result<Request<()>, Status> {
    move |mut request: Request<()>| {
        request
            .metadata_mut()
            .insert(TOKEN_HEADER, MetadataValue::from_static(token));
        Ok(request)
    }
}

#[tokio::test]
async fn the_client_gets_the_description_of_the_connector() {
    let mut client = ConnectorClient::with_interceptor(start().await, with_token(TOKEN));

    let description = client
        .describe(DescribeRequest {})
        .await
        .unwrap()
        .into_inner();

    assert_eq!(description.engine, "fake");
    assert_eq!(description.protocol_minor, PROTOCOL_MINOR);
    assert!(description.capabilities.unwrap().file_database);
}

#[tokio::test]
async fn the_execute_stream_gives_the_start_then_the_rows_and_the_end() {
    let mut client = ConnectorClient::with_interceptor(start().await, with_token(TOKEN));
    let request = ExecuteRequest {
        session_id: 1,
        statement: "select 1".to_owned(),
        page_rows: 500,
    };

    let mut stream = client.execute(request).await.unwrap().into_inner();
    let first = stream.message().await.unwrap().unwrap().event.unwrap();
    let second = stream.message().await.unwrap().unwrap().event.unwrap();
    let end = stream.message().await.unwrap();

    let execute_event::Event::Start(start) = first else {
        panic!("the first event must be the start");
    };
    assert!(start.has_rows);
    assert_eq!(start.columns[0].kind(), ColumnKind::Text);
    let execute_event::Event::Page(page) = second else {
        panic!("the second event must be a page");
    };
    assert_eq!(page.rows[0].cells[0], text("select 1"));
    assert_eq!(
        page.rows[0].cells[1].value, None,
        "a cell without a value is NULL"
    );
    assert_eq!(page.end.unwrap().affected_rows, 1);
    assert!(end.is_none());
}

#[tokio::test]
async fn a_request_without_the_correct_token_gets_no_answer() {
    let channel = start().await;
    let mut no_token = ConnectorClient::new(channel.clone());
    let mut wrong_token = ConnectorClient::with_interceptor(channel, with_token("other"));

    let missing = no_token.describe(DescribeRequest {}).await.unwrap_err();
    let wrong = wrong_token.describe(DescribeRequest {}).await.unwrap_err();

    assert_eq!(missing.code(), Code::Unauthenticated);
    assert_eq!(wrong.code(), Code::Unauthenticated);
}
